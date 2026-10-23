import {
  collection, doc, onSnapshot, serverTimestamp, setDoc, updateDoc,
  type Firestore,
} from 'firebase/firestore';
import { getBlob, ref, uploadBytesResumable, type FirebaseStorage } from 'firebase/storage';
import {
  inspectAttachmentFile, sanitizedAttachmentName, type AttachmentCategory, MAX_ATTACHMENT_BYTES,
} from '../lib/attachmentValidation';

export type AttachmentStatus = 'pending' | 'ready' | 'failed';
export interface PatientAttachment {
  id: string;
  patientId: string;
  createdBy: string;
  originalName: string;
  contentType: string;
  sizeBytes: number;
  category: AttachmentCategory;
  description: string;
  status: AttachmentStatus;
  createdAt?: Date;
  uploadedAt?: Date;
}

export function attachmentPath(patientId: string, attachmentId: string): string {
  return `patientFiles/${patientId}/${attachmentId}`;
}

function toDate(value: unknown): Date | undefined {
  return value && typeof value === 'object' && 'toDate' in value &&
    typeof (value as { toDate: () => Date }).toDate === 'function'
    ? (value as { toDate: () => Date }).toDate() : undefined;
}

export function subscribePatientAttachments(
  db: Firestore, patientId: string,
  onChange: (records: PatientAttachment[]) => void,
  onError: (error: Error) => void,
): () => void {
  return onSnapshot(collection(db, 'patients', patientId, 'attachments'), snapshot => {
    const records = snapshot.docs.map(record => {
      const data = record.data();
      return {
        id: record.id,
        patientId, createdBy: String(data.createdBy || ''),
        originalName: String(data.originalName || ''),
        contentType: String(data.contentType || ''),
        sizeBytes: Number(data.sizeBytes || 0),
        category: data.category as AttachmentCategory,
        description: String(data.description || ''),
        status: data.status as AttachmentStatus,
        createdAt: toDate(data.createdAt), uploadedAt: toDate(data.uploadedAt),
      };
    });
    onChange(records.sort((a,b) => (b.createdAt?.getTime() || 0) - (a.createdAt?.getTime() || 0)));
  }, onError);
}

/** Two-stage upload: immutable patient metadata, then private storage binary,
 * then mark ready. Interrupted uploads remain visibly pending or failed,
 * never silently misrepresented as complete medical evidence.
 */
export async function uploadPatientAttachment(input: {
  db: Firestore; storage: FirebaseStorage; patientId: string; userId: string;
  file: File; category: AttachmentCategory; description: string;
  onProgress?: (percent: number) => void;
}): Promise<void> {
  await inspectAttachmentFile(input.file, input.category, input.description);
  const fileRef = doc(collection(input.db, 'patients', input.patientId, 'attachments'));
  await setDoc(fileRef, {
    patientId: input.patientId, createdBy: input.userId,
    originalName: sanitizedAttachmentName(input.file.name),
    contentType: input.file.type, sizeBytes: input.file.size,
    category: input.category, description: input.description.trim(),
    status: 'pending', createdAt: serverTimestamp(),
  });
  try {
    await new Promise<void>((resolve, reject) => {
      const task = uploadBytesResumable(
        ref(input.storage, attachmentPath(input.patientId, fileRef.id)), input.file,
        { contentType: input.file.type, cacheControl: 'no-store',
          contentDisposition: 'attachment',
          customMetadata: { createdBy: input.userId, patientId: input.patientId } },
      );
      task.on('state_changed', snapshot => {
        if (snapshot.totalBytes > 0)
          input.onProgress?.(Math.round(100 * snapshot.bytesTransferred / snapshot.totalBytes));
      }, reject, resolve);
    });
    await updateDoc(fileRef, { status: 'ready', uploadedAt: serverTimestamp() });
  } catch (error) {
    // Do not overwrite a successfully committed 'ready' record on transient
    // client-side errors. This best-effort state is not a cleanup of storage.
    await updateDoc(fileRef, { status: 'failed', uploadedAt: serverTimestamp() }).catch(() => {});
    throw error;
  }
}

/** Avoid getDownloadURL(): its bearer token remains valid even after the
 * doctor loses access. getBlob makes an authenticated Storage request every
 * time. It can still be saved by an authorized recipient, like any record.
 */
export async function downloadPatientAttachment(
  storage: FirebaseStorage, patientId: string, attachment: PatientAttachment,
): Promise<void> {
  if (attachment.patientId !== patientId || attachment.status !== 'ready') {
    throw Error('The attachment is not ready to download.');
  }
  const blob = await getBlob(ref(storage, attachmentPath(patientId, attachment.id)), MAX_ATTACHMENT_BYTES);
  const url = URL.createObjectURL(blob);
  try {
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = sanitizedAttachmentName(attachment.originalName);
    anchor.rel = 'noopener';
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 30000);
  }
}
