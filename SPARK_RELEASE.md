# Spark release gates — Patient Case Manager

## Pre-deployment checklist

1. Confirm the destination Firebase project and Hosting site; the example
   project awakening-casemanager may already host an existing website.
2. Verify Spark plan, Firestore/Hosting/Auth quota headroom and disable Cloud
   Functions and Cloud Storage deployments. This version does not need them.
3. Back up Firestore and verify restore capability. The new rules expect
   patients/{id}.doctorIds and users/{uid} role+active profiles.
4. Run a read-only patient schema audit using local Application Default Credentials:

       node functions/scripts/audit-legacy-patients.cjs --project=PROJECT_ID

   Investigate unprovisioned doctor/legacy owner records before changing rules.
   With a verified backup and approved migration, run:

       node functions/scripts/audit-legacy-patients.cjs --project=PROJECT_ID --apply --confirm-project=PROJECT_ID --backup-confirmed

   Re-run the dry run and verify that clinical access was retained.
5. Provision the first admin and each doctor in Firebase Authentication Console,
   then use functions/scripts/manage-doctor.cjs for their active Firestore
   profiles. Keep role writes denied from browsers; no public signup.
6. Dry-run the approved 881-entry JSON import with
   functions/scripts/import-verified-medicines.cjs. It requires exactly
   881 unique alphabetical codes, 688 historical aliases and fingerprint
   117f6e5f51811a59e15311866b62f52e41f16ee96d65cf0d591dd6d0615a92e6.
   After backup and explicit authorization, apply via --apply
   --confirm-project=PROJECT_ID --backup-confirmed. Do not commit private
   credentials or patient datasets.
7. Review Firebase App Check for the web app; configure domain and
   reCAPTCHA Enterprise key before enabling Firestore enforcement. Use MFA
   where available and establish least-privilege administrative IAM.
8. Staging UAT: test admin/assigned/unassigned/inactive doctors, access
   changes, approved/archived medicine lookup, historical B1–B688 records,
   new prescriptions, voiding, mobile/browser support and paper print.
9. Clinical/dispensing acceptance: verify full identity, strength/potency,
   form, dose, prescriber identification, dispensing instructions and
   applicable local label requirements. No automated interactions, adverse
   effects or legal-compliance certification exists.
10. Deploy from the intended workstation/project:

       npm ci
       npm --prefix functions install
       npm run test:all
       npm run build
       npx firebase-tools deploy --project PROJECT_ID --only hosting,firestore

   Keep a previous Hosting version for rollback. Never erase clinical
   histories or simply loosen rules to regain patient access.

## Why new prescriptions are one medicine per entry

Firestore Rules can securely validate one medicineCode field against one
approved Firestore document. Arbitrary arrays of medicines could bypass
full registry validation and exceed rules document-read limits. Save each
medicine as its own dated entry. Historical multi-item prescriptions remain
readable for authorized patient caregivers.

## Known product limitations

- Doctor account creation/deactivation requires a trusted offline operation.
- No Firebase Storage / clinical file attachments on Spark.
- No Cloud Functions; local Firebase Admin SDK scripts do not deploy.
- Prescriptions are not a validated medical or pharmacy dispensing system.
- All rules-authorized database reads count against Spark quotas.

## Phase 0: access activity and disaster recovery
- Admin can review a recent append-only activity log for doctor activation, deactivation
  and patient care-team assignments. App writes the log atomically with those changes.
  This is NOT a complete audit of data reads, offline Admin SDK operations or other apps.
- Backups are NOT automatically created on the free Firebase Spark plan. Before
  deploying, maintain an independent encrypted backup of patients, nested clinical
  collections, users, registry and rules. Verify a restore in a SEPARATE Firebase
  project. Do not place patient exports in Hosting, source control or unencrypted files.
- Record the last deployed Hosting version and Firestore rules, and test admin,
  assigned, unassigned, inactive and revoked-doctor access before release.

## Recovery tools and limitations
1. Use functions/scripts/clinic-backup.cjs export to encrypt all case-manager
   documents, including nested patient data, on a trusted administrator computer.
2. Immediately run verify against the encrypted file, and record totals, digest,
   project, timestamp, custodian and encrypted offline storage location.
3. Keep the passphrase separately in a password vault. Test restore only in a
   fresh isolated staging project. The tool refuses production restores.
4. Restore does not provide Firebase Authentication user accounts, Hosting,
   rules, indexes or Storage. Review these independently before disaster recovery.
5. Backups are still manual. Unattended scheduling requires an approved secure
   secret store, a monitored workstation, retention policy and responsible staff.
6. The app's auditEvents are client-submitted change records, not a complete,
   independent audit of read access or privileged Firebase Admin actions.
