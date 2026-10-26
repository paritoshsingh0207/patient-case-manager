import { useCallback, useEffect, useRef, useState, type ChangeEvent } from 'react';
import type { PDFDocumentProxy, RenderTask } from 'pdfjs-dist';
import {
  extractLocalReport, MAX_REPORT_BYTES, publicReportError,
  type ReportPage, type ReportProgress,
} from '../lib/localReportParser';
import './LocalReportParser.css';

/** Phase 1 deliberately has no Firebase imports, persistence, or remote AI. */
export function LocalReportParser({ patientId }: { patientId: string }) {
  const [pages, setPages] = useState<ReportPage[]>([]);
  const [selectedPage, setSelectedPage] = useState(1);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<ReportProgress | null>(null);
  const [error, setError] = useState('');
  const [confirmClear, setConfirmClear] = useState(false);
  const pdfRef = useRef<PDFDocumentProxy | null>(null);
  const controllerRef = useRef<AbortController | null>(null);
  const renderRef = useRef<RenderTask | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const pickerRef = useRef<HTMLInputElement>(null);
  const sequence = useRef(0);
  const mounted = useRef(true);

  const discard = useCallback(() => {
    sequence.current++;
    controllerRef.current?.abort();
    controllerRef.current = null;
    renderRef.current?.cancel();
    renderRef.current = null;
    const old = pdfRef.current;
    pdfRef.current = null;
    if (old) void old.destroy().catch(() => {});
    if (pickerRef.current) pickerRef.current.value = '';
    if (canvasRef.current) { canvasRef.current.width = 0; canvasRef.current.height = 0; }
    if (mounted.current) {
      setPages([]); setSelectedPage(1); setError(''); setBusy(false);
      setProgress(null); setConfirmClear(false);
    }
  }, []);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; discard(); };
  }, [discard, patientId]);

  const selectReport = useCallback(async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    discard();
    const id = ++sequence.current;
    const controller = new AbortController();
    controllerRef.current = controller;
    setBusy(true);
    try {
      const result = await extractLocalReport(file, {
        signal: controller.signal,
        onProgress: value => {
          if (mounted.current && id === sequence.current) setProgress(value);
        },
      });
      if (controller.signal.aborted || !mounted.current || id !== sequence.current) {
        await result.pdf.destroy().catch(() => {});
        return;
      }
      pdfRef.current = result.pdf;
      setPages(result.pages);
      setSelectedPage(1);
      setProgress(null);
    } catch (cause) {
      if (mounted.current && id === sequence.current && !controller.signal.aborted)
        setError(publicReportError(cause));
    } finally {
      if (mounted.current && id === sequence.current) {
        setBusy(false); setProgress(null);
      }
      if (controllerRef.current === controller) controllerRef.current = null;
    }
  }, [discard]);

  useEffect(() => {
    const pdf = pdfRef.current;
    const canvas = canvasRef.current;
    if (!pdf || !canvas || !pages.length) return;
    let ended = false;
    const paint = async () => {
      try {
        const page = await pdf.getPage(selectedPage);
        if (ended) return;
        const defaultView = page.getViewport({ scale: 1 });
        const available = Math.min(700, Math.max(240, canvas.parentElement?.clientWidth || 550));
        const viewport = page.getViewport({ scale: Math.min(2, available / defaultView.width) });
        canvas.width = Math.ceil(viewport.width);
        canvas.height = Math.ceil(viewport.height);
        const context = canvas.getContext('2d');
        if (!context) return;
        const render = page.render({ canvas, canvasContext: context, viewport });
        renderRef.current = render;
        await render.promise;
      } catch {
        // Expected if the doctor cancels or changes pages. Never log patient data.
      } finally {
        if (!ended) renderRef.current = null;
      }
    };
    void paint();
    return () => { ended = true; renderRef.current?.cancel(); };
  }, [pages.length, selectedPage]);

  const page = pages[selectedPage - 1];

  return <section className="workspace-card glass-panel local-report" aria-label="Local medical report extraction">
    <div className="section-heading">
      <div>
        <h2>Extract Report</h2>
        <p className="section-copy">PDF and OCR stay in this browser. No report is uploaded, sent to AI or saved.</p>
      </div>
      <span className="status-pill">Phase 1 · No saving</span>
    </div>
    <div className="local-report-controls">
      <label htmlFor="local-report-pdf"><strong>Choose medical PDF</strong>
        <input ref={pickerRef} id="local-report-pdf" type="file" accept=".pdf,application/pdf"
          disabled={busy} onChange={selectReport} />
      </label>
      <p className="quiet-note">PDF only · maximum {MAX_REPORT_BYTES / 1048576} MiB · 50 pages. Image-only pages use local English OCR.</p>
      {busy ? <div role="status" aria-live="polite" className="local-report-status">
        <span>{progress ? (progress.phase === 'ocr' ? 'OCR page' : 'Reading page') +
          ' ' + progress.page + ' / ' + (progress.total || '…') : 'Opening PDF…'}</span>
        <button className="button secondary" type="button" onClick={discard}>Cancel extraction</button>
      </div> : null}
      {error ? <p className="inline-error" role="alert">{error}</p> : null}
    </div>
    {pages.length > 0 ? <>
      <div className="local-report-toolbar">
        <strong>{pages.length} page(s) loaded locally</strong>
        <div className="local-report-pages">
          <button className="button secondary" type="button" disabled={selectedPage === 1}
            onClick={() => setSelectedPage(n => Math.max(1, n - 1))}>Previous</button>
          <label htmlFor="local-report-page-choice">Page</label>
          <select id="local-report-page-choice" value={selectedPage}
            onChange={event => setSelectedPage(Number(event.target.value))}>
            {pages.map(p => <option key={p.number} value={p.number}>{p.number}</option>)}
          </select>
          <button className="button secondary" type="button" disabled={selectedPage >= pages.length}
            onClick={() => setSelectedPage(n => Math.min(pages.length, n + 1))}>Next</button>
        </div>
      </div>
      <div className="local-report-columns">
        <div className="local-report-preview">
          <h3>Original PDF · page {selectedPage}</h3>
          <div className="local-report-canvas"><canvas ref={canvasRef} aria-label={'Original report page ' + selectedPage}/></div>
        </div>
        <div className="local-report-editor">
          <h3>Extracted text · page {selectedPage}</h3>
          <p className="quiet-note">{page.method === 'ocr' ? 'Local OCR' :
            page.method === 'unreadable' ? 'Unreadable page' : 'Embedded PDF text'}
            {typeof page.confidence === 'number' ? ' · Confidence ' + Math.round(page.confidence) + '%' : ''}</p>
          {page.warning ? <p className="inline-notice">{page.warning}</p> : null}
          <label htmlFor="local-report-transcript">Review and correct transcription</label>
          <textarea id="local-report-transcript" rows={16} spellCheck={false}
            placeholder="No readable text; verify manually against the original page."
            value={page.text} onChange={event => setPages(items => items.map(item =>
              item.number === selectedPage ? { ...item, text: event.target.value } : item))}/>
          <p className="quiet-note">Tables, values and units may be inaccurate. Compare every clinical value with the original image.</p>
        </div>
      </div>
      <div className="local-report-footer">
        <p className="quiet-note">All edits are temporary. Leaving this chart, refreshing, or clearing discards the report.</p>
        {!confirmClear ? <button className="button secondary" type="button"
          onClick={() => setConfirmClear(true)}>Clear report</button> :
          <div role="group" aria-label="Confirm clear report">
            <span>Discard report and edits? </span>
            <button className="button secondary" type="button" onClick={() => setConfirmClear(false)}>Keep</button>
            <button className="button primary" type="button" onClick={discard}>Yes, clear</button>
          </div>}
      </div>
    </> : null}
  </section>;
}
