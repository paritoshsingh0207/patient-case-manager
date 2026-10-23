import { useEffect, useState, type FormEvent } from 'react';
import type { Firestore } from 'firebase/firestore';
import type { FirebaseStorage } from 'firebase/storage';
import {
  CATEGORY_LABELS, MAX_ATTACHMENT_BYTES, type AttachmentCategory,
} from '../lib/attachmentValidation';
import {
  downloadPatientAttachment, subscribePatientAttachments, uploadPatientAttachment,
  type PatientAttachment,
} from '../services/attachmentService';

export function PatientAttachments({ db, storage, patientId, userId }: {
  db: Firestore;
  storage?: FirebaseStorage;
  patientId: string;
  userId: string;
}) {
  const [files, setFiles] = useState<PatientAttachment[]>([]);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [category, setCategory] = useState<AttachmentCategory>('lab-report');
  const [description, setDescription] = useState('');
  const [progress, setProgress] = useState<number | null>(null);
  const [working, setWorking] = useState(false);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  useEffect(() => {
    setFiles([]);
    setLoading(true);
    setError('');
    setSelectedFile(null);
    return subscribePatientAttachments(db, patientId,
      records => { setFiles(records); setLoading(false); },
      cause => { setError(cause.message); setLoading(false); });
  }, [db, patientId]);

  async function upload(event: FormEvent) {
    event.preventDefault();
    if (!storage || !selectedFile) return;
    setError(''); setMessage(''); setWorking(true); setProgress(0);
    try {
      await uploadPatientAttachment({
        db, storage, patientId, userId, file: selectedFile, category, description,
        onProgress: setProgress,
      });
      setMessage('Attachment saved to this patient chart.');
      setSelectedFile(null); setDescription(''); setProgress(null);
      // Reset native file input after success.
      const input = document.getElementById('patient-attachment-file') as HTMLInputElement | null;
      if (input) input.value = '';
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to upload the attachment.');
    } finally {
      setWorking(false);
    }
  }

  async function download(record: PatientAttachment) {
    if (!storage) return;
    setError(''); setDownloadingId(record.id);
    try { await downloadPatientAttachment(storage, patientId, record); }
    catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not securely retrieve the attachment.');
    } finally { setDownloadingId(null); }
  }

  return <section className="workspace-card glass-panel patient-attachments" aria-label="Patient lab reports and attachments">
    <div className="section-heading">
      <div>
        <h2>Lab reports & attachments</h2>
        <p className="section-copy">Private files for this patient only. Only authorized clinic accounts may retrieve them.</p>
      </div>
      <span className="status-pill">{files.filter(item => item.status === 'ready').length} saved</span>
    </div>

    {!storage ? <div className="inline-notice" role="status">
      Secure file storage is not configured. An administrator must enable Firebase Cloud Storage
      on a Blaze-plan project, deploy the restrictive Storage rules, and configure the private
      bucket before uploads or downloads become available.
    </div> : <>
      <form className="attachment-upload-form" onSubmit={upload}>
        <label htmlFor="patient-attachment-file">Choose clinical file
          <input id="patient-attachment-file" type="file" accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png"
            required disabled={working}
            onChange={event => setSelectedFile(event.target.files?.[0] || null)}/>
        </label>
        <small>PDF, JPEG or PNG only; maximum {MAX_ATTACHMENT_BYTES / 1024 / 1024} MB. Do not upload executable or password-protected documents.</small>
        <label>Document category
          <select value={category} disabled={working}
            onChange={event => setCategory(event.target.value as AttachmentCategory)}>
            {Object.entries(CATEGORY_LABELS).map(([key,label]) =>
              <option key={key} value={key}>{label}</option>)}
          </select>
        </label>
        <label>Description (optional)
          <textarea maxLength={500} value={description} disabled={working}
            placeholder="Example: Complete blood count, 10 Oct 2026"
            onChange={event => setDescription(event.target.value)} />
        </label>
        <button type="submit" className="button primary" disabled={working || !selectedFile}>
          {working ? 'Uploading…' : 'Upload to patient chart'}
        </button>
        {progress !== null ? <progress aria-label="File upload progress" value={progress} max={100}>{progress}%</progress> : null}
      </form>
      <p className="quiet-note">Uploaded files are not automatically virus-scanned or clinically interpreted.
        Treat attachments as unverified clinical evidence; confirm report authenticity before relying on them.
        Downloads are authenticated, not public share links.</p>
    </>}

    {error ? <p className="inline-error" role="alert">{error}</p> : null}
    {message ? <p className="save-message" role="status">{message}</p> : null}

    <div className="attachment-record-list">
      {files.map(record => <article key={record.id} className="attachment-record">
        <div className="attachment-record-info">
          <strong>{record.originalName}</strong>
          <small>{CATEGORY_LABELS[record.category] || 'Clinical attachment'} ·
            {' '}{(record.sizeBytes / 1024).toFixed(1)} KB ·
            {' '}{record.createdAt?.toLocaleDateString() || 'Date pending'}</small>
          {record.description ? <p>{record.description}</p> : null}
          {record.status !== 'ready' ?
            <small>{record.status === 'failed' ? 'Upload failed — contact the administrator for safe cleanup'
              : 'Upload pending — check with the uploader before treating this as available'}</small> : null}
        </div>
        {storage && record.status === 'ready' ?
          <button type="button" className="button secondary" disabled={downloadingId !== null}
            onClick={() => download(record)}>
            {downloadingId === record.id ? 'Retrieving…' : 'Download'}
          </button> : null}
      </article>)}
      {loading ? <div className="empty-list">Loading patient attachments…</div> : null}
      {!loading && files.length === 0 ? <div className="empty-list">No reports or attachments saved for this patient.</div> : null}
    </div>
  </section>;
}
