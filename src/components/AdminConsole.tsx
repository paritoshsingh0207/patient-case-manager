import {useEffect,useMemo,useState,type FormEvent} from 'react';
import type {FirebaseApp} from 'firebase/app';
import type {Firestore} from 'firebase/firestore';
import type {DoctorProfile,Patient,PractitionerAccess} from '../types';
import {setDoctorActive,setPatientDoctors,subscribeAdmins,subscribeDoctors} from '../services/adminService';
import {createAdministratorAccount} from '../services/adminProvisioningService';

interface Props {db:Firestore;patients:Patient[];adminUid:string;firebaseApp:FirebaseApp;}
export function AdminConsole({db,patients,adminUid,firebaseApp}:Props) {
  const [doctors,setDoctors]=useState<DoctorProfile[]>([]);
  const [admins,setAdmins]=useState<PractitionerAccess[]>([]);
  const [error,setError]=useState('');
  const [message,setMessage]=useState('');
  const [search,setSearch]=useState('');
  const [statusFilter,setStatusFilter]=useState<'all'|'pending'|'active'|'inactive'>('all');
  const [busyUid,setBusyUid]=useState<string|null>(null);
  const [showAddAdmin,setShowAddAdmin]=useState(false);
  const [creatingAdmin,setCreatingAdmin]=useState(false);
  const [newAdmin,setNewAdmin]=useState({fullName:'',email:'',temporaryPassword:'',confirmation:''});
  const [selectedPatientId,setSelectedPatientId]=useState('');
  const [selectedDoctorIds,setSelectedDoctorIds]=useState<string[]>([]);
  const [savingAccess,setSavingAccess]=useState(false);

  useEffect(()=>subscribeDoctors(db,setDoctors,e=>setError(e.message)),[db]);
  useEffect(()=>subscribeAdmins(db,setAdmins,e=>setError(e.message)),[db]);
  const registered=useMemo(()=>doctors.filter(d=>!d.deleted),[doctors]);
  const pending=registered.filter(d=>d.pending);
  const active=registered.filter(d=>d.active);
  const inactive=registered.filter(d=>!d.active&&!d.pending);
  const displayed=registered.filter(d=>{
    const needle=search.trim().toLowerCase();
    const matches=!needle||[d.displayName,d.email,d.uid].join(' ').toLowerCase().includes(needle);
    const status=statusFilter==='all'||(statusFilter==='pending'&&d.pending)
      ||(statusFilter==='active'&&d.active)||(statusFilter==='inactive'&&!d.active&&!d.pending);
    return matches&&status;
  }).sort((a,b)=>Number(Boolean(b.pending))-Number(Boolean(a.pending)));
  const selectedPatient=patients.find(p=>p.id===selectedPatientId)??null;
  const assignedCounts=useMemo(()=>new Map(doctors.map(d=>[
    d.uid,patients.filter(p=>p.doctorIds.includes(d.uid)).length,
  ])),[doctors,patients]);
  useEffect(()=>{
    if(!selectedPatientId||!patients.some(p=>p.id===selectedPatientId))
      setSelectedPatientId(patients[0]?.id??'');
  },[patients,selectedPatientId]);
  useEffect(()=>setSelectedDoctorIds(selectedPatient?.doctorIds??[]),[selectedPatient]);
  function clearMessages(){setMessage('');setError('');}

  async function changeStatus(doctor:DoctorProfile) {
    const next=!doctor.active;
    const label=doctor.pending?'Approve and activate':next?'Reactivate':'Deactivate';
    const warning=next
      ?'This doctor will gain access to their assigned patients after email verification.'
      :'The doctor will immediately lose access. Their records will be retained.';
    if(!window.confirm(label+' '+doctor.displayName+'? '+warning))return;
    clearMessages();setBusyUid(doctor.uid);
    try{
      await setDoctorActive(db,{uid:doctor.uid,active:next,adminUid});
      setMessage(next?'Doctor account activated.':'Doctor account deactivated.');
    }catch(e){setError(e instanceof Error?e.message:'Unable to update doctor account.');}
    finally{setBusyUid(null);}
  }

  async function createAdmin(event:FormEvent) {
    event.preventDefault();clearMessages();
    if(newAdmin.temporaryPassword!==newAdmin.confirmation){setError('Passwords do not match.');return;}
    if(!window.confirm('Create a new administrator account for '+newAdmin.email+'? This account will be able to manage all clinic data after email verification.'))return;
    setCreatingAdmin(true);
    try{
      const result=await createAdministratorAccount(firebaseApp,db,{
        fullName:newAdmin.fullName,email:newAdmin.email,
        temporaryPassword:newAdmin.temporaryPassword,adminUid,
      });
      setMessage('Administrator created for '+result.email+'. '+(result.verificationSent
        ?'A verification email was sent.':'They must request email verification on first login.'));
      setNewAdmin({fullName:'',email:'',temporaryPassword:'',confirmation:''});
      setShowAddAdmin(false);
    }catch(e){setError(e instanceof Error?e.message:'Unable to create administrator account.');}
    finally{setCreatingAdmin(false);}
  }

  function toggleDoctor(uid:string){
    setSelectedDoctorIds(ids=>ids.includes(uid)?ids.filter(x=>x!==uid):[...ids,uid]);
  }
  async function saveAccess(){
    if(!selectedPatient)return;
    const unknown=selectedDoctorIds.some(uid=>!registered.some(d=>d.uid===uid));
    if(unknown){setError('An assigned doctor could not be found. Check this patient’s existing assignments first.');return;}
    clearMessages();setSavingAccess(true);
    try{
      await setPatientDoctors(db,{patientId:selectedPatient.id,doctorIds:selectedDoctorIds});
      setMessage('Patient assignments saved.');
    }catch(e){setError(e instanceof Error?e.message:'Unable to save assignments.');}
    finally{setSavingAccess(false);}
  }

  return <div className="admin-console">
    <section className="workspace-card glass-panel admin-section">
      <div className="section-heading admin-doctor-heading"><div><h2>Doctors</h2>
        <p className="section-copy">Review registrations and manage doctor access.</p></div></div>
      <div className="admin-doctor-summary">
        <div><strong>{pending.length}</strong><span>Pending approval</span></div>
        <div><strong>{active.length}</strong><span>Active</span></div>
        <div><strong>{inactive.length}</strong><span>Inactive</span></div>
      </div>
      <div className="admin-doctor-filters">
        <input type="search" aria-label="Search doctors" placeholder="Search doctors"
          value={search} onChange={e=>setSearch(e.target.value)}/>
        <select aria-label="Filter doctor status" value={statusFilter}
          onChange={e=>setStatusFilter(e.target.value as typeof statusFilter)}>
          <option value="all">All statuses</option>
          <option value="pending">Pending</option>
          <option value="active">Active</option>
          <option value="inactive">Inactive</option>
        </select>
      </div>
      <div className="doctor-list">
        {displayed.map(d=><article className="doctor-row admin-doctor-row" key={d.uid}>
          <div className="avatar">{d.displayName.slice(0,2).toUpperCase()}</div>
          <div className="admin-doctor-identity">
            <strong>{d.displayName}</strong><span>{d.email}</span>
            <small>{assignedCounts.get(d.uid)??0} assigned patient(s)</small>
          </div>
          <span className={'doctor-status '+(d.active?'':d.pending?'pending':'inactive')}>
            {d.active?'Active':d.pending?'Pending':'Inactive'}
          </span>
          <button className={'button secondary admin-status-button '+(d.active?'danger-text':'')}
            type="button" disabled={busyUid===d.uid}
            onClick={()=>changeStatus(d)}>
            {busyUid===d.uid?'Saving…':d.active?'Deactivate':d.pending?'Activate doctor':'Reactivate'}
          </button>
        </article>)}
        {!displayed.length?<div className="empty-list">
          {registered.length?'No matching doctors.':'No doctor registrations yet.'}
        </div>:null}
      </div>
    </section>
    <section className="workspace-card glass-panel admin-section">
      <div className="section-heading"><div><h2>Patient assignments</h2>
        <p className="section-copy">Assign or remove doctors from a patient’s care team.</p></div></div>
      <label className="patient-access-select">Patient
        <select value={selectedPatientId} onChange={e=>setSelectedPatientId(e.target.value)}>
          <option value="">Select patient</option>
          {patients.map(p=><option key={p.id} value={p.id}>{p.firstName} {p.lastName}</option>)}
        </select>
      </label>
      {selectedPatient?<><div className="access-doctor-grid">
        {registered.map(d=>{
          const chosen=selectedDoctorIds.includes(d.uid);
          return <label className={'access-doctor-card '+(chosen?'selected':'')} key={d.uid}>
            <input type="checkbox" checked={chosen} disabled={!d.active&&!chosen}
              onChange={()=>toggleDoctor(d.uid)}/>
            <span className="avatar">{d.displayName.slice(0,2).toUpperCase()}</span>
            <span><strong>{d.displayName}{!d.active?' (inactive)':''}</strong>
              <small>{d.email}</small></span>
          </label>;
        })}
      </div>
      {selectedDoctorIds.some(uid=>!registered.some(d=>d.uid===uid))
        ?<div className="inline-error" role="alert">This patient has unknown doctor assignments. Check those records before saving.</div>
        :null}
      <div className="admin-actions"><span className="quiet-note">{selectedDoctorIds.length} assigned</span>
        <button className="button primary" type="button"
          disabled={savingAccess||selectedDoctorIds.length>20||
            selectedDoctorIds.some(uid=>!registered.some(d=>d.uid===uid))}
          onClick={saveAccess}>{savingAccess?'Saving…':'Save assignments'}</button>
      </div></>:<div className="empty-list">No patient selected.</div>}
    </section>
    <section className="workspace-card glass-panel admin-section admin-admin-section">
      <div className="section-heading admin-doctor-heading">
        <div><h2>Administrators</h2>
          <p className="section-copy">Create and manage administrator login accounts.</p></div>
        <button type="button" className="button secondary"
          onClick={()=>setShowAddAdmin(x=>!x)}>{showAddAdmin?'Cancel':'Add administrator'}</button>
      </div>
      <div className="doctor-list">
        {admins.map(a=><article className="doctor-row admin-doctor-row" key={a.uid}>
          <div className="avatar">{(a.displayName||'A').slice(0,2).toUpperCase()}</div>
          <div className="admin-doctor-identity"><strong>{a.displayName||'Administrator'}</strong>
            <span>{a.email||'No email listed'}</span></div>
          <span className={'doctor-status '+(a.active?'':'inactive')}>{a.active?'Active':'Inactive'}</span>
        </article>)}
      </div>
      {showAddAdmin?<form className="admin-add-doctor" onSubmit={createAdmin}>
        <h3>New administrator</h3>
        <label>Full name<input required minLength={2} maxLength={120} autoComplete="off"
          value={newAdmin.fullName} onChange={e=>setNewAdmin({...newAdmin,fullName:e.target.value})}/></label>
        <label>Email address<input type="email" required autoComplete="off"
          value={newAdmin.email} onChange={e=>setNewAdmin({...newAdmin,email:e.target.value})}/></label>
        <label>Temporary password<input type="password" required minLength={12}
          autoComplete="new-password" value={newAdmin.temporaryPassword}
          onChange={e=>setNewAdmin({...newAdmin,temporaryPassword:e.target.value})}/></label>
        <label>Confirm temporary password<input type="password" required minLength={12}
          autoComplete="new-password" value={newAdmin.confirmation}
          onChange={e=>setNewAdmin({...newAdmin,confirmation:e.target.value})}/></label>
        <p className="section-copy">The new administrator will need to verify their email before accessing records. Share their temporary password privately and ask them to reset it.</p>
        <button className="button primary" disabled={creatingAdmin} type="submit">
          {creatingAdmin?'Creating…':'Create administrator'}</button>
      </form>:null}
    </section>
    {error?<div className="inline-error admin-message" role="alert">{error}</div>:null}
    {message?<div className="save-message admin-message" role="status">{message}</div>:null}
  </div>;
}
