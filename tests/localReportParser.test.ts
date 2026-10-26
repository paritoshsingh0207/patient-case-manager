import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ getDocument: vi.fn(), createWorker: vi.fn() }));
vi.mock('pdfjs-dist', () => ({
  getDocument: mocks.getDocument,
  GlobalWorkerOptions: { workerSrc: '' }
}));
vi.mock('pdfjs-dist/build/pdf.worker.min.mjs?url', () => ({ default: '/assets/pdf.worker.min.mjs' }));
vi.mock('tesseract.js', () => ({ createWorker: mocks.createWorker }));
import {
  MAX_REPORT_BYTES, extractLocalReport, needsOcr, publicReportError,
  sortPageText, validatePdf
} from '../src/lib/localReportParser';

function report(contents = '%PDF-1.7 synthetic') {
  return new File([contents], 'example.pdf', { type: 'application/pdf' });
}
function mockPage(text: string, scan = false) {
  return {
    getTextContent: vi.fn(async () => ({ items: scan ? [] : [
      { str: text, transform: [1,0,0,1,10,100], hasEOL:false }
    ] })),
    getViewport: vi.fn(({ scale }: { scale: number }) => ({
      width: 500 * scale, height: 700 * scale
    })),
    render: vi.fn(() => ({ promise: Promise.resolve(), cancel: vi.fn() })),
    cleanup: vi.fn()
  };
}
function mockDocument(...pages: ReturnType<typeof mockPage>[]) {
  const pdf = { numPages: pages.length, destroy: vi.fn(async () => {}),
    getPage: vi.fn(async (index: number) => pages[index - 1]) };
  mocks.getDocument.mockReturnValue({ promise: Promise.resolve(pdf), destroy: vi.fn(async()=>{}) });
  return pdf;
}
beforeEach(() => {
  mocks.getDocument.mockReset();
  mocks.createWorker.mockReset();
  vi.stubGlobal('document', {
    createElement: vi.fn(() => ({
      width: 0, height: 0, getContext: vi.fn(() => ({}))
    }))
  });
  mocks.createWorker.mockResolvedValue({
    recognize: vi.fn(async () => ({ data: { text: 'Haemoglobin 12.8 g/dL', confidence: 91 } })),
    terminate: vi.fn(async () => {})
  });
});
afterEach(() => vi.unstubAllGlobals());

describe('local-only medical report parser', () => {
  it('rejects invalid PDF input and excessively large files', () => {
    expect(() => validatePdf({ name: 'bad.pdf', type: 'application/pdf', size: 5 }, new Uint8Array([1]))).toThrow(/signature/);
    expect(() => validatePdf({ name: 'big.pdf', type: 'application/pdf', size: MAX_REPORT_BYTES + 1 },
      new TextEncoder().encode('%PDF-'))).toThrow(/12 MiB/);
  });
  it('sorts text by approximate page coordinates', () => {
    expect(sortPageText([{x:10,y:1,text:'last'}, {x:30,y:10,text:'second'},
      {x:2,y:10,text:'first'}])).toBe('first second\nlast');
    expect(needsOcr('')).toBe(true);
    expect(needsOcr('A'.repeat(75))).toBe(false);
  });
  it('redacts third-party error details from UI messages', () => {
    expect(publicReportError(new Error('patient-secret-identifiers'))).not.toContain('secret');
    expect(publicReportError({ name: 'PasswordException' })).toMatch(/password/);
  });
  it('uses PDF text without OCR and does not call remote fetch', async () => {
    const fetch = vi.fn(() => { throw new Error('Network request forbidden'); });
    vi.stubGlobal('fetch', fetch);
    mockDocument(mockPage('Synthetic long medical report line with sufficient characters.'));
    const result = await extractLocalReport(report());
    expect(result.pages[0].method).toBe('text-layer');
    expect(mocks.createWorker).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
    await result.dispose();
  });
  it('runs only same-origin OCR fallback for a mixed report', async () => {
    mockDocument(mockPage('A sufficiently long, native text page on a synthetic report'), mockPage('', true));
    const result = await extractLocalReport(report());
    expect(result.pages.map(p => p.method)).toEqual(['text-layer','ocr']);
    expect(mocks.createWorker).toHaveBeenCalledTimes(1);
    expect(mocks.createWorker.mock.calls[0][2]).toMatchObject({
      workerPath: '/ocr/worker.min.js',
      corePath: '/ocr/core',
      langPath: '/ocr/lang',
      cacheMethod: 'none'
    });
    await result.dispose();
  });
  it('stops immediately on pre-cancelled extraction', async () => {
    const ctrl = new AbortController(); ctrl.abort();
    await expect(extractLocalReport(report(),{ signal: ctrl.signal })).rejects.toMatchObject({ name:'AbortError' });
    expect(mocks.getDocument).not.toHaveBeenCalled();
  });
  it('surfaces safe message for encrypted and damaged documents', () => {
    expect(publicReportError({name:'InvalidPDFException'})).toMatch(/damaged/);
    expect(publicReportError({name:'PasswordException'})).toMatch(/password/);
  });
});
