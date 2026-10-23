# Patient Case Manager: isolated staging and recovery acceptance

This product manages *clinical cases only*. Awakening continues to manage
online booking. Do not change or deploy Awakening's website from this project.

## Prerequisites
- Verify the exact Firebase source project and separate empty staging project.
  Staging IDs must end with -staging/-test or start demo-.
- A trusted computer must have Node.js, npm install, a valid firebase login,
  and Google Cloud IAM permission to read the source Firestore data.
- Use an offline, access-controlled, encrypted backup destination, preferably
  a secure folder outside the project. Restrict who can access archive files.
- Don't perform export while patient records are being edited; exports are NOT
  server-atomic snapshots. Compare totals against source.
- This tool backs up users, patients, medicineCodes and auditEvents roots,
  plus every nested patients subcollection, but deliberately skips unrelated
  top-level Awakening collections.

## Export and cryptographic verification
Use a new dated output filename, never overwrite an existing backup:

    node functions/scripts/clinic-backup.cjs export --project=SOURCE --confirm-project=SOURCE --out="C:\private-clinic-backups\2026-10-23.pcmbackup"
    node functions/scripts/clinic-backup.cjs verify --file="C:\private-clinic-backups\2026-10-23.pcmbackup"

When prompted, provide a strong unique passphrase (at least 16 characters).
Record the archive digest, source project, document counts, encryption key
custodian and offline storage location; not patient names or plain records.
Keep the passphrase separate from the encrypted file.

## Restoration (dry run by default, STAGING ONLY)
With a separate new, empty staging Firebase project:

    node functions/scripts/clinic-backup.cjs restore --file="C:\private-clinic-backups\2026-10-23.pcmbackup" --project=ISOLATED-STAGING
    node functions/scripts/clinic-backup.cjs restore --file="C:\private-clinic-backups\2026-10-23.pcmbackup" --project=ISOLATED-STAGING --apply --confirm-staging=ISOLATED-STAGING

The script prevents production/source restores, rejects populated staging
projects and never overwrites a document. If staging restore is interrupted,
start again with a NEW empty staging project. It does not restore Authentication
accounts, passwords, Hosting, Cloud Storage, Firestore indexes or rules.
Provision separate test accounts as necessary.

## Release verification with synthetic cases
- Admin and doctor logins work, doctor self-registration awaits approval and
  verified email, and another administrator can be invited.
- Assigned doctors can view historical cases and prescriptions; unassigned or
  deactivated doctors cannot read patient or nested clinical data.
- Removing one doctor blocks access while retaining another assigned doctor.
- Internal clinical follow-ups can be created and completed only by assigned
  doctors; they are not booked appointments or public reminders.
- New consultations record assessment, vitals and plans, compare previous
  consultations, and do not alter signed records or transfer drafts between patients.
- Admin activity log is only a partial administrative write log; do not mistake
  it for a full read access audit.
- On-screen Rx shows medicine code and name; printed Rx shows the code while
  retaining clinically required strength, form and directions.
- Check 360px mobile, tablet, desktop and browser print preview, including
  empty, error and permission-denied states.
- No booking/payment portal is added here; Awakening owns booking.

Record a verified staging restore and manually signed-off tests before any
production rollout. Passing synthetic unit tests is not a real restore drill.

After any completed staging restore, independently repeat the read-only check:

    node functions/scripts/clinic-backup.cjs check-staging --file="C:\private-clinic-backups\2026-10-23.pcmbackup" --project=ISOLATED-STAGING

The verification compares every restored Firestore document path and field value,
including nested clinical records and reference values retargeted to staging.
A successful synthetic cryptographic test or CLI dry run does not certify a
successful live staging restore.
