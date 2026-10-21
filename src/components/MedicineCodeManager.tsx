import { useEffect, useMemo, useState, type ChangeEvent, type FormEvent } from 'react';
import type { Firestore } from 'firebase/firestore';
import type { Functions } from 'firebase/functions';
import type { MedicineCode } from '../types';
import { parseVerifiedMedicineJson, type VerifiedImport } from '../lib/verifiedMedicineImport';
import { archiveVerifiedMedicine, importVerifiedMedicineCodes, registerVerifiedMedicine, subscribeMedicineCodes } from '../services/medicineService';

interface MedicineCodeManagerProps { db: Firestore; functions: Functions; canManage: boolean; }
export function MedicineCodeManager({ db, functions, canManage }: MedicineCodeManagerProps) {
  const [codes,setCodes] = useState<MedicineCode[]>([]);
  const [search,setSearch] = useState('');
  const [code,setCode] = useState('');
  const [remedyName,setRemedyName] = useState('');
  const [notes,setNotes] = useState('');
  const [manualApproved,setManualApproved] = useState(false);
  const [registry,setRegistry] = useState<VerifiedImport | null>(null);
  const [importConfirmed,setImportConfirmed] = useState(false);
  const [message,setMessage] = useState('');
  const [saving,setSaving] = useState(false);
  useEffect(() => subscribeMedicineCodes(db,setCodes,error => setMessage(error.message)),[db]);
  const filtered = useMemo(() => {
    const term=search.trim().toLowerCase();
    if(!term) return codes;
    return codes.filter(item => [item.code,item.remedyName,item.legacyCode,item.traditionalAbbreviation,item.synonymsOrAliases,item.notes].join(' ').toLowerCase().includes(term));
  },[codes,search]);
  const approvedCount = codes.filter(item=>item.active&&item.approvedForNewRx).length;
  async function chooseRegistry(event: ChangeEvent<HTMLInputElement>) {
    setRegistry(null);setImportConfirmed(false);setMessage('');
    const file=event.target.files?.[0];
    if(!file) return;
    if(file.size>3_000_000) {setMessage('File is too large. Select the official registry JSON export.');return;}
    try{
      const parsed=parseVerifiedMedicineJson(await file.text());
      setRegistry(parsed);
      setMessage('Validated 881 unique codes locally. Confirm clinical authorization to import.');
    }catch(error){setMessage(error instanceof Error?error.message:'Could not read JSON.');}
  }
  async function runImport() {
    if(!registry || !importConfirmed)return;
    setSaving(true);setMessage('Importing and checking existing mappings. Do not submit again until this request finishes.');
    try {
      const result=await importVerifiedMedicineCodes(functions,registry);
      setMessage('Imported '+result.imported+' expert-approved medicines: '+result.created+' new, '+result.reapproved+' existing mappings reapproved. Codes were not renumbered.');
      setRegistry(null);setImportConfirmed(false);
    }catch(error){setMessage(error instanceof Error?error.message:'Import failed. The import can be retried safely.');}
    finally{setSaving(false);}
  }
  async function addCode(event: FormEvent){
    event.preventDefault();if(!manualApproved)return;
    setSaving(true);setMessage('');
    try{
      const result=await registerVerifiedMedicine(functions,{code,remedyName,notes});
      setMessage('Registered approved code '+result.code+'. Existing codes cannot be overwritten.');
      setCode('');setRemedyName('');setNotes('');setManualApproved(false);
    }catch(error){setMessage(error instanceof Error?error.message:'Unable to register medicine.');}
    finally{setSaving(false);}
  }
  async function archive(item: MedicineCode) {
    if (!window.confirm('Archive '+item.code+'? It will remain in historical lookups, but cannot be used in new prescriptions.')) return;
    try{await archiveVerifiedMedicine(functions,item.code);setMessage(item.code+' archived.');}
    catch(error){setMessage(error instanceof Error?error.message:'Could not archive code.');}
  }
  return <section className="workspace-card glass-panel medicine-manager">
    <div className="section-heading">
      <div>
        <p className="eyebrow">Authenticated clinic registry</p>
        <h2>Expert-verified medicine dictionary</h2>
        <p className="section-copy">Dictionary-style alphabetical codes identify each medicine. Legacy codes remain as lookup references; codes are never reassigned.</p>
      </div>
      <span className="status-pill">{approvedCount} approved / {codes.length} total</span>
    </div>
    {canManage ? <>
      <div className="registry-import-box">
        <h3>Import verified medicine master v1</h3>
        <p className="quiet-note">Select the 881-entry JSON staging export. The original file may say "active: false"; confirmed clinical authorization on this screen enables verified codes after server validation.</p>
        <label>Verified JSON file
          <input type="file" accept=".json,application/json" onChange={chooseRegistry} disabled={saving}/>
        </label>
        {registry ? <>
          <p><strong>{registry.documents.length} medicines validated</strong> · Release {registry.releaseVersion}</p>
          <label className="registry-approval">
            <input type="checkbox" checked={importConfirmed} onChange={event=>setImportConfirmed(event.target.checked)}/>
            I confirm expert verification and authorize these medicine codes for clinical dispensing.
          </label>
          <button type="button" className="button primary" disabled={!importConfirmed||saving} onClick={runImport}>
            {saving?'Import in progress…':'Import 881 approved medicines'}
          </button>
        </>:null}
      </div>
      <form className="medicine-code-form" onSubmit={addCode}>
        <label>New code<input required value={code} onChange={event=>setCode(event.target.value)} placeholder="AB6"/></label>
        <label>Medicine name<input required value={remedyName} onChange={event=>setRemedyName(event.target.value)} placeholder="Medicine starting AB…"/></label>
        <label>Internal note<input value={notes} onChange={event=>setNotes(event.target.value)} placeholder="Optional reference"/></label>
        <button className="button secondary" type="submit" disabled={saving||!manualApproved}>Create code</button>
        <label className="registry-approval registry-manual-approval">
          <input type="checkbox" checked={manualApproved} onChange={event=>setManualApproved(event.target.checked)}/>
          I confirm this additional medicine and code have expert approval and are authorized for clinical use.
        </label>
      </form>
    </>:null}
    <div className="medicine-search">
      <span aria-hidden="true">⌕</span>
      <input aria-label="Search code, name or legacy code" placeholder="Search AB1, BE1, B1, Belladonna…" value={search} onChange={event=>setSearch(event.target.value)}/>
    </div>
    <div className="medicine-code-list">
      {filtered.slice(0,150).map(item=><article className="medicine-code-row" key={item.id}>
        <div className={'medicine-code-badge '+(item.active&&item.approvedForNewRx?'':'archived')}>{item.code}</div>
        <div>
          <strong>{item.remedyName}</strong>
          <span>{item.legacyCode?'Legacy: '+item.legacyCode+' · ':''}{item.traditionalAbbreviation?item.traditionalAbbreviation+' · ':''}{item.active&&item.approvedForNewRx?'Approved for new Rx':'Inactive / historical only'}</span>
        </div>
        {canManage && item.active ? <button className="button danger-text" type="button" onClick={()=>archive(item)}>Archive</button>:null}
      </article>)}
      {filtered.length>150?<p className="quiet-note">Showing 150 of {filtered.length} matching codes. Search by code or name to narrow results.</p>:null}
      {!filtered.length?<div className="empty-list">No medicine codes match this lookup. Administrators can import the verified registry.</div>:null}
    </div>
    {message?<div className="save-message" role="status">{message}</div>:null}
  </section>;
}
