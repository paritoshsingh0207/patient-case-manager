import { useEffect, useMemo, useState } from 'react';
import type { Firestore } from 'firebase/firestore';
import type { DoctorProfile, Patient } from '../types';
import { setPatientDoctors, subscribeDoctors } from '../services/adminService';

interface AdminConsoleProps { db: Firestore; patients: Patient[]; }
export function AdminConsole({db,patients}: AdminConsoleProps) {
  const [doctors,setDoctors]=useState<DoctorProfile[]>([]);
  const [message,setMessage]=useState('');
  const [selectedPatientId,setSelectedPatientId]=useState('');
  const [selectedDoctorIds,setSelectedDoctorIds]=useState<string[]>([]);
  const [savingAccess,setSavingAccess]=useState(false);
  useEffect(()=>subscribeDoctors(db,setDoctors,error=>setMessage(error.message)),[db]);
  const activeDoctors=useMemo(()=>doctors.filter(x=>x.active&&!x.deleted),[doctors]);
  const selectedPatient=patients.find(x=>x.id===selectedPatientId)??null;
  useEffect(()=>{
    if(!selectedPatientId || !patients.some(x=>x.id===selectedPatientId))setSelectedPatientId(patients[0]?.id??'');
  },[patients,selectedPatientId]);
  useEffect(()=>setSelectedDoctorIds(selectedPatient?.doctorIds??[]),[selectedPatient]);
  function toggle(uid:string){setSelectedDoctorIds(current=>current.includes(uid)?current.filter(x=>x!==uid):[...current,uid]);}
  async function save() {
    if(!selectedPatient)return;
    setSavingAccess(true);setMessage('');
    try {
      await setPatientDoctors(db,{patientId:selectedPatient.id,doctorIds:selectedDoctorIds});
      setMessage('Patient care-team access updated.');
    }catch(error){setMessage(error instanceof Error?error.message:'Access update failed.');}
    finally{setSavingAccess(false);}
  }
  return <div className="admin-console">
    <section className="workspace-card glass-panel admin-section">
      <div className="section-heading">
        <div>
          <p className="eyebrow">Spark administrator</p>
          <h2>Doctors</h2>
          <p className="section-copy">Clinic admins can share existing patients. Doctor account provisioning remains in a trusted offline admin process.</p>
        </div>
        <span className="status-pill">{activeDoctors.length} active</span>
      </div>
      <div className="admin-readonly-note">
        To add a doctor, create their Firebase Authentication account, then run the local
        <code> functions/scripts/manage-doctor.cjs</code> administrator script to activate
        their Firestore profile. To remove access, deactivate through the same script.
        <strong> Do not enable public registration or permit browser-side role changes.</strong>
      </div>
      <div className="doctor-list">
        {activeDoctors.map(doctor=><article className="doctor-row" key={doctor.uid}>
          <div className="avatar">{doctor.displayName.slice(0,2).toUpperCase()}</div>
          <div><strong>{doctor.displayName}</strong><span>{doctor.email}</span></div>
          <span className="doctor-status">Active</span>
        </article>)}
        {!activeDoctors.length?<div className="empty-list">No active doctors provisioned.</div>:null}
      </div>
    </section>
    <section className="workspace-card glass-panel admin-section">
      <div className="section-heading">
        <div><p className="eyebrow">Administration</p><h2>Patient sharing</h2>
          <p className="section-copy">Only administrators can change doctor assignments. Doctors can see assigned patients only.</p></div>
      </div>
      <label className="patient-access-select">Patient
        <select value={selectedPatientId} onChange={event=>setSelectedPatientId(event.target.value)}>
          <option value="">Select patient</option>
          {patients.map(x=><option key={x.id} value={x.id}>{x.firstName} {x.lastName}</option>)}
        </select>
      </label>
      {selectedPatient?<><div className="access-doctor-grid">
        {activeDoctors.map(doctor=><label className={'access-doctor-card '+(selectedDoctorIds.includes(doctor.uid)?'selected':'')} key={doctor.uid}>
          <input type="checkbox" checked={selectedDoctorIds.includes(doctor.uid)} onChange={()=>toggle(doctor.uid)}/>
          <span className="avatar">{doctor.displayName.slice(0,2).toUpperCase()}</span>
          <span><strong>{doctor.displayName}</strong><small>{doctor.email}</small></span>
        </label>)}
      </div>
      <div className="admin-actions">
        <span className="quiet-note">{selectedDoctorIds.length} assigned doctor(s)</span>
        <button className="button primary" disabled={savingAccess||selectedDoctorIds.length>20} onClick={save}>
          {savingAccess?'Saving…':'Save access'}</button>
      </div></>:<div className="empty-list">Select a patient to manage access.</div>}
    </section>
    {message?<div className="save-message admin-message" role="status">{message}</div>:null}
  </div>;
}
