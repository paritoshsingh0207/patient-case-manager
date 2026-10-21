# Patient Case Manager — Firebase Spark Edition

Patient case management with role-based doctor access, an expert-verified homeopathic
medicine dictionary, and coded prescriptions. The deployed application uses
**Firebase Hosting, Authentication and Firestore only** — no Cloud Functions
or Cloud Storage. The functions/ directory holds trusted offline admin scripts.

## Architecture

- Authentication: email/password with no public registration.
- Firestore users/{uid}: trusted offline provisioning of admin and doctor profiles.
  Browser writes to any user role are forbidden.
- Firestore patients/{id}: administrator controls doctorIds; doctors see only assigned patients.
- Firestore medicineCodes/{AB1...}: immutable approved mappings and legacy B aliases.
  Browser writes are forbidden.
- Firestore patients/{id}/prescriptions/{rxId}: one medicine per new prescription
  document. Rules validate the code against its approved registry record, and
  record the issuing doctor, potency, form, directions, date, and review attestation.
  Historical multi-item records remain readable. Incorrect prescriptions may be
  voided with an audit reason but cannot be silently deleted or changed.
- No file attachments / Cloud Storage feature.

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
