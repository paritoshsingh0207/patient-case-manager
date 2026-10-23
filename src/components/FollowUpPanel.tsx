import {useEffect,useMemo,useState,type FormEvent} from 'react';
import type {Firestore} from 'firebase/firestore';
import {completeFollowUp,createFollowUp,subscribeFollowUps,type ClinicalFollowUp} from '../services/followUpService';

export function FollowUpPanel({db,patientId,userId,canManage}:{
 db:Firestore;patientId:string;userId:string;canManage:boolean;
}) {
 const [records,setRecords]=useState<ClinicalFollowUp[]>([]);
 const [dueDate,setDueDate]=useState('');
 const [reason,setReason]=useState('');
 const [error,setError]=useState('');
 const [busy,setBusy]=useState(false);
 const [pendingId,setPendingId]=useState<string|null>(null);
 const [loading,setLoading]=useState(true);
 useEffect(()=>{
  setRecords([]);setLoading(true);setError('');
  return subscribeFollowUps(db,patientId,(next)=>{setRecords(next);setLoading(false)},e=>{setError(e.message);setLoading(false)});
 },[db,patientId]);
 const today=new Date(Date.now()-new Date().getTimezoneOffset()*60000).toISOString().slice(0,10);
 const pending=useMemo(()=>records.filter(x=>x.status==='open'),[records]);
 async function save(e:FormEvent) {
  e.preventDefault();setBusy(true);setError('');
  try {await createFollowUp(db,{patientId,userId,dueDate,reason});setDueDate('');setReason('')}
  catch(e){setError(e instanceof Error?e.message:'Could not record follow-up')}
  finally{setBusy(false)}
 }
 async function finish(record:ClinicalFollowUp){
  if(!window.confirm('Mark this clinical follow-up as completed?'))return;
  setPendingId(record.id);setError('');
  try {await completeFollowUp(db,{patientId,userId,followUpId:record.id})}
  catch(e){setError(e instanceof Error?e.message:'Could not complete follow-up')}
  finally{setPendingId(null)}
 }
 return <section className="workspace-card glass-panel followup-panel">
  <div className="section-heading"><div><h2>Clinical follow-ups</h2>
   <p className="section-copy">Track review dates and clinical tasks for this patient.</p></div>
   <span className="status-pill">{pending.length} open</span>
  </div>
  {canManage?<form className="followup-form" onSubmit={save}>
   <label>Review due date<input type="date" required value={dueDate} onChange={e=>setDueDate(e.target.value)}/></label>
   <label>Reason / clinical task<textarea required maxLength={500} value={reason} onChange={e=>setReason(e.target.value)}
    placeholder="What should be reviewed at the next consultation?"/></label>
   <button className="button primary" type="submit" disabled={busy}>{busy?'Saving…':'Save follow-up'}</button>
  </form>:null}
  {error?<div className="inline-error" role="alert">{error}</div>:null}
  <div className="followup-list">
   {records.map(item=><article className="followup-row" key={item.id}>
    <div><strong>{item.dueDate||'Date not recorded'} {item.status==='open'&&item.dueDate<today?' · Overdue':''}</strong>
     <p>{item.reason||'Reason not recorded'}</p>
     <small>{item.status==='completed'?'Completed':'Open'}</small>
    </div>
    {canManage&&item.status==='open'?<button className="button secondary" type="button"
     disabled={pendingId===item.id} onClick={()=>finish(item)}>
     {pendingId===item.id?'Updating…':'Mark complete'}</button>:null}
   </article>)}
   {loading?<div className="empty-list">Loading follow-ups…</div>:null}
   {!loading&&!records.length?<div className="empty-list">No follow-ups have been recorded for this patient.</div>:null}
  </div>
 </section>;
}
