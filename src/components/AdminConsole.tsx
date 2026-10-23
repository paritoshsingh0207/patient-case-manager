import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { collection, onSnapshot, query, where } from 'firebase/firestore';
import type { Firestore } from 'firebase/firestore';
import type { DoctorProfile, Patient } from '../types';
import { removePatientDoctorAccess, setDoctorActive, setPatientDoctors, subscribeDoctors } from '../services/adminService';
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
  const [creating,setCreating]=useState(false);
  const [busyUid,setBusyUid]=useState<string|null>(null);
  const [selectedPatientId,setSelectedPatientId]=useState('');
  const [selectedDoctorIds,setSelectedDoctorIds]=useState<string[]>([]);
  const [savingAccess,setSavingAccess]=useState(false);
  const [removingDoctorUid,setRemovingDoctorUid]=useState<string|null>(null);

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
      : doctor.pending
        ? `Approve ${doctor.displayName}? Confirm their identity and email before granting clinic access.`
        : `Reactivate ${doctor.displayName}? Existing assigned patients may become accessible again immediately.`))return;
    setBusyUid(doctor.uid);setMessage('');setError('');
    try {
      await setDoctorActive(db,{uid:doctor.uid,active:!doctor.active,adminUid});
      setMessage(doctor.active?'Doctor access deactivated.':doctor.pending?'Doctor approved. The doctor must also verify their email before accessing patient records.':'Doctor access reactivated.');
    }catch(e){setError(e instanceof Error?e.message:'Unable to change doctor access.');}
    finally{setBusyUid(null);}
  }
  function toggle(uid:string){setSelectedDoctorIds(ids=>ids.includes(uid)?ids.filter(x=>x!==uid):[...ids,uid]);}
  async function removeDoctorAccess(doctorUid:string) {
    if(!selectedPatient||removingDoctorUid||savingAccess)return;
    const doctor=availableDoctors.find(d=>d.uid===doctorUid);
    const doctorName=doctor?.displayName??`Doctor (${doctorUid})`;
    if(!window.confirm(`Remove ${doctorName}'s access to ${selectedPatient.firstName} ${selectedPatient.lastName}? The doctor will no longer be able to view this patient's clinical history or prescriptions.`))return;
    const patientId=selectedPatient.id;
    setRemovingDoctorUid(doctorUid);setError('');setMessage('');
    try {
      await removePatientDoctorAccess(db,{patientId,doctorUid});
      setSelectedDoctorIds(ids=>ids.filter(uid=>uid!==doctorUid));
      setMessage(`${doctorName}'s access to this patient was removed.`);
    }catch(e){setError(e instanceof Error?e.message:'Unable to remove doctor access.');}
    finally{setRemovingDoctorUid(null);}
  }
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
        <div><h2>Doctor approvals</h2>
          <p className="section-copy">Doctors register from the Doctor Login screen. Review new registrations here, approve access, and assign patients.</p></div>
      </div>
      <div className="admin-doctor-summary">
        <div><strong>{availableDoctors.length}</strong><span>Total doctors</span></div>
        <div><strong>{activeDoctors.length}</strong><span>Active</span></div>
        <div><strong>{pendingDoctors.length}</strong><span>Pending approval</span></div>
      </div>
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
      {!availableDoctors.length?<div className="empty-list">No active doctors available for assignment.</div>:null}
      <div className="assigned-doctor-section">
        <h3>Doctors currently assigned</h3>
        {selectedPatient.doctorIds.length ? selectedPatient.doctorIds.map(uid=>{
          const doctor=availableDoctors.find(d=>d.uid===uid);
          return <div className="assigned-doctor-row" key={uid}>
            <div><strong>{doctor?.displayName??`Doctor (${uid})`}</strong><small>{doctor?.email??'Previous assignment'}</small></div>
            <button type="button" className="button secondary assigned-revoke-button"
              aria-label={`Remove ${doctor?.displayName??uid} from ${selectedPatient.firstName} ${selectedPatient.lastName}`}
              disabled={removingDoctorUid!==null||savingAccess}
              onClick={()=>removeDoctorAccess(uid)}>
              {removingDoctorUid===uid?'Removing…':'Remove access'}
            </button>
          </div>;
        }):<p className="quiet-note">No doctors have access to this patient.</p>}
      </div>
      {selectedDoctorIds.some(id=>!availableDoctors.some(d=>d.uid===id))?
        <div className="inline-error" role="alert">This patient has older or unknown doctor assignments. Check them in Firestore before saving.</div>:null}
      <div className="admin-actions">
        <span className="quiet-note">{selectedDoctorIds.length} assigned doctor(s)</span>
        <button type="button" className="button primary" disabled={savingAccess||removingDoctorUid!==null||selectedDoctorIds.length>20||
          selectedDoctorIds.some(id=>!availableDoctors.some(d=>d.uid===id))} onClick={saveAccess}>
          {savingAccess?'Saving…':'Save assignments'}</button>
      </div></>:<div className="empty-list">Select a patient to manage access.</div>}
    </section>
    {error?<div className="inline-error admin-message" role="alert">{error}</div>:null}
    {message?<div className="save-message admin-message" role="status">{message}</div>:null}
  </div>;
}
