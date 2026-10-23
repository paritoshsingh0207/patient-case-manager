# Patient Case Manager — Firebase Spark Edition

Patient case management with role-based doctor access, an expert-verified homeopathic
medicine dictionary, and coded prescriptions. The deployed application uses
**Firebase Hosting, Authentication and Firestore only** — no Cloud Functions
or Cloud Storage. The functions/ directory holds trusted offline admin scripts.

## Architecture

- Authentication: separate administrator and doctor email/password sign-in; doctor self-registration creates inactive profiles pending admin approval and email verification.
- Firestore users/{uid}: self-registered doctors remain inactive until approval; authorized admins can manage accounts and invite other administrators. Firestore rules prevent clinician self-promotion.
- Firestore patients/{id}: administrator controls doctorIds; doctors see only assigned patients.
- Firestore medicineCodes/{AB1...}: immutable approved mappings and legacy B aliases.
  Browser writes are forbidden.
- Firestore patients/{id}/prescriptions/{rxId}: one medicine per new prescription
  document. Rules validate the code against its approved registry record, and
  record the issuing doctor, potency, form, directions, date, and review attestation.
  Historical multi-item records remain readable. Incorrect prescriptions may be
  voided with an audit reason but cannot be silently deleted or changed.
- Internal per-patient clinical follow-up tracker (due date, reason and completion) without public booking, messaging or appointment intake; the Awakening website owns booking.
- Structured case assessments (vitals, assessment, plan) and read-only comparison with previous consultations. Signed previous cases remain immutable.
- Append-only recent admin activity for doctor status and patient access changes; this does not replace server-side comprehensive audit logging.
- No file attachments / Cloud Storage feature, automated backups, or backup restoration tooling.

## Setup

Node.js 22+, npm and Java 21+ for emulator security tests:

    git pull origin main
    npm ci
    npm --prefix functions install
    cp .env.example .env.local

Configure Firebase web-app values and clinic name/address in .env.local. Check
the Firebase project before deploying; the example points to awakening-casemanager.

## Patient migration (before stricter Rules)

Back up Firestore, test restore, then audit without writing:

    node functions/scripts/audit-legacy-patients.cjs --project=YOUR_PROJECT_ID

Resolve unprovisioned patient ownerId values. When the audit and backup are
approved, follow SPARK_RELEASE.md for the explicit opt-in migration command.

## Doctor and admin accounts

Create each account in Firebase Console → Authentication → Users, copy its UID,
then authorize it using the locally executed Firebase Admin SDK:

    node functions/scripts/manage-doctor.cjs --project=YOUR_PROJECT_ID --confirm-project=YOUR_PROJECT_ID --uid=AUTH_UID --mode=activate --role=doctor

For the first admin, append --role=admin --confirm-admin-role instead.
To remove access, use --mode=deactivate. The inactive profile loses all clinic
access, even if the Firebase Authentication login still exists; disable the
Auth login separately as needed.

## Import expert-approved medicines (881 entries)

The release JSON is NOT checked into this public GitHub repository. Download
the approved homeopathy_verified_medicine_codes_firebase_staging.json file.
The exact 881 medicine identities and 688 historical aliases are pinned by a
release fingerprint. Import runs on your computer with authorized Google
Application Default Credentials (ADC), not in Firebase Cloud Functions.

Dry run (read-only):

    node functions/scripts/import-verified-medicines.cjs --project=YOUR_PROJECT_ID --file=/path/to/homeopathy_verified_medicine_codes_firebase_staging.json

After review, backup and explicit release approval:

    node functions/scripts/import-verified-medicines.cjs --project=YOUR_PROJECT_ID --file=/path/to/homeopathy_verified_medicine_codes_firebase_staging.json --apply --confirm-project=YOUR_PROJECT_ID --backup-confirmed

The importer rejects mismatched names, codes, legacy aliases, previously
archived entries or unapproved releases, and is safe to retry for approved
matching data. Firestore reads/writes count against Spark quotas.

## Tests and manual deployment

    npm run test:all
    npm run build
    npx firebase-tools login
    npx firebase-tools deploy --project YOUR_PROJECT_ID --only hosting,firestore

Do NOT deploy functions or storage on Spark. Verify the selected Hosting site
so that you do not overwrite an unrelated Awakening website.

See SPARK_RELEASE.md for all release gates, backup, migration, App Check,
clinical prescription/dispensing checks and rollback.

Important: this is not a validated medical decision support, medication
interaction checking or pharmacy record system. Patient copies now display
both the clinic code and the full medicine name to support safer identification.
Homeopathy should not delay necessary evidence-based care.

## Patient case-management boundaries and recovery

This application does not process online bookings or send external follow-up messages;
the Awakening website handles booking. Internal follow-ups are notes/tasks attached
to existing patients, not booked appointments.

Before every production rules or Hosting deployment, follow the backup and disaster-
recovery checklist in SPARK_RELEASE.md. Firestore data is not automatically backed
up by this app. Do not treat the in-app activity list as a complete log of reads or
privileged changes. Test patient access removal and verify restore in a separate
Firebase project before relying on a backup.

## Clinic-only encrypted backup and staging restore

A local, manual backup script uses the existing Firebase CLI login. It requires
sufficient Firestore IAM permissions. It uses no service-account key, gcloud or
Cloud Functions. From a trusted administrator workstation after npm install:

    node functions/scripts/clinic-backup.cjs export --project=awakening-casemanager --confirm-project=awakening-casemanager --out="C:\private-clinic-backups\2026-10-23.pcmbackup"
    node functions/scripts/clinic-backup.cjs verify --file="C:\private-clinic-backups\2026-10-23.pcmbackup"
    node functions/scripts/clinic-backup.cjs restore --file="C:\private-clinic-backups\2026-10-23.pcmbackup" --project=your-isolated-staging

The last command is a DRY RUN. Restoring into an EMPTY isolated staging project
requires adding --apply --confirm-staging=your-isolated-staging. Production
restore, overwrites and non-staging targets are intentionally refused.
A partially failed restore requires a fresh empty staging project.

The file uses AES-256-GCM, scrypt and an integrity digest, and is re-verified
after creation. A unique strong passphrase of at least 16 characters is
prompted without terminal echo, not supplied as a command-line argument.
Keep the backup outside the Git working tree and the passphrase separately
in a secure password vault. Never send plaintext patient records to GitHub.

Only case-manager roots (users, patients, medicineCodes, auditEvents) and all
patient subcollections are exported. Other Awakening top-level collections are
excluded. Firebase Auth accounts/passwords, Hosting, Cloud Storage, indexes
and Firestore rules are NOT backed up. This is a bounded in-memory backup,
not a server-atomic snapshot, automated backup or comprehensive audit log.
It uses a Firebase CLI internal authentication helper that may change versions;
if unavailable, it fails closed.

Read STAGING_RECOVERY.md before trusting the archive for disaster recovery.

After restoring to staging, re-verify every document's typed fields without
writing any data:

    node functions/scripts/clinic-backup.cjs check-staging --file="C:\private-clinic-backups\2026-10-23.pcmbackup" --project=your-isolated-staging

The restore command also runs this comparison automatically after all writes.
