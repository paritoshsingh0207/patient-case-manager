# Phase 1 — local-only clinical report parser

Internal browser-only helper in Patient Case Manager. It does not send the original
PDF or extracted text to an API, Firestore, Firebase Storage, AI Logic, logging,
or the clinic's separate booking system.

## Access
Extract Report appears only for an active authenticated doctor viewing an assigned
patient. Existing patient doctorIds checks remain unchanged. No Firestore rules
or server routes are modified.

## Workflow
1. Open an assigned patient's chart and select Extract Report.
2. Select a PDF (up to 12 MiB / 50 pages); processing is in browser memory.
3. PDF.js extracts page text in approximate reading order.
4. Sparse and image-only pages use same-origin Tesseract English OCR.
5. Review the page preview and correct the editable transcription manually.
6. Cancel, clear or change patients to discard the report.
Nothing is saved in Phase 1.

## Install and verify
Run npm install and commit the resulting package-lock.json before merging.
The prebuild and predev scripts copy OCR assets from installed dependencies into
public/ocr. Generated assets are gitignored and bundled by Vite at build time.
Never replace these with an OCR CDN.

Commands: npm install; npm run test:parser; npm run test:all; npm run build.

Unit tests mock PDF.js and OCR; they do not prove medical accuracy.
Browser checks must cover digital, scanned, mixed, encrypted, corrupt, and
oversized PDFs, as well as cancellation, mobile layouts and patient switching.
Verify Network does not transmit PDF content or extracted text.

## Limitations
- Not a validated diagnostic or laboratory result interpretation system.
- OCR can alter units, tables, decimals and other clinical details.
- WASM/OCR assets consume Firebase Hosting transfer and storage quotas.
- Local buffers may survive briefly inside browser/OS memory after clearing.
- Existing optional Blaze-only attachment tab is independent and unchanged.
- No AI calls, report saving, database schema or clinical sign-off is included.
- Do not deploy before clinical/security acceptance and complete CI checks.
