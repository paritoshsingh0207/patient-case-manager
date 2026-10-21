import { useEffect, useMemo, useState } from 'react';
import type { Firestore } from 'firebase/firestore';
import type { MedicineCode } from '../types';
import { subscribeMedicineCodes } from '../services/medicineService';

interface MedicineCodeManagerProps { db: Firestore; canManage: boolean }
export function MedicineCodeManager({ db, canManage }: MedicineCodeManagerProps) {
  const [codes,setCodes]=useState<MedicineCode[]>([]);
  const [search,setSearch]=useState('');
  const [message,setMessage]=useState('');
  useEffect(()=>subscribeMedicineCodes(db,setCodes,error=>setMessage(error.message)),[db]);
  const filtered=useMemo(()=>{
    const term=search.trim().toLowerCase();
    if(!term)return codes;
    return codes.filter(item=>[
      item.code,item.remedyName,item.legacyCode,item.traditionalAbbreviation,item.synonymsOrAliases,item.notes,
    ].join(' ').toLowerCase().includes(term));
  },[codes,search]);
  const approvedCount=codes.filter(x=>x.active&&x.approvedForNewRx&&x.expertVerified).length;
  return <section className="workspace-card glass-panel medicine-manager">
    <div className="section-heading">
      <div>
        <p className="eyebrow">Spark plan · authenticated medicine dictionary</p>
        <h2>Expert-verified medicine registry</h2>
        <p className="section-copy">Only approved alphabetical codes are prescribed. Historical B-series codes remain available for lookup and are never reused.</p>
      </div>
      <span className="status-pill">{approvedCount} approved / {codes.length} total</span>
    </div>
    {canManage ? <div className="admin-readonly-note">
      <strong>Registry changes are offline-only on Spark.</strong>
      <p>Run the local, authenticated administrator script <code>functions/scripts/import-verified-medicines.cjs</code> to import the approved 881-entry JSON file.
      The browser cannot create, rename, reactivate, or delete medicine-code mappings.</p>
    </div> : null}
    <div className="medicine-search">
      <span aria-hidden="true">⌕</span>
      <input aria-label="Search medicine code registry" placeholder="Search AB1, BE1, B1, Belladonna…" value={search} onChange={event=>setSearch(event.target.value)}/>
    </div>
    <div className="medicine-code-list">
      {filtered.slice(0,150).map(item=><article className="medicine-code-row" key={item.id}>
        <div className={'medicine-code-badge '+(item.active&&item.approvedForNewRx?'':'archived')}>{item.code}</div>
        <div>
          <strong>{item.remedyName}</strong>
          <span>{item.legacyCode?'Legacy: '+item.legacyCode+' · ':''}{item.active&&item.approvedForNewRx?'Approved for new Rx':'Historical / inactive only'}</span>
        </div>
      </article>)}
      {filtered.length>150 ? <p className="quiet-note">Showing the first 150 of {filtered.length}. Narrow by name or code.</p> : null}
      {!filtered.length?<div className="empty-list">No matching codes. An administrator must import the approved release before prescribing.</div>:null}
    </div>
    {message?<div className="save-message" role="alert">{message}</div>:null}
  </section>;
}
