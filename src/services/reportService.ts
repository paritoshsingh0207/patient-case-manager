import {
  addDoc, collection, onSnapshot, serverTimestamp,
  type DocumentData, type Firestore, type QueryDocumentSnapshot,
} from 'firebase/firestore';
import type { ReportPage } from '../lib/localReportParser';

// Allow room for Firestore document metadata and stay well under its 1 MiB limit.
// Only reviewed text is persisted: never raw PDFs, images, or OCR image buffers.
export const MAX_SAVED_REPORT_TEXT_BYTES = 120_000;
export const MAX_SAVED_REPORT_NAME_LENGTH = 120;
export const MAX_SAVED_REPORT_PAGES = 50;

export interface SavedPatientReport {
  id: string;
  patientId: string;
  createdBy: string;
  reportName: string;
  content: string;
  pageCount: number;
  ocrUsed: boolean;
  createdAt?: Date;
}

export interface ReviewedReportContent {
  reportName: string;
  content: string;
  pageCount: number;
  ocrUsed: boolean;
}

export function prepareReviewedReport(
  name: string, pages: Pick<ReportPage, 'number' | 'text' | 'method'>[],
): ReviewedReportContent {
  const reportName = name.trim();
  if (!reportName || reportName.length > MAX_SAVED_REPORT_NAME_LENGTH)
    throw Error('Enter a report name of up to 120 characters.');
  if (!pages.length || pages.length > MAX_SAVED_REPORT_PAGES)
    throw Error('A saved report must have between 1 and 50 pages.');
  if (pages.some((page, index) =>
    page.number !== index + 1 || typeof page.text !== 'string' ||
    !['text-layer', 'ocr', 'unreadable'].includes(page.method))) {
    throw Error('The report pages are not in a valid order.');
  }
  const content = pages.map(page =>
    'Page ' + page.number + '\n' + page.text.trim()
  ).join('\n\n--------------------\n\n');
  if (!pages.some(page => page.text.trim().length > 0))
    throw Error('No report text is available to save. Review the PDF and enter a transcription.');
  if (new TextEncoder().encode(content).byteLength > MAX_SAVED_REPORT_TEXT_BYTES)
    throw Error('The extracted text is too long for one report document. Save a shorter report or split the source PDF.');
  return {
    reportName, content, pageCount: pages.length,
    ocrUsed: pages.some(page => page.method === 'ocr'),
  };
}

function toDate(value: unknown): Date | undefined {
  return value && typeof value === 'object' && 'toDate' in value &&
    typeof (value as { toDate: () => Date }).toDate === 'function'
    ? (value as { toDate: () => Date }).toDate() : undefined;
}

function fromDoc(
  snapshot: QueryDocumentSnapshot<DocumentData>, patientId: string,
): SavedPatientReport {
  const data = snapshot.data();
  return {
    id: snapshot.id,
    patientId,
    createdBy: String(data.createdBy || ''),
    reportName: String(data.reportName || ''),
    content: String(data.content || ''),
    pageCount: Number(data.pageCount || 0),
    ocrUsed: data.ocrUsed === true,
    createdAt: toDate(data.createdAt),
  };
}

/** One immutable Firestore document per reviewed report, scoped under its patient. */
export async function saveReviewedPatientReport(
  db: Firestore,
  patientId: string,
  userId: string,
  reportName: string,
  pages: Pick<ReportPage, 'number' | 'text' | 'method'>[],
): Promise<string> {
  if (!patientId || !userId) throw Error('An assigned patient and signed-in clinician are required.');
  const reviewed = prepareReviewedReport(reportName, pages);
  const result = await addDoc(collection(db, 'patients', patientId, 'reports'), {
    patientId,
    createdBy: userId,
    ...reviewed,
    reviewed: true,
    schemaVersion: 1,
    createdAt: serverTimestamp(),
  });
  return result.id;
}

/** Authorized clinic members see reports for this patient only. */
export function subscribeSavedPatientReports(
  db: Firestore,
  patientId: string,
  onChange: (records: SavedPatientReport[]) => void,
  onError: (error: Error) => void,
): () => void {
  return onSnapshot(collection(db, 'patients', patientId, 'reports'), snapshot => {
    onChange(snapshot.docs.map(doc => fromDoc(doc, patientId))
      .sort((a, b) => (b.createdAt?.getTime() || 0) -
        (a.createdAt?.getTime() || 0) || b.id.localeCompare(a.id)));
  }, onError);
}
