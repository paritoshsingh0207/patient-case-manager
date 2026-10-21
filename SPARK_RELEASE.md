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
