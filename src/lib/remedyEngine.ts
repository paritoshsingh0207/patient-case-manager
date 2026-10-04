import type { CaseInput, RemedySuggestion, SuggestionResult } from '../types';

type RemedyPattern = {
  remedy: string;
  commonName: string;
  characteristics: Array<{ phrase: string; weight: number; explanation: string }>;
  rationale: string;
};

const RED_FLAGS: Array<{ pattern: RegExp; message: string }> = [
  { pattern: /chest pain|pressure in chest|crushing chest/i, message: 'Possible cardiac emergency symptom' },
  { pattern: /difficulty breathing|shortness of breath|cannot breathe|blue lips/i, message: 'Possible breathing emergency' },
  { pattern: /one[- ]sided weakness|facial droop|slurred speech|sudden confusion/i, message: 'Possible stroke symptom' },
  { pattern: /severe bleeding|uncontrolled bleeding|vomiting blood|black tarry stool/i, message: 'Possible major bleeding' },
  { pattern: /suicidal|self[- ]harm|want to die/i, message: 'Possible mental-health emergency' },
  { pattern: /stiff neck.*fever|fever.*stiff neck|seizure|unconscious/i, message: 'Possible neurological or infectious emergency' },
];

const PATTERNS: RemedyPattern[] = [
  {
    remedy: 'Aconitum napellus',
    commonName: 'Aconite',
    rationale: 'Traditional homeopathic picture emphasizing sudden onset, marked restlessness and fear.',
    characteristics: [
      { phrase: 'sudden', weight: 3, explanation: 'Sudden onset' },
      { phrase: 'restless', weight: 2, explanation: 'Marked restlessness' },
      { phrase: 'fear', weight: 2, explanation: 'Fear or panic' },
      { phrase: 'cold wind', weight: 2, explanation: 'Symptoms after cold, dry wind' },
    ],
  },
  {
    remedy: 'Arsenicum album',
    commonName: 'Arsenicum',
    rationale: 'Traditional picture combining restlessness, anxiety, burning sensations and desire for warmth.',
    characteristics: [
      { phrase: 'burning', weight: 3, explanation: 'Burning sensation' },
      { phrase: 'better warmth', weight: 3, explanation: 'Better from warmth' },
      { phrase: 'restless', weight: 2, explanation: 'Restlessness' },
      { phrase: 'anxious', weight: 2, explanation: 'Anxiety' },
      { phrase: 'small sips', weight: 2, explanation: 'Thirst for frequent small sips' },
      { phrase: 'after midnight', weight: 2, explanation: 'Worse after midnight' },
    ],
  },
  {
    remedy: 'Belladonna',
    commonName: 'Deadly nightshade',
    rationale: 'Traditional picture emphasizing sudden, intense, throbbing symptoms with sensitivity to light or noise.',
    characteristics: [
      { phrase: 'throbbing', weight: 3, explanation: 'Throbbing sensation' },
      { phrase: 'sudden', weight: 2, explanation: 'Sudden onset' },
      { phrase: 'worse light', weight: 3, explanation: 'Worse from light' },
      { phrase: 'worse noise', weight: 3, explanation: 'Worse from noise' },
      { phrase: 'red', weight: 1, explanation: 'Redness or flushing' },
      { phrase: 'hot', weight: 1, explanation: 'Heat' },
    ],
  },
  {
    remedy: 'Bryonia alba',
    commonName: 'Bryonia',
    rationale: 'Traditional picture emphasizing aggravation from movement and relief from rest or firm pressure.',
    characteristics: [
      { phrase: 'worse motion', weight: 4, explanation: 'Worse from movement' },
      { phrase: 'better rest', weight: 3, explanation: 'Better from rest' },
      { phrase: 'better pressure', weight: 2, explanation: 'Better from pressure' },
      { phrase: 'dry', weight: 1, explanation: 'Dryness' },
      { phrase: 'large quantities', weight: 2, explanation: 'Thirst for larger quantities' },
    ],
  },
  {
    remedy: 'Gelsemium sempervirens',
    commonName: 'Gelsemium',
    rationale: 'Traditional picture emphasizing heaviness, drowsiness, trembling and anticipatory weakness.',
    characteristics: [
      { phrase: 'heavy', weight: 2, explanation: 'Heaviness' },
      { phrase: 'drowsy', weight: 2, explanation: 'Drowsiness' },
      { phrase: 'trembling', weight: 3, explanation: 'Trembling' },
      { phrase: 'anticipatory', weight: 3, explanation: 'Anticipatory symptoms' },
      { phrase: 'weakness', weight: 2, explanation: 'Weakness' },
    ],
  },
  {
    remedy: 'Nux vomica',
    commonName: 'Nux vomica',
    rationale: 'Traditional picture emphasizing irritability, digestive upset after excess and chilliness.',
    characteristics: [
      { phrase: 'irritable', weight: 3, explanation: 'Irritability' },
      { phrase: 'overindulgence', weight: 3, explanation: 'Complaint after dietary or stimulant excess' },
      { phrase: 'chilly', weight: 2, explanation: 'Chilliness' },
      { phrase: 'worse morning', weight: 2, explanation: 'Worse in the morning' },
      { phrase: 'constipation', weight: 2, explanation: 'Constipation' },
    ],
  },
  {
    remedy: 'Pulsatilla',
    commonName: 'Wind flower',
    rationale: 'Traditional picture emphasizing changeable symptoms, open-air relief and low thirst.',
    characteristics: [
      { phrase: 'changeable', weight: 3, explanation: 'Changeable symptom picture' },
      { phrase: 'better open air', weight: 4, explanation: 'Better in open air' },
      { phrase: 'worse warm room', weight: 3, explanation: 'Worse in a warm room' },
      { phrase: 'thirstless', weight: 3, explanation: 'Low or absent thirst' },
      { phrase: 'weeping', weight: 1, explanation: 'Tearful emotional state' },
    ],
  },
  {
    remedy: 'Rhus toxicodendron',
    commonName: 'Rhus tox',
    rationale: 'Traditional picture emphasizing stiffness worse after rest and better with continued movement or warmth.',
    characteristics: [
      { phrase: 'stiff', weight: 3, explanation: 'Stiffness' },
      { phrase: 'worse rest', weight: 3, explanation: 'Worse after rest' },
      { phrase: 'better motion', weight: 4, explanation: 'Better with continued movement' },
      { phrase: 'better warmth', weight: 2, explanation: 'Better from warmth' },
      { phrase: 'damp', weight: 1, explanation: 'Associated with damp weather/exposure' },
    ],
  },
];

