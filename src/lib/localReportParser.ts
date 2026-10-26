/** Local-only PDF parsing for the clinical review tab. Never persists patient data. */
import { getDocument, GlobalWorkerOptions, type PDFDocumentProxy } from 'pdfjs-dist';
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { createWorker, type Worker as OcrWorker } from 'tesseract.js';

GlobalWorkerOptions.workerSrc = pdfWorkerUrl;
export const MAX_REPORT_BYTES = 12 * 1024 * 1024;
export const MAX_REPORT_PAGES = 50;
export type ExtractionMethod = 'text-layer' | 'ocr' | 'unreadable';
export interface ReportPage {
  number: number;
  text: string;
  method: ExtractionMethod;
  confidence?: number;
  warning?: string;
}
export interface ReportResult { pdf: PDFDocumentProxy; pages: ReportPage[] }
export interface ReportProgress {
  page: number;
  total: number;
  phase: 'opening' | 'text' | 'ocr' | 'finished';
}
export interface ParserOptions {
  signal?: AbortSignal;
  onProgress?: (value: ReportProgress) => void;
}
class InvalidReport extends Error {}
const aborted = () => new DOMException('Cancelled', 'AbortError');
function check(signal?: AbortSignal) { if (signal?.aborted) throw aborted(); }

export function validatePdf(file: Pick<File, 'name' | 'size' | 'type'>, header: Uint8Array): void {
  if (file.size < 1 || file.size > MAX_REPORT_BYTES)
    throw new InvalidReport('Select a non-empty PDF up to 12 MiB.');
  if (!/\.pdf$/i.test(file.name) || (file.type && file.type !== 'application/pdf'))
    throw new InvalidReport('Only PDF reports are supported.');
  if (!new TextDecoder('ascii').decode(header.subarray(0, 1024)).includes('%PDF-'))
    throw new InvalidReport('This file does not contain a valid PDF signature.');
}
export function needsOcr(text: string) {
  return text.replace(/\s/g, '').length < 35;
}
export type PositionedText = { x: number; y: number; text: string };
export function sortPageText(items: PositionedText[]): string {
  const lines: { y: number; items: PositionedText[] }[] = [];
  for (const item of [...items].sort((a,b) => b.y - a.y || a.x - b.x)) {
    const line = lines.find(l => Math.abs(l.y - item.y) < 3);
    if (line) line.items.push(item);
    else lines.push({ y: item.y, items: [item] });
  }
  return lines.sort((a,b) => b.y - a.y).map(l =>
    l.items.sort((a,b) => a.x - b.x).map(i => i.text).join(' ').replace(/\s+/g,' ').trim()
  ).filter(Boolean).join('\n');
}
export function publicReportError(error: unknown): string {
  if (error instanceof InvalidReport) return error.message;
  const name = error && typeof error === 'object' && 'name' in error ? String(error.name) : '';
  if (name === 'AbortError') return 'Extraction cancelled.';
  if (name === 'PasswordException') return 'This PDF requires a password. Please use an unlocked copy.';
  if (name === 'InvalidPDFException' || name === 'MissingPDFException')
    return 'The PDF could not be opened or is damaged.';
  return 'Unable to read this report. Please check the file or local OCR installation.';
}
async function createOfflineOcr(): Promise<OcrWorker> {
  const base = import.meta.env.BASE_URL || '/';
  return createWorker('eng', 1, {
    workerPath: base + 'ocr/worker.min.js',
    corePath: base + 'ocr/core',
    langPath: base + 'ocr/lang',
    workerBlobURL: false,
    cacheMethod: 'none'
  });
}
async function ocrPage(
  page: Awaited<ReturnType<PDFDocumentProxy['getPage']>>,
  worker: OcrWorker, signal?: AbortSignal
): Promise<{ text: string; confidence: number }> {
  check(signal);
  const natural = page.getViewport({ scale: 1 });
  const scale = Math.min(2, 1600 / Math.max(natural.width, natural.height));
  const viewport = page.getViewport({ scale });
  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(viewport.width);
  canvas.height = Math.ceil(viewport.height);
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('No canvas available');
  const render = page.render({ canvas, canvasContext: ctx, viewport });
  const cancel = () => render.cancel();
  signal?.addEventListener('abort', cancel, { once: true });
  try {
    await render.promise;
    check(signal);
    const result = await worker.recognize(canvas);
    check(signal);
    return { text: result.data.text.trim(), confidence: result.data.confidence };
  } finally {
    signal?.removeEventListener('abort', cancel);
    canvas.width = 0; canvas.height = 0;
  }
}
export async function extractLocalReport(file: File, opts: ParserOptions = {}): Promise<ReportResult> {
  const { signal, onProgress } = opts;
  check(signal);
  onProgress?.({ page: 0, total: 0, phase: 'opening' });
  if (!file.size || file.size > MAX_REPORT_BYTES || !/\.pdf$/i.test(file.name) ||
      (file.type && file.type !== 'application/pdf')) {
    validatePdf(file, new Uint8Array()); // Reject before allocating the buffer.
  }
  const bytes = new Uint8Array(await file.arrayBuffer());
  validatePdf(file, bytes);
  check(signal);
  const task = getDocument({ data: bytes, isEvalSupported: false });
  const cancelLoading = () => { void task.destroy(); };
  signal?.addEventListener('abort', cancelLoading, { once: true });
  let pdf: PDFDocumentProxy | undefined;
  let ocrPromise: Promise<OcrWorker> | undefined;
  const cancelOcr = () => { void ocrPromise?.then(w => w.terminate()).catch(() => {}); };
  signal?.addEventListener('abort', cancelOcr, { once: true });
  try {
    pdf = await task.promise;
    check(signal);
    if (pdf.numPages > MAX_REPORT_PAGES) throw new InvalidReport('Report exceeds the 50-page limit.');
    const pages: ReportPage[] = [];
    for (let number = 1; number <= pdf.numPages; number++) {
      check(signal);
      onProgress?.({ page: number, total: pdf.numPages, phase: 'text' });
      const page = await pdf.getPage(number);
      try {
        const content = await page.getTextContent();
        const positioned: PositionedText[] = [];
        for (const item of content.items) {
          if ('str' in item && 'transform' in item) {
            positioned.push({ x: item.transform[4], y: item.transform[5], text: item.str });
          }
        }
        let text = sortPageText(positioned);
        let method: ExtractionMethod = 'text-layer';
        let confidence: number | undefined;
        let warning: string | undefined;
        if (needsOcr(text)) {
          onProgress?.({ page: number, total: pdf.numPages, phase: 'ocr' });
          try {
            ocrPromise ??= createOfflineOcr();
            const worker = await ocrPromise;
            check(signal);
            const scanned = await ocrPage(page, worker, signal);
            if (scanned.text.trim().length > text.trim().length) {
              text = scanned.text;
              method = 'ocr';
              confidence = scanned.confidence;
              if (confidence < 75) warning = 'Low OCR confidence. Verify with the PDF image.';
            }
          } catch {
            check(signal);
            warning = 'Local OCR unavailable or failed; compare this page manually.';
          }
        }
        if (!text.trim()) {
          method = 'unreadable';
          warning = 'No usable text found. This page must be reviewed manually.';
        }
        pages.push({ number, text, method, confidence, warning });
      } finally {
        page.cleanup();
      }
    }
    check(signal);
    onProgress?.({ page: pdf.numPages, total: pdf.numPages, phase: 'finished' });
    return { pdf, pages };
  } catch (error) {
    if (pdf) await pdf.destroy().catch(() => {});
    throw error;
  } finally {
    signal?.removeEventListener('abort', cancelLoading);
    signal?.removeEventListener('abort', cancelOcr);
    if (ocrPromise) {
      try { const ocr = await ocrPromise; await ocr.terminate(); } catch { /* cleanup only */ }
    }
  }
}
