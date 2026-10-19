import { useEffect, useMemo, useState, type FormEvent } from 'react';
import type { Firestore } from 'firebase/firestore';
import type { MedicineCode } from '../types';
import {
  removeMedicineCode,
  saveMedicineCode,
  subscribeMedicineCodes,
} from '../services/medicineService';

interface MedicineCodeManagerProps {
  db: Firestore;
  userId: string;
  canManage: boolean;
}

export function MedicineCodeManager({ db, userId, canManage }: MedicineCodeManagerProps) {
  const [codes, setCodes] = useState<MedicineCode[]>([]);
  const [search, setSearch] = useState('');
  const [code, setCode] = useState('');
  const [remedyName, setRemedyName] = useState('');
  const [notes, setNotes] = useState('');
  const [message, setMessage] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    return subscribeMedicineCodes(db, setCodes, (error) => setMessage(error.message));
  }, [db]);

  const filteredCodes = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return codes;
    return codes.filter((item) =>
      `${item.code} ${item.remedyName} ${item.notes ?? ''}`.toLowerCase().includes(term),
    );
  }, [codes, search]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setMessage('');
    try {
      await saveMedicineCode(db, userId, { code, remedyName, notes });
      setCode('');
      setRemedyName('');
      setNotes('');
      setMessage('Medicine code saved.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not save medicine code.');
    } finally {
      setSaving(false);
    }
  }

  async function remove(item: MedicineCode) {
    if (!window.confirm(`Archive code ${item.code}? Existing prescriptions keep the code, but it will stop appearing in new prescriptions, but the historical lookup will remain.`)) {
      return;
    }

    try {
      await removeMedicineCode(db, item.code);
      setMessage(`${item.code} archived. Historical lookup remains available.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not remove medicine code.');
    }
  }

  return (
    <section className="workspace-card glass-panel medicine-manager">
      <div className="section-heading">
        <div>
          <p className="eyebrow">Internal only</p>
          <h2>Medicine code lookup</h2>
          <p className="section-copy">
            The patient-facing prescription contains only these codes. Remedy names remain inside the authenticated workspace.
          </p>
        </div>
        <span className="status-pill">{codes.length} codes</span>
      </div>

      {canManage ? (
        <form className="medicine-code-form" onSubmit={submit}>
          <label>
            Code
            <input required value={code} onChange={(event) => setCode(event.target.value)} placeholder="B1" />
          </label>
          <label>
            Internal medicine name
            <input
              required
              value={remedyName}
              onChange={(event) => setRemedyName(event.target.value)}
              placeholder="Belladonna"
            />
          </label>
          <label>
            Internal note
            <input value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="Optional internal note" />
          </label>
          <button className="button primary" type="submit" disabled={saving}>
            {saving ? 'Saving…' : 'Save code'}
          </button>
        </form>
      ) : null}

      <div className="medicine-search">
        <span aria-hidden="true">⌕</span>
        <input
          placeholder="Lookup B1, B2, Belladonna…"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          aria-label="Search medicine code registry"
        />
      </div>

      <div className="medicine-code-list">
        {filteredCodes.map((item) => (
          <article className="medicine-code-row" key={item.id}>
            <div className={`medicine-code-badge ${item.active ? '' : 'archived'}`}>{item.code}</div>
            <div>
              <strong>{item.remedyName}</strong>
              <span>{item.active ? (item.notes || 'Internal medicine mapping') : `Archived · ${item.notes || 'historical mapping'}`}</span>
            </div>
            {canManage ? (
              <button className="button danger-text" type="button" onClick={() => remove(item)}>
                Delete
              </button>
            ) : null}
          </article>
        ))}
        {!filteredCodes.length ? <div className="empty-list">No medicine codes match this lookup.</div> : null}
      </div>

      {message ? <div className="save-message" role="status">{message}</div> : null}
    </section>
  );
}
