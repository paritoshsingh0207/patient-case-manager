import { useMemo } from 'react';
import type { Patient } from '../types';
import { findDuplicatePairs } from '../lib/patientDuplicates';

export function DuplicateReviewPanel({ patients, onOpenPatient }: {
  patients: Patient[];
  onOpenPatient: (patientId: string) => void;
}) {
  const pairs = useMemo(() => findDuplicatePairs(patients, 50), [patients]);
  return (
    <details className="workspace-card glass-panel duplicate-review" open={pairs.length > 0}>
      <summary>
        <strong>Possible duplicate patient charts</strong>
        <span className="status-pill">{pairs.length}{pairs.length === 50 ? '+' : ''} pairs</span>
      </summary>
      <p className="section-copy">
        Administrator-only review across the clinic directory. A match is a warning,
        not proof that records belong to one person. Compare identity details and
        clinical history before deciding how to proceed. No charts are automatically
        combined or deleted.
      </p>
      {!pairs.length ? <p className="quiet-note">No potential duplicate pairs found with the available details.</p> : null}
      <div className="duplicate-review-list">
        {pairs.map(pair => (
          <div className="duplicate-review-row" key={[pair.first.id,pair.second.id].sort().join(':')}>
            <div>
              <strong>{pair.first.firstName} {pair.first.lastName} / {pair.second.firstName} {pair.second.lastName}</strong>
              <small>{pair.reasons.join(' · ')}</small>
            </div>
            <div className="duplicate-review-actions">
              <button type="button" className="button secondary" onClick={() => onOpenPatient(pair.first.id)}>
                Open first chart
              </button>
              <button type="button" className="button secondary" onClick={() => onOpenPatient(pair.second.id)}>
                Open second chart
              </button>
            </div>
          </div>
        ))}
      </div>
      {pairs.length === 50 ? <p className="quiet-note">Showing the first 50 possible pairs. Review and resolve identity questions with the clinic administrator.</p> : null}
    </details>
  );
}