function normalize(input: string): string {
  return input
    .toLowerCase()
    .replace(/[–—]/g, '-')
    .replace(/\s+/g, ' ')
    .trim();
}

function modalityText(prefix: 'better' | 'worse', value?: string): string {
  if (!value) return '';
  const parts = value.split(/\s*(?:,|;|\band\b)\s*/i).filter(Boolean);
  return parts.map((item) => `${prefix} ${item.trim()}`).join(' ');
}

function caseText(caseInput: CaseInput): string {
  return normalize(
    [
      caseInput.chiefComplaint,
      caseInput.duration,
      caseInput.location,
      caseInput.sensation,
      modalityText('better', caseInput.modalitiesBetter),
      modalityText('worse', caseInput.modalitiesWorse),
      caseInput.concomitants,
      caseInput.mentalGenerals,
      caseInput.physicalGenerals,
      caseInput.notes,
    ]
      .filter(Boolean)
      .join(' | '),
  );
}

export function detectRedFlags(input: CaseInput): string[] {
  const text = caseText(input);
  return RED_FLAGS.filter(({ pattern }) => pattern.test(text)).map(({ message }) => message);
}

export function suggestRemedies(input: CaseInput): SuggestionResult {
  const text = caseText(input);
  const redFlags = detectRedFlags(input);

  if (redFlags.length > 0) {
    return {
      blocked: true,
      redFlags,
      suggestions: [],
      analyzedText: text,
    };
  }

  const raw = PATTERNS.map<RemedySuggestion>((pattern) => {
    const matched = pattern.characteristics.filter(({ phrase }) => text.includes(phrase));
    const unmatched = pattern.characteristics.filter(({ phrase }) => !text.includes(phrase));
    const totalWeight = pattern.characteristics.reduce((sum, item) => sum + item.weight, 0);
    const matchedWeight = matched.reduce((sum, item) => sum + item.weight, 0);

    return {
      remedy: pattern.remedy,
      commonName: pattern.commonName,
      score: totalWeight === 0 ? 0 : Math.round((matchedWeight / totalWeight) * 100),
      matchedCharacteristics: matched.map((item) => item.explanation),
      unmatchedCharacteristics: unmatched.map((item) => item.explanation),
      rationale: pattern.rationale,
      sourceNote:
        'Traditional homeopathic materia medica pattern for practitioner review; this is not a validated clinical treatment recommendation.',
    };
  });

  return {
    blocked: false,
    redFlags: [],
    suggestions: raw
      .filter((item) => item.score > 0)
      .sort((a, b) => b.score - a.score || a.remedy.localeCompare(b.remedy))
      .slice(0, 5),
    analyzedText: text,
  };
}
