import { useMemo, useState, type FormEvent } from 'react';
import type { CaseInput, CaseRecord, SuggestionResult } from '../types';
import { suggestRemedies } from '../lib/remedyEngine';

interface CaseEditorProps {
  patientName: string;
  previousCases: CaseRecord[];
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
  visitType:'initial',assessment:'',carePlan:'',followUpAdvice:'',
  weightKg:'',temperatureC:'',pulseBpm:'',systolicBp:'',diastolicBp:'',
  status: 'draft',
});

export function CaseEditor({ patientName, previousCases, onSaveCase, onSaveSuggestion }: CaseEditorProps) {
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

  function reusePreviousContext() {
    const prior=previousCases[0];
    if(!prior)return;
    if(!window.confirm('Copy observations from the previous consultation into a NEW draft? Review every field before saving. The signed record will not change.'))return;
    setForm(current=>({...current,visitType:'follow-up',
      chiefComplaint:prior.chiefComplaint,
      location:prior.location??'',sensation:prior.sensation??'',
      modalitiesBetter:prior.modalitiesBetter??'',modalitiesWorse:prior.modalitiesWorse??'',
      concomitants:prior.concomitants??'',mentalGenerals:prior.mentalGenerals??'',
      physicalGenerals:prior.physicalGenerals??'',
    }));
    setResult(null);
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

      {previousCases.length ? <div className="case-comparison">
        <h3>Previous consultations</h3>
        <div className="case-compare-grid">
          {previousCases.slice(0,2).map(prior=><article key={prior.id} className="case-compare-card">
            <strong>{prior.consultationDate} · {prior.visitType==='follow-up'?'Follow-up':'Consultation'}</strong>
            <p><b>Complaint:</b> {prior.chiefComplaint}</p>
            {prior.assessment?<p><b>Assessment:</b> {prior.assessment}</p>:null}
            {prior.carePlan?<p><b>Plan:</b> {prior.carePlan}</p>:null}
            {(prior.weightKg||prior.temperatureC||prior.pulseBpm||prior.systolicBp)?<p>
              <b>Vitals:</b> {[
                prior.weightKg?`${prior.weightKg} kg`:null,
                prior.temperatureC?`${prior.temperatureC} °C`:null,
                prior.pulseBpm?`${prior.pulseBpm} bpm`:null,
                prior.systolicBp&&prior.diastolicBp?`${prior.systolicBp}/${prior.diastolicBp} mmHg`:null,
              ].filter(Boolean).join(' · ')}</p>:null}
          </article>)}
        </div>
        <button type="button" className="button secondary" onClick={reusePreviousContext}>Use previous observations as a new draft</button>
      </div>:null}
      <form onSubmit={save}>
        <div className="form-grid two">
          <label>Consultation type
            <select value={form.visitType||'initial'} onChange={e=>update('visitType',e.target.value as 'initial'|'follow-up')}>
              <option value="initial">Initial assessment</option><option value="follow-up">Follow-up review</option>
            </select>
          </label>
        </div>
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
        <div className="case-structured-panel">
          <h3>Clinical observations</h3>
          <div className="case-vitals-grid">
            <label>Weight (kg)<input type="number" min="0" max="400" step="0.1"
              value={form.weightKg||''} onChange={e=>update('weightKg',e.target.value)}/></label>
            <label>Temperature (°C)<input type="number" min="25" max="45" step="0.1"
              value={form.temperatureC||''} onChange={e=>update('temperatureC',e.target.value)}/></label>
            <label>Pulse (beats/min)<input type="number" min="20" max="250"
              value={form.pulseBpm||''} onChange={e=>update('pulseBpm',e.target.value)}/></label>
            <label>Systolic BP (mmHg)<input type="number" min="40" max="300"
              value={form.systolicBp||''} onChange={e=>update('systolicBp',e.target.value)}/></label>
            <label>Diastolic BP (mmHg)<input type="number" min="20" max="200"
              value={form.diastolicBp||''} onChange={e=>update('diastolicBp',e.target.value)}/></label>
          </div>
          <p className="quiet-note">Record measurements taken clinically; no values or diagnoses are inferred.</p>
          <label>Clinical assessment<textarea value={form.assessment||''}
            onChange={e=>update('assessment',e.target.value)} placeholder="Findings, assessment, differential considerations"/></label>
          <label>Care plan<textarea value={form.carePlan||''}
            onChange={e=>update('carePlan',e.target.value)} placeholder="Investigations, referrals and clinically reviewed management plan"/></label>
          <label>Follow-up advice<textarea value={form.followUpAdvice||''}
            onChange={e=>update('followUpAdvice',e.target.value)} placeholder="Planned reassessment and warning signs"/></label>
        </div>
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
