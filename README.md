# Patient Case Manager

Firebase-ready patient case management workspace with a practitioner-facing homeopathy remedy suggestion module.

## What is included

- Firebase Email/Password authentication
- Owner-scoped Cloud Firestore patient records
- Structured patient demographics and clinical history
- Longitudinal consultation/case timeline
- Characteristic symptom capture: location, sensation, modalities and concomitants
- Transparent traditional homeopathy pattern matching with matched-characteristic explanations
- Emergency red-flag blocking before remedy ranking
- Firebase Hosting SPA configuration
- Firestore and Storage Security Rules
- Unit tests for the remedy engine
- Firestore Security Rules emulator tests
- GitHub Actions CI for tests and production build

> The remedy module is practitioner decision support, not a diagnosis or prescription. It intentionally does not provide potency or dosing instructions. Homeopathy has not been shown to be an effective treatment for medical conditions beyond placebo; conventional evaluation and treatment should not be delayed, especially for urgent symptoms.

## Local setup

Prerequisites: Node.js 22+, npm, and Java 21+ (for the Firestore emulator tests).

```bash
npm install
cp .env.example .env.local
npm run dev
```

Create a Firebase Web App and place its public web configuration values in `.env.local`:

```dotenv
VITE_FIREBASE_API_KEY=...
VITE_FIREBASE_AUTH_DOMAIN=...
VITE_FIREBASE_PROJECT_ID=...
VITE_FIREBASE_STORAGE_BUCKET=...
VITE_FIREBASE_MESSAGING_SENDER_ID=...
VITE_FIREBASE_APP_ID=...
```

In the Firebase console:

1. Enable **Authentication > Sign-in method > Email/Password**.
2. Create a **Cloud Firestore** database.
3. Create/enable **Cloud Storage** if you plan to add attachments.
4. Register your production domain under Authentication authorized domains after Hosting is deployed.

## Test and build

```bash
npm test
npm run test:rules
npm run build
```

`npm run test:rules` starts the Firestore emulator against a demo project ID; it does not touch production data.

## Firebase deployment

Install/login with the Firebase CLI once and associate this checkout with your real Firebase project:

```bash
npx firebase-tools login
npx firebase-tools use --add
npm run build
npx firebase-tools deploy
```

The repository deliberately does not commit a real `.firebaserc` project ID or Firebase credentials. `firebase.json` deploys `dist/` through classic Firebase Hosting and rewrites all routes to `index.html` for the SPA.

For CI/CD deployment, use a Google service account / workload identity setup with the minimum required Firebase permissions; do not commit service-account JSON or a Firebase token to the repository.

## Firestore model

```text
patients/{patientId}
  ownerId
  demographics/history...

patients/{patientId}/cases/{caseId}
  ownerId
  structured consultation fields...

patients/{patientId}/suggestions/{suggestionId}
  ownerId
  caseInput
  suggestions[]
  redFlags[]
  engineVersion

patients/{patientId}/followUps/{followUpId}
patients/{patientId}/prescriptions/{prescriptionId}
```

All patient and nested case data is scoped to the authenticated `ownerId` by Firestore Security Rules. Queries in the frontend also constrain patients by `ownerId` because Firestore Security Rules are not server-side filters.

## Next implementation steps

The current baseline is deliberately focused on getting a secure Firebase-hosted MVP working. Next additions should be:

- Edit patient and case screens
- Follow-up workflow and outcome tracking
- Uploads for reports/attachments under the already-scoped Storage path
- Repertory/rubric database import with provenance and licensing review
- Materia medica citations for every ranked candidate
- Practitioner-selected prescription record kept separate from machine suggestions
- Audit logging and organization/team access model if multiple practitioners will share patients
- App Check, production monitoring, backup/retention and jurisdiction-specific privacy/compliance review before real patient use

### Optional GitHub Actions deployment

`.github/workflows/firebase-deploy.yml` provides a manual **Deploy Firebase** workflow. Configure these repository variables:

- `VITE_FIREBASE_API_KEY`
- `VITE_FIREBASE_AUTH_DOMAIN`
- `VITE_FIREBASE_PROJECT_ID`
- `VITE_FIREBASE_STORAGE_BUCKET`
- `VITE_FIREBASE_MESSAGING_SENDER_ID`
- `VITE_FIREBASE_APP_ID`

Add `FIREBASE_SERVICE_ACCOUNT` as a GitHub Actions secret containing a service-account JSON credential with only the permissions needed to deploy the enabled Firebase resources. The workflow runs unit tests, Firestore rules tests and the production build before deployment.
