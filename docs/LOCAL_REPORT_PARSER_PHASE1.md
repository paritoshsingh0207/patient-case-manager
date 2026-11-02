# Local PDF extraction and saved text reports (Firebase Spark)

The original PDF and OCR processing stay in the clinician's browser. After review,
an assigned doctor may explicitly save the **corrected text only** into Cloud Firestore.
No PDF bytes, images, Storage bucket, Cloud Functions, or Blaze plan are required.

## Steps

1. Sign in as an active approved doctor and open a patient assigned to your account.
2. In **Extract Report**, choose a PDF up to 12 MiB / 50 pages.
3. Review each page against its original preview and correct OCR or PDF text errors.
4. Enter a report name, tick the review confirmation, and choose **Save reviewed text to patient record**.
5. The new **Saved Reports** tab opens. Authorized clinic admins and currently
   assigned, active doctors can read that patient's saved report transcriptions later.
6. Saving another report creates a new document. Existing saved reports are
   append-only and cannot be changed or deleted through the browser.

## Firestore data model

`patients/{patientId}/reports/{reportId}` (one document per report):
- `patientId`, `createdBy`: patient and authenticated author IDs
- `reportName`: clinician-selected display title (up to 120 characters)
- `content`: reviewed, page-separated plain text (maximum 120,000 UTF-8 bytes)
- `pageCount`: 1–50, `ocrUsed`: boolean, `reviewed`: true
- `schemaVersion`: 1 and `createdAt`: server timestamp

Firestore Security Rules limit reads to current patient care teams and active
administrators, writes to currently assigned active doctors, and deny update/delete.
Existing patient data, consultations and prescriptions are unchanged. The default
rules for the retired `patients/{id}/attachments` paths remain deny-all.

## Testing and release

Run `npm ci`, `npm run test:all`, and `npm run build` before deploying.
Review and deploy **Firestore rules before enabling the new save UI** on a live
Firebase site: `firebase deploy --project PROJECT_ID --only firestore`.
Then deploy Hosting after staging approval:
`firebase deploy --project PROJECT_ID --only hosting`.
Never use a blanket `firebase deploy` or deploy Storage/Functions.

Test assigned doctor saving/viewing, an admin reading, a different doctor's
denial, and revocation after removing an assignment. Review with synthetic
digital, scanned and mixed PDFs and verify the Network panel sends only the
explicitly saved text to Firestore, not the original binary file.

## Safety and limitations

- Saved records contain medical information: Firebase Auth, Firestore Rules,
  browser permissions, consent, retention, backup and compliance review matter.
- Optical recognition is fallible: clinicians must check numbers, units,
  abbreviations and tables against the original report.
- The app stores **transcription only**, not the source PDF or its authenticity;
  retain the original through an approved clinic process outside this app.
- Saves require connectivity and count toward Spark Firestore free-tier
  read/write/storage quotas; large reports exceeding the safe limit are rejected.
- Full Firestore rules or browser-only validation are not replacements for a
  clinical governance review. Existing offline encrypted backup includes reachable
  patient report subcollections; confirm this with a staging restoration test.
