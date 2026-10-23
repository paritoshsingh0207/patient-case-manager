import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { collection, onSnapshot, query, where } from 'firebase/firestore';
import type { Firestore } from 'firebase/firestore';
import type { DoctorProfile, Patient } from '../types';
import { registerDoctorProfile, setDoctorActive, setPatientDoctors, subscribeDoctors } from '../services/adminService';
import { inviteAdministrator } from '../services/provisioningService';

interface AdminConsoleProps {db:Firestore;patients:Patient[];adminUid:string;}
export function AdminConsole({db,patients,adminUid}:AdminConsoleProps) {
  const [doctors,setDoctors]=useState<DoctorProfile[]>([]);
  const [admins,setAdmins]=useState<{uid:string;displayName:string;email:string}[]>([]);
  const [showAdmin,setShowAdmin]=useState(false);
  const [adminDraft,setAdminDraft]=useState({displayName:'',email:''});
  const [message,setMessage]=useState('');
  const [error,setError]=useState('');
  const [search,setSearch]=useState('');
  const [statusFilter,setStatusFilter]=useState<'all'|'active'|'inactive'>('all');
  const [showAdd,setShowAdd]=useState(false);
  const [draft,setDraft]=useState({uid:'',displayName:'',email:''});
  const [confirmedAuthUid,setConfirmedAuthUid]=useState(false);
  const [creating,setCreating]=useState(false);
  const [busyUid,setBusyUid]=useState<string|null>(null);
  const [selectedPatientId,setSelectedPatientId]=useState('');
  const [selectedDoctorIds,setSelectedDoctorIds]=useState<string[]>([]);
  const [savingAccess,setSavingAccess]=useState(false);

  useEffect(()=>subscribeDoctors(db,setDoctors,err=>setError(err.message)),[db]);
  useEffect(()=>onSnapshot(query(collection(db,'users'),where('role','==','admin')),snap=>
    setAdmins(snap.docs.map(d=>({uid:d.id,displayName:String(d.data().displayName||'Administrator'),email:String(d.data().email||'')}))),err=>setError(err.message)),[db]);
  const visibleDoctors=useMemo(()=>doctors.filter(d=>{
    if(d.deleted)return false;
    const match=!search.trim()||[d.displayName,d.email,d.uid].join(' ').toLowerCase().includes(search.trim().toLowerCase());
    return match&&(statusFilter==='all'||(statusFilter==='active'?d.active:!d.active));
  }),[doctors,search,statusFilter]);
  const availableDoctors=useMemo(()=>doctors.filter(d=>!d.deleted),[doctors]);
  const activeDoctors=availableDoctors.filter(d=>d.active);
  const inactiveDoctors=availableDoctors.filter(d=>!d.active);
  const pendingDoctors=inactiveDoctors.filter(d=>d.pending);
  const selectedPatient=patients.find(x=>x.id===selectedPatientId)??null;
  const assignedCounts=useMemo(()=>new Map(doctors.map(d=>[
    d.uid,patients.filter(p=>p.doctorIds.includes(d.uid)).length,
  ])),[doctors,patients]);
  useEffect(()=>{
    if(!selectedPatientId||!patients.some(p=>p.id===selectedPatientId))setSelectedPatientId(patients[0]?.id??'');
  },[patients,selectedPatientId]);
  useEffect(()=>setSelectedDoctorIds(selectedPatient?.doctorIds??[]),[selectedPatient]);

  async function addDoctor(event:FormEvent) {
    event.preventDefault();if(!confirmedAuthUid)return;
    setCreating(true);setError('');setMessage('');
    try {
      await registerDoctorProfile(db,{...draft,adminUid});
      setMessage('Doctor profile added. They can now sign in using their existing Firebase Authentication credentials.');
      setDraft({uid:'',displayName:'',email:''});setConfirmedAuthUid(false);setShowAdd(false);
    }catch(e){setError(e instanceof Error?e.message:'Could not add doctor profile. Check UID and existing records.');}
    finally{setCreating(false);}
  }
  async function addAdmin(event:FormEvent) {
    event.preventDefault();setCreating(true);setError('');setMessage('');
    try {
      if(!window.confirm('Invite this person as an administrator with full clinic access?'))return;
      await inviteAdministrator(db,{name:adminDraft.displayName,email:adminDraft.email,adminUid});
      setMessage('Administrator invited. Password setup email sent.');
      setAdminDraft({displayName:'',email:''});setShowAdmin(false);
    }catch(e){setError(e instanceof Error?e.message:'Could not create administrator.');}
    finally{setCreating(false);}
  }
  async function changeStatus(doctor:DoctorProfile) {
    if(!window.confirm(doctor.active
      ? `Deactivate ${doctor.displayName}? They will lose access to patient records immediately. Existing assignments are retained until removed.`
      : `Reactivate ${doctor.displayName}? Existing assigned patients may become accessible again immediately.`))return;
    setBusyUid(doctor.uid);setMessage('');setError('');
    try {
      await setDoctorActive(db,{uid:doctor.uid,active:!doctor.active,adminUid});
      setMessage(doctor.active?'Doctor access deactivated.':'Doctor access reactivated.');
    }catch(e){setError(e instanceof Error?e.message:'Unable to change doctor access.');}
    finally{setBusyUid(null);}
  }
  function toggle(uid:string){setSelectedDoctorIds(ids=>ids.includes(uid)?ids.filter(x=>x!==uid):[...ids,uid]);}
  async function saveAccess() {
    if(!selectedPatient)return;
    const unknown=selectedDoctorIds.filter(uid=>!availableDoctors.some(d=>d.uid===uid));
    if(unknown.length){setError('This patient has unknown doctor assignments. Verify them before saving.');return;}
    setSavingAccess(true);setError('');setMessage('');
    try {
      await setPatientDoctors(db,{patientId:selectedPatient.id,doctorIds:selectedDoctorIds});
      setMessage('Patient care-team access updated.');
    }catch(e){setError(e instanceof Error?e.message:'Could not update patient access.');}
    finally{setSavingAccess(false);}
  }

  return <div className="admin-console">
    <section className="workspace-card glass-panel admin-section">
      <div className="section-heading admin-doctor-heading">
        <div><p className="eyebrow">CLINIC ACCESS</p><h2>Doctor management</h2>
          <p className="section-copy">Add doctors, control access, and review their patient assignments.</p></div>
        <button type="button" className="button primary" onClick={()=>setShowAdd(x=>!x)}>
          {showAdd?'Cancel':' + Add doctor'}</button>
      </div>
      <div className="admin-doctor-summary">
        <div><strong>{availableDoctors.length}</strong><span>Total doctors</span></div>
        <div><strong>{activeDoctors.length}</strong><span>Active</span></div>
        <div><strong>{pendingDoctors.length}</strong><span>Pending approval</span></div>
      </div>
      {showAdd?<form className="admin-add-doctor" onSubmit={addDoctor}>
        <h3>Existing doctor account</h3>
        <p className="section-copy">New doctors should register from the login page. Their applications appear as inactive until you activate them below. You can also link a separate existing Firebase Authentication UID here.</p>
        <label>Firebase Authentication UID
          <input required minLength={6} maxLength={128} value={draft.uid}
            onChange={e=>setDraft({...draft,uid:e.target.value})} placeholder="Paste exact UID from Firebase Authentication"/>
        </label>
        <label>Doctor's full name
          <input required minLength={2} maxLength={120} value={draft.displayName}
            onChange={e=>setDraft({...draft,displayName:e.target.value})} placeholder="Dr. Full Name"/>
        </label>
        <label>Doctor's Firebase login email
          <input required type="email" value={draft.email}
            onChange={e=>setDraft({...draft,email:e.target.value})} placeholder="doctor@clinic.com"/>
        </label>
        <label className="admin-verify-account">
          <input type="checkbox" checked={confirmedAuthUid} onChange={e=>setConfirmedAuthUid(e.target.checked)}/>
          <span>I verified that this UID and email belong to the intended doctor in Firebase Authentication.</span>
        </label>
        <button className="button primary" type="submit" disabled={creating||!confirmedAuthUid}>
          {creating?'Adding…':'Activate doctor account'}</button>
      </form>:null}
      <div className="admin-doctor-filters">
        <input type="search" aria-label="Search doctors" value={search}
          onChange={e=>setSearch(e.target.value)} placeholder="Search name, email or UID"/>
        <select aria-label="Filter doctor status" value={statusFilter}
          onChange={e=>setStatusFilter(e.target.value as 'all'|'active'|'inactive')}>
          <option value="all">All doctors</option>
          <option value="active">Active</option>
          <option value="inactive">Inactive</option>
        </select>
      </div>
      <div className="doctor-list">
        {visibleDoctors.map(doctor=><article className="doctor-row admin-doctor-row" key={doctor.uid}>
          <div className="avatar">{doctor.displayName.slice(0,2).toUpperCase()}</div>
          <div className="admin-doctor-identity"><strong>{doctor.displayName}</strong>
            <span>{doctor.email}</span><small>{assignedCounts.get(doctor.uid)??0} assigned patient(s)</small></div>
          <span className={'doctor-status '+(doctor.active?'':'inactive')}>{doctor.active?'Active':doctor.pending?'Pending':'Inactive'}</span>
          <button type="button" className={'button secondary admin-status-button '+(doctor.active?'danger-text':'')}
            onClick={()=>changeStatus(doctor)} disabled={busyUid===doctor.uid}>
            {busyUid===doctor.uid?'Updating…':doctor.active?'Deactivate':doctor.pending?'Approve':'Reactivate'}
          </button>
        </article>)}
        {!visibleDoctors.length?<div className="empty-list">
          {search||statusFilter!=='all'?'No doctors match this filter.':'No doctors yet. Add an existing Firebase Authentication doctor account above.'}
        </div>:null}
      </div>
      <p className="admin-safety-hint">Deactivation immediately denies clinical access. Reactivation restores access to patients still assigned to that doctor. No clinical history is deleted.</p>
    </section>
    <section className="workspace-card glass-panel admin-section">
      <div className="section-heading"><div><h2>Administrators</h2></div>
        <button type="button" className="button secondary" onClick={()=>setShowAdmin(x=>!x)}>Add administrator</button></div>
      {showAdmin?<form className="admin-add-doctor" onSubmit={addAdmin}>
        <p className="section-copy">An individual login will be created and a password setup email sent. Invite trusted clinic staff only.</p>
        <label>Name<input required minLength={2} value={adminDraft.displayName}
          onChange={e=>setAdminDraft({...adminDraft,displayName:e.target.value})}/></label>
        <label>Email<input required type="email" value={adminDraft.email}
          onChange={e=>setAdminDraft({...adminDraft,email:e.target.value})}/></label>
        <button className="button primary" disabled={creating} type="submit">{creating?'Sending…':'Invite administrator'}</button>
      </form>:null}
      <div className="doctor-list">{admins.map(a=><article className="doctor-row" key={a.uid}>
        <div className="avatar">A</div><div><strong>{a.displayName}</strong><span>{a.email}</span></div>
      </article>)}</div>
    </section>
    <section className="workspace-card glass-panel admin-section">
      <div className="section-heading"><div><p className="eyebrow">PATIENT PERMISSIONS</p>
        <h2>Care-team assignments</h2>
        <p className="section-copy">Select a patient and choose which doctors can access their records.</p></div>
      </div>
      <label className="patient-access-select">Patient
        <select value={selectedPatientId} onChange={e=>setSelectedPatientId(e.target.value)}>
          <option value="">Select patient</option>
          {patients.map(p=><option key={p.id} value={p.id}>{p.firstName} {p.lastName}</option>)}
        </select>
      </label>
      {selectedPatient?<><div className="access-doctor-grid">
        {availableDoctors.map(doctor=>{
          const assigned=selectedDoctorIds.includes(doctor.uid);
          return <label className={'access-doctor-card '+(assigned?'selected':'')} key={doctor.uid}>
            <input type="checkbox" checked={assigned} disabled={!doctor.active&&!assigned}
              onChange={()=>toggle(doctor.uid)}/>
            <span className="avatar">{doctor.displayName.slice(0,2).toUpperCase()}</span>
            <span><strong>{doctor.displayName}{!doctor.active?' (inactive)':''}</strong><small>{doctor.email}</small></span>
          </label>;
        })}
      </div>
      {!availableDoctors.length?<div className="empty-list">Add a doctor to assign patients.</div>:null}
      {selectedDoctorIds.some(id=>!availableDoctors.some(d=>d.uid===id))?
        <div className="inline-error" role="alert">This patient has older or unknown doctor assignments. Check them in Firestore before saving.</div>:null}
      <div className="admin-actions">
        <span className="quiet-note">{selectedDoctorIds.length} assigned doctor(s)</span>
        <button type="button" className="button primary" disabled={savingAccess||selectedDoctorIds.length>20||
          selectedDoctorIds.some(id=>!availableDoctors.some(d=>d.uid===id))} onClick={saveAccess}>
          {savingAccess?'Saving…':'Save assignments'}</button>
      </div></>:<div className="empty-list">Select a patient to manage access.</div>}
    </section>
    {error?<div className="inline-error admin-message" role="alert">{error}</div>:null}
    {message?<div className="save-message admin-message" role="status">{message}</div>:null}
  </div>;
}
