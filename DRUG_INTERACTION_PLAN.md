# Proposed Drug Interaction & Contraindication Checker

**Status:** architecture and clinical validation plan only. Not a clinical feature and not enabled
for patient care until source licensing, data completeness, validation and sign-off.

## Scope and safety policy

- Build an **assistive review module**, never an automatic prescribing engine.
- Include: therapeutic drug–drug interactions, listed allergies/hypersensitivity,
  documented contraindications and warnings for relevant diseases, pregnancy/
  lactation and patient factors, duplication by active ingredient, and important
  age/renal/hepatic concerns where a vetted data source covers them.
- An absent match or unavailable data MUST display **"Unable to check"**, not
  "No interactions"; missing patient details must not be silently assumed normal.
- Preserve the current homeopathic medicine-code registry but **do not infer**
  ingredient, pharmacology, potency, mechanism or evidence from an AB code alone.
  Require a reviewed mapping to standard medicinal products or a manually
  acknowledged "not covered / unknown" state. Homeopathic products may lack
  evidence-based interaction data, and dilution does not prove universal safety.
- Drug information is a changing, regulated clinical dataset, not a
  keyword-matching pattern table or generative model. Require sources, dataset
  version, severity/evidence and an update cadence for each alert.

## Phased delivery

### Phase 0: clinical governance and source selection
1. Assign a pharmacist/clinician owner and define use jurisdiction (India or
   another specified region), intended users, incident handling, licensing,
   privacy review and documented clinical sign-off.
2. Evaluate a **licensed and maintained** structured DDI knowledge provider
   (e.g. First Databank, Medi-Span, DrugBank commercial offerings) with explicit
   use rights, local formulary coverage, versioning and update SLAs.
3. Use RxNorm/RxCUI only where mapping is appropriate. RxNorm is nomenclature,
   **not** a current RxNav interactions service: NLM discontinued its
   drug–drug interaction API in January 2024.
4. Use DailyMed or openFDA labeling as supporting referenced information for
   contraindications, warnings, and interactions, not as a complete or
   exhaustively machine-readable interaction engine. Examine India-specific
   approvals and labeling separately; label data can be incomplete or delayed.

### Phase 1: structured clinical data
- Add a governed medication list: product/ingredient, standardized identifier,
  strength, formulation, route, dose, frequency, duration, status, source,
  last confirmed date. Store prescription snapshot as issued, do not mutate it.
- Structure allergies with substance, reaction, severity and verification.
  Collect clinician-confirmed pregnancy status, relevant diagnoses and organ
  function observations only where clinically appropriate and permitted.
- Build a versioned code-to-ingredient mapping **with manual review** and
  explicit unknowns; never equate unknown AB codes with allopathic drugs.

### Phase 2: rules engine and explainable alerts
- Implement server-side or authenticated trusted backend evaluation (Blaze
  likely required for automatic secure ingestion; otherwise versioned offline
  signed dataset with controlled import into Firestore).
- Check pairwise and component-level interactions plus contraindication rules,
  drug–allergy cross-sensitivity, duplicated active ingredients, and
  ingredient-specific patient context.
- Result schema includes alert ID, rule/knowledgebase version, matched
  patient medication IDs, severity (critical/major/moderate/info/unknown),
  evidence quality, plain-language mechanism/clinical consequence, recommended
  clinician action, source label/link and as-of date.
- Show **coverage** and missing information separately from the alert list.
  No result is not equivalent to clinical clearance.
- Do not rely on public client-side APIs for private patient data; submit
  minimum-necessary standardized drug IDs from a secured service.

### Phase 3: practitioner workflow
- At prescribing and on patient chart: review panel with "Potential
  interactions", "Contraindications", "Allergy checks", and "Not checked".
- Critical alerts require explicit acknowledgment and reason, or prevent a
  release if approved clinical policy mandates a hard stop. Never hide an
  alert by silently editing historical prescriptions.
- Persist immutable per-prescription evaluation snapshot, provenance,
  rule-version, timestamps and prescriber override; audit changes and
  source updates. Provide rapid access to complete human-readable identity.

### Phase 4: validation and pilot
- Pharmacist-created high-risk test cases, common polypharmacy sets,
  allergy/contraindication examples, known negatives, missing-data cases,
  pediatric/pregnancy/renal cases and performance/load checks.
- Validate sensitivity/specificity, false positives, risk of alert fatigue,
  terminology mapping and medication selection with blinded clinical review.
- Validate real-world Indian formulary and labels. Use patient-free synthetic
  tests, a monitored staging environment and a limited shadow-mode pilot.
- Enforce release gates and refresh monitoring; if source refresh fails or
  mapping becomes uncertain, display **"Drug safety check unavailable"**
  and require manual clinician/pharmacist review.
- No autonomous drug recommendation, no claims of medical-device clearance,
  and no clinical production enablement without approved local governance.

## Integration with Patient Case Manager

Doctor enters a proposed medicinal product => resolve reviewed standardized
ingredients and dose => load authorized structured active medications,
allergies and relevant patient factors => evaluate a versioned ruleset =>
return explainable alerts and coverage => clinician acknowledges =>
save a non-editable analysis snapshot on the patient chart.

Clinical attachments may provide evidence but will **not automatically populate
medication lists or lab values** until an independently validated extraction and
clinician confirmation workflow exists.

## Implementation dependencies

- Decision on licensed knowledgebase and geographic jurisdiction
- Drug mapping and human clinical review resources
- Secure refresh pipeline, audit and alert-monitoring ownership
- Staging test users and approved regulatory/privacy checklist

**Do not use discontinued NLM RxNav DDI endpoints, scrape unlicensed
proprietary data, or substitute the traditional homeopathy symptom matcher
for a drug safety checker.**
