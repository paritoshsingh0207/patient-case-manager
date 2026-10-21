#!/usr/bin/env node
/**
 * Production migration audit for legacy ownerId-based patients.
 * Default: DRY RUN, emits only aggregate counts (no patient PII).
 *
 *  node functions/scripts/audit-legacy-patients.cjs --project=YOUR_PROJECT_ID
 *  node functions/scripts/audit-legacy-patients.cjs --project=YOUR_PROJECT_ID \
 *     --apply --confirm-project=YOUR_PROJECT_ID --backup-confirmed
 *
 * Uses Application Default Credentials with least privilege.
 * Back up Firestore first; never commit credentials or patient exports.
 */
'use strict';
const { initializeApp } = require('firebase-admin/app');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');

const flags = process.argv.slice(2);
function flag(name) {
  const found = flags.find(value => value.startsWith('--' + name + '='));
  return found ? found.slice(name.length + 3) : null;
}
function die(message) { console.error(message); process.exit(2); }
const project = flag('project');
if (!project || !/^[a-z][a-z0-9-]{4,29}$/.test(project)) {
  die('Usage: --project=PROJECT_ID [--apply --confirm-project=PROJECT_ID --backup-confirmed]');
}
const apply = flags.includes('--apply');
if (apply && (!flags.includes('--backup-confirmed') || flag('confirm-project') !== project)) {
  die('Refusing to write: --apply requires --backup-confirmed and matching --confirm-project=PROJECT_ID.');
}

(async () => {
  initializeApp({ projectId: project });
  const db = getFirestore();
  const patients = await db.collection('patients').get();
  const legacy = [], unresolved = [];
  let modern = 0, unassigned = 0;
  for (const snapshot of patients.docs) {
    const data = snapshot.data();
    if (Array.isArray(data.doctorIds)) {
      modern++;
      if (!data.doctorIds.length) unassigned++;
      continue;
    }
    if (typeof data.ownerId !== 'string' || !data.ownerId.trim()) {
      unresolved.push({ reason: 'missing ownerId', snapshot });
      continue;
    }
    legacy.push({ snapshot, ownerId: data.ownerId.trim(), createdBy: data.createdBy });
  }
  const profiles = new Map();
  const owners = [...new Set(legacy.map(x => x.ownerId))];
  for (let i = 0; i < owners.length; i += 200) {
    const ids = owners.slice(i, i + 200);
    const found = await db.getAll(...ids.map(id => db.doc('users/' + id)));
    for (const snap of found) profiles.set(snap.id, snap.data());
  }
  const ready = [];
  for (const item of legacy) {
    const profile = profiles.get(item.ownerId);
    if (!profile || profile.active !== true || !['doctor','practitioner'].includes(profile.role)) {
      unresolved.push({ reason: 'legacy owner is not an active provisioned doctor', snapshot: item.snapshot });
    } else {
      ready.push(item);
    }
  }
  const reasons = unresolved.reduce((acc, entry) => {
    acc[entry.reason] = (acc[entry.reason] || 0) + 1;
    return acc;
  }, {});
  console.log(JSON.stringify({
    project, mode:apply?'APPLY':'DRY_RUN',
    totalPatients: patients.size,
    alreadyOnDoctorIds:modern,
    currentlyUnassigned:unassigned,
    eligibleLegacyPatients:ready.length,
    unresolvedPatients:unresolved.length,
    unresolvedReasons:reasons,
  }, null, 2));
  if (unresolved.length) {
    die('Review unresolved accounts and patient ownership manually before any migration. No changes were made.');
  }
  if (!apply) {
    console.log('DRY RUN only. Snapshot backup, review and the explicit --apply flags are required before migration.');
    return;
  }
  let updated=0;
  for (let i=0;i<ready.length;i+=300) {
    const slice=ready.slice(i,i+300);
    // Transactions ensure records changed after this audit are never silently overwritten.
    await db.runTransaction(async tx=>{
      const current=await tx.getAll(...slice.map(item=>item.snapshot.ref));
      for(let k=0;k<slice.length;k++){
        const record=current[k].data();
        const item=slice[k];
        if (!record || Array.isArray(record.doctorIds) || record.ownerId !== item.ownerId ||
            (record.createdBy && typeof record.createdBy !== 'string')) {
          throw Error('Patient record changed during migration; aborting without overwriting the batch.');
        }
        tx.update(item.snapshot.ref,{
          doctorIds:[item.ownerId],
          createdBy:record.createdBy || item.ownerId,
          migrationVersion:'ownerId-to-doctorIds-v1',
          accessUpdatedAt:FieldValue.serverTimestamp(),
        });
      }
    });
    updated+=slice.length;
    console.log('Migrated '+updated+' of '+ready.length+' eligible legacy patient records.');
  }
  console.log('Migration complete. Rerun in DRY RUN and verify no unresolved legacy patients remain.');
})().catch(error=>{console.error('Audit/migration failed:',error.message);process.exitCode=1;});
