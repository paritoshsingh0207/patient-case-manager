import { useMemo, useState, type FormEvent } from 'react';
import type { CaseInput, SuggestionResult } from '../types';
import { suggestRemedies } from '../lib/remedyEngine';

interface CaseEditorProps {
  patientName: string;
  onSaveCase: (input: CaseInput) => Promise<void>;
  onSaveSuggestion: (input: CaseInput, result: SuggestionResult) => Promise<void>;
}

const initialCase = (): CaseInput => ({
  consultationDate: new Date().toISOString().slice(0, 10),
  chiefComplaint: '',
  duration: '',
  location: '',
  sensation: '',
  modalitiesBetter: '',
  modalitiesWorse: '',
  concomitants: '',
  mentalGenerals: '',
  physicalGenerals: '',
  notes: '',
  status: 'draft',
});

export function CaseEditor({ patientName, onSaveCase, onSaveSuggestion }: CaseEditorProps) {
  const [form, setForm] = useState<CaseInput>(initialCase);
  const [result, setResult] = useState<SuggestionResult | null>(null);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');

  const canAnalyze = useMemo(() => form.chiefComplaint.trim().length > 2, [form.chiefComplaint]);

  function update<K extends keyof CaseInput>(key: K, value: CaseInput[K]) {
    setForm((current) => ({ ...current, [key]: value }));
    setResult(null);
    setMessage('');
  }

  function analyze() {
    const suggestionResult = suggestRemedies(form);
    setResult(suggestionResult);
    setMessage('');
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setMessage('');
    try {
      await onSaveCase({ ...form, status: 'completed' });
      if (result) {
        await onSaveSuggestion(form, result);
      }
      setMessage('Case saved to the patient timeline.');
      setForm(initialCase());
      setResult(null);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not save the case.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="workspace-card case-editor">
      <div className="section-heading">
        <div>
          <p className="eyebrow">New consultation</p>
          <h2>{patientName}</h2>
        </div>
        <span className="status-pill">Practitioner review</span>
      </div>

      <form onSubmit={save}>
        <div className="form-grid two">
          <label>Consultation date<input type="date" value={form.consultationDate} onChange={(e) => update('consultationDate', e.target.value)} /></label>
          <label>Duration<input placeholder="e.g. 3 days, recurrent 6 months" value={form.duration} onChange={(e) => update('duration', e.target.value)} /></label>
        </div>

        <label>Chief complaint<textarea required className="large-textarea" placeholder="Describe the presenting complaint in the patient's own words." value={form.chiefComplaint} onChange={(e) => update('chiefComplaint', e.target.value)} /></label>

        <div className="characteristic-grid">
          <label><span>Location</span><textarea placeholder="Where is it felt? Radiation or direction?" value={form.location} onChange={(e) => update('location', e.target.value)} /></label>
          <label><span>Sensation</span><textarea placeholder="Burning, throbbing, stiffness, pressure…" value={form.sensation} onChange={(e) => update('sensation', e.target.value)} /></label>
          <label><span>Better from</span><textarea placeholder="Rest, pressure, warmth, open air…" value={form.modalitiesBetter} onChange={(e) => update('modalitiesBetter', e.target.value)} /></label>
          <label><span>Worse from</span><textarea placeholder="Motion, light, noise, time of day…" value={form.modalitiesWorse} onChange={(e) => update('modalitiesWorse', e.target.value)} /></label>
          <label><span>Concomitants</span><textarea placeholder="What accompanies the complaint?" value={form.concomitants} onChange={(e) => update('concomitants', e.target.value)} /></label>
          <label><span>Mental generals</span><textarea placeholder="Mood, fears, irritability, anticipation…" value={form.mentalGenerals} onChange={(e) => update('mentalGenerals', e.target.value)} /></label>
        </div>

        <label>Physical generals<textarea placeholder="Thermal preference, thirst, sleep, appetite, energy…" value={form.physicalGenerals} onChange={(e) => update('physicalGenerals', e.target.value)} /></label>
        <label>Practitioner notes<textarea placeholder="Observations, investigations, context, differentials." value={form.notes} onChange={(e) => update('notes', e.target.value)} /></label>

        <div className="clinical-warning">
          <strong>Clinical safety:</strong> This module is decision support only. It does not establish a diagnosis, replace medical evaluation, or validate homeopathy as effective treatment for disease. Emergency red flags block remedy ranking.
        </div>

        <div className="case-actions">
          <button type="button" className="button secondary" onClick={analyze} disabled={!canAnalyze}>Analyze characteristic picture</button>
          <button type="submit" className="button primary" disabled={saving || !canAnalyze}>{saving ? 'Saving…' : 'Save case'}</button>
        </div>
        {message ? <div className="save-message">{message}</div> : null}
      </form>

      {result ? <SuggestionPanel result={result} /> : null}
    </section>
  );
}

function SuggestionPanel({ result }: { result: SuggestionResult }) {
  if (result.blocked) {
    return (
      <div className="suggestion-panel blocked">
        <p className="eyebrow">Safety stop</p>
        <h3>Remedy ranking paused</h3>
        <p>The case text contains language that may indicate an urgent medical problem. Clinical assessment should take priority.</p>
        <ul>{result.redFlags.map((flag) => <li key={flag}>{flag}</li>)}</ul>
      </div>
    );
  }

  if (!result.suggestions.length) {
    return (
      <div className="suggestion-panel">
        <p className="eyebrow">Remedy review</p>
        <h3>No characteristic match yet</h3>
        <p>Add more distinctive modalities, sensations, concomitants, and general symptoms before relying on the ranking.</p>
      </div>
    );
  }

  return (
    <div className="suggestion-panel">
      <div className="section-heading compact">
        <div>
          <p className="eyebrow">Traditional pattern match</p>
          <h3>Candidate remedies</h3>
        </div>
        <span className="quiet-note">Not a prescription</span>
      </div>
      <div className="suggestion-list">
        {result.suggestions.map((suggestion, index) => (
          <article className="remedy-card" key={suggestion.remedy}>
            <div className="rank">{index + 1}</div>
            <div className="remedy-main">
              <div className="remedy-title-row">
                <div><strong>{suggestion.remedy}</strong><span>{suggestion.commonName}</span></div>
                <div className="score">{suggestion.score}%</div>
              </div>
              <div className="score-track"><span style={{ width: `${suggestion.score}%` }} /></div>
              <p>{suggestion.rationale}</p>
              <div className="match-chips">
                {suggestion.matchedCharacteristics.map((item) => <span key={item}>✓ {item}</span>)}
              </div>
              <small>{suggestion.sourceNote}</small>
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}
