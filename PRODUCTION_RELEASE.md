# Patient Case Manager — Production Release Gate

## State as of 21 October 2026

Code changes and automated tests can be completed through PR #2. **A passed CI run is not a
production launch authorization.** The application handles clinical records and coded
medicine dispensing. Firebase project provisioning, staging user acceptance, privacy and
clinical/dispensing checks, backups, and release approval are required prior to live use.

### Required operational gates

1. **Protect the production GitHub environment.** Repository Settings → Environments →
   production: require reviewer approval; restrict deployment branches to main.
   Add Actions variables for all VITE_FIREBASE_* values, and the service account credential
   in FIREBASE_SERVICE_ACCOUNT secret. Prefer short-lived workload identity credentials
   over a persistent service-account key where supported. Restrict deployment identity to
   least necessary IAM privileges.
2. **Configure Firebase Auth and privileges.** Enable Email/Password sign-in and create an
   initial authorized admin profile; prevent public account provisioning. Configure MFA for
   admins/clinicians wherever available; configure account recovery and offboarding tests.
   Use the supported Firebase project plan for Cloud Functions (typically Blaze).
3. **Backup and migration before security-rule deployment.** Export a protected point-in-time
   Firestore backup and ensure restore is tested. With appropriate ADC read access, run:
   `node functions/scripts/audit-legacy-patients.cjs --project=YOUR_PROJECT_ID`
   Investigate unresolved records. Only after an approved backup and verified accounts, run:
   `node functions/scripts/audit-legacy-patients.cjs --project=YOUR_PROJECT_ID --apply --confirm-project=YOUR_PROJECT_ID --backup-confirmed`
   This sets doctorIds=[ownerId] for eligible legacy records and preserves the old ownerId.
   It is idempotent, checks live patient data transactionally, never prints patient names,
   and stops on unresolved access. Verify results by a second dry run.
4. **Test in a separate staging Firebase project.** Run tests, role-access trials (admin,
   assigned doctor, unassigned doctor, revoked doctor), medicine import, the physician
   allergy/medication attestation, prescription creation, voiding, print/display, accessibility,
   mobile screen layouts, a code-only patient copy plus legally required medicine identification,
   and clinical/patient disclosure workflows. In particular test historical codes B1-B688.
5. **Verify release file.** Approved source:
   `homeopathy_verified_medicine_codes_firebase_staging.json` with 881 entries
   and SHA-256 code/name/legacy identity fingerprint:
   `117f6e5f51811a59e15311866b62f52e41f16ee96d65cf0d591dd6d0615a92e6`.
   The Firebase callable rejects a changed identity list regardless of edited "Verified" flags.
   The code releases are version-pinned. Imported medicine names cannot be silently changed,
   and archived medicines cannot be activated via a repeated import.
6. **Prepare patient-safe dispensing.** Each code must resolve to an unambiguous full
   identity, potency, form, concentration, dose, directions, batch/lot as needed, and
   all relevant label/prescription disclosures. The current editor captures potency, dosage form, directions and quantity/duration;
   dispensing workflows requiring batch/lot tracking, specific product strength,
   pharmacy sign-off or automated interaction checking must still be completed before go-live.
   Internal code-only paper must not be the only accessible medication identification.
   Homeopathy should not delay evidence-based diagnosis and care.
7. **Privacy and continuity.** Define user/clinic consent records, purpose limitation,
   encryption/key access, audit-log retention, disaster recovery, data export/deletion
   obligations, incident response, monitoring/error alerting, uptime and backup cadence.
   Review applicable Indian and local patient-data and medicines regulations with counsel.
8. **Release.** Merge PR only after reviewer acceptance. In GitHub Actions, select
   **Deploy Firebase — Production** on the **main** branch and explicitly check the
   manual confirmation. Run a post-deploy smoke test and check the production Cloud
   Functions logs and Firestore indexes. An authorized administrator then uploads the
   verified JSON file in the Medicine codes view and confirms clinical authorization.
   Do not upload PHI, service-account keys, or clinical exports into this public repository.

### Rollback

- Preserve the prior hosting release (Firebase Hosting channel/version) and release commit.
  Roll back Hosting only if client compatibility permits. Rollback of Firestore rules/functions
  must account for new schema and access controls; never loosen security to restore access.
- **Do not delete or mutate clinical records as part of rollback.**
- Medicine mappings are immutable. For bad prescriptions use the audited **Void** function,
  then create a new approved record; do not rewrite history.
- Document rollback decisions and verify doctor access after reversion.

### Explicit non-claims

A successful GitHub Actions run verifies only the committed tests and TypeScript builds.
It does **not** verify legal compliance, disease efficacy, Firebase billing/quotas, production
secrets, all data migrations, storage-rule emulator coverage, clinical labeling, pharmacy
processes, penetration testing, or live browser/print behavior.
