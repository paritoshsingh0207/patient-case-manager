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
- Authorized clinicians can edit patient demographics, medical history, allergies and medicine lists; concurrent edits to the same field are blocked to prevent unnoticed overwrites, and assignments remain admin-controlled.
- Patient creation warns about **possible duplicates** using pairs of matching identity details. Doctors see only assigned charts; administrators can review potential duplicates clinic-wide. Creating another record despite a warning requires explicit acknowledgement; charts are never merged automatically.
- Append-only recent admin activity for doctor status and patient access changes; this does not replace server-side comprehensive audit logging.
- Patient-scoped lab reports and attachments (PDF/JPEG/PNG up to 10 MB) use optional private Firebase Storage with enforced care-team access; this requires Blaze, not Spark. Automated backups of files and clinic-wide file virus scanning are not implemented.

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

## Possible duplicate patient charts

Before creating a patient, the form checks matching names with dates of birth,
phones or emails (and a shared DOB with a matching contact detail). A phone
number or family email **alone** is not evidence of the same patient.
Matching is advisory, not a guaranteed identity system: spelling variants,
missing details or simultaneous registrations may escape detection.

Patient creation performs a fresh, authorized server read before saving and
fails closed if that directory check cannot complete. It is not a global
atomic uniqueness lock. Doctors review matches **only among assigned patients**.
They cannot search charts belonging exclusively to other doctors or access
private patient details through this feature. Administrators can inspect
clinic-wide duplicate pairs under Administration. Staff must confirm identity
before reusing any chart. There is no automatic merge, deletion or reassignment
of past medical history or prescriptions. Preserve existing chart identifiers.

## Patient lab reports and attachments (Blaze-plan optional module)

The Patient Chart contains a **Lab reports & files** tab for PDF, JPG and PNG
attachments (maximum 10 MiB). Authorized doctors and administrators may upload
files into the current patient's private chart; the file appears only after
the upload completes. Authorized users can download it with an authenticated
Storage SDK request (not a reusable public download token or Hosting link).
Original binary objects and audit-relevant Firestore attachment metadata are
immutable from the browser. Unfinished records remain visible as pending/failed
for administrator troubleshooting; they are **not** confirmed lab reports.

**You must opt in to a Firebase Blaze billing plan.** As of February 2026,
Firebase Cloud Storage access is no longer available on Spark. The application
keeps uploads disabled when `VITE_FIREBASE_STORAGE_BUCKET` is unset; there is
no secret workaround storing health documents in public Hosting or Firestore.
To enable safely after an authorized staging test:

1. Confirm the target Firebase project, a separate staging project and budget
   alarms, acceptable data region, retention policy and privacy agreement.
2. Upgrade the intended Firebase project to Blaze through Firebase Console.
   Create a **private** Firebase Storage bucket using Firebase Console.
   Note its actual bucket name (typically PROJECT_ID.firebasestorage.app).
3. Deploy and review `storage.rules` to this bucket from a trusted machine:
   `npx firebase-tools deploy --project PROJECT_ID --only storage`.
   Storage rules use the caller's Firestore user and patient chart to enforce
   approval, patient assignment, email verification for new doctors and
   immediate access revocation. Firebase may prompt you to authorize the
   Cloud Storage rules-to-Firestore service account. Do not make the bucket
   public. Ensure the storage rules are active **before** setting the env var.
4. Set `VITE_FIREBASE_STORAGE_BUCKET=ACTUAL_BUCKET_NAME` in the build
   environment, and deploy Hosting + Firestore rules only after validating
   authenticated upload/download and revocation on staging.
5. Run `npm run test:storage` and `npm run test:all` locally. Test on mobile,
   including upload failures and broken connections. Allow bucket CORS for the
   authorized app origins if required for authenticated browser blob downloads.
6. Arrange independent protected backups of **both Firestore metadata and
   Cloud Storage objects**; `clinic-backup.cjs` backs up Firestore only.

**Security/clinical limitation:** browsers check file signatures but this is
not antivirus scanning, PDF sanitization or laboratory-result validation.
Never rely on uploaded results without clinician verification. No public
URLs, browser delete, OCR, clinical interpretation, background malware scanning,
automatic file retention management, or automatic Storage backups are provided.
Deploy on patient-identifiable data only after clinical/security sign-off.
