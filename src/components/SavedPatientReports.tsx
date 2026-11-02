import { useEffect, useState } from 'react';
import type { Firestore } from 'firebase/firestore';
import {
  subscribeSavedPatientReports, type SavedPatientReport,
} from '../services/reportService';
import './LocalReportParser.css';

export function SavedPatientReports({ db, patientId }: {
  db: Firestore; patientId: string;
}) {
  const [reports, setReports] = useState<SavedPatientReport[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    setReports([]);
    setSelectedId(null);
    setLoading(true);
    setError('');
    return subscribeSavedPatientReports(db, patientId,
      next => { setReports(next); setLoading(false); setError(''); },
      () => {
        setReports([]);
        setSelectedId(null);
        setLoading(false);
        setError('Unable to load reports. Check your patient access and connection.');
      });
  }, [db, patientId]);

  const current = reports.find(item => item.id === selectedId) ?? reports[0];

  return <section className="workspace-card glass-panel local-report" aria-label="Saved medical report text">
    <div className="section-heading">
      <div>
        <h2>Saved Reports</h2>
        <p className="section-copy">Clinician-reviewed transcriptions saved in this patient's private Firestore record.
          Original PDFs and scan images are not stored.</p>
      </div>
      <span className="status-pill">{reports.length} saved</span>
    </div>
    {error ? <p className="inline-error" role="alert">{error}</p> : null}
    {loading ? <div className="empty-list">Loading saved reports…</div> : null}
    {!loading && !error && !reports.length ?
      <div className="empty-list">No reports have been saved for this patient.</div> : null}
    {current ? <div className="saved-report-layout">
      <div className="saved-report-list" aria-label="Reports for this patient">
        {reports.map(item => <button key={item.id} type="button"
          className={'saved-report-item' + (current.id === item.id ? ' selected' : '')}
          aria-current={current.id === item.id ? 'true' : undefined}
          onClick={() => setSelectedId(item.id)}>
          <strong>{item.reportName}</strong>
          <small>{item.createdAt?.toLocaleString() || 'Saving…'} · {item.pageCount} page(s)</small>
        </button>)}
      </div>
      <article className="saved-report-detail">
        <h3>{current.reportName}</h3>
        <p className="quiet-note">Saved {current.createdAt?.toLocaleString() || 'recently'} · {current.pageCount} page(s)
          {current.ocrUsed ? ' · Contains OCR text' : ''}</p>
        <p className="inline-notice">Transcription only. Values, units and OCR text may be inaccurate.
          Verify against the original laboratory report before clinical decisions.</p>
        <pre className="saved-report-text">{current.content}</pre>
      </article>
    </div> : null}
  </section>;
}
