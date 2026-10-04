import { describe, expect, it } from 'vitest';
import type { CaseInput } from '../types';
import { detectRedFlags, suggestRemedies } from './remedyEngine';

const baseCase: CaseInput = {
  consultationDate: '2026-10-05',
  chiefComplaint: 'Headache',
  status: 'draft',
};

describe('remedy engine', () => {
  it('ranks Bryonia highest for a motion-aggravated, rest-improved picture', () => {
    const result = suggestRemedies({
      ...baseCase,
      sensation: 'dry headache',
      modalitiesWorse: 'motion',
      modalitiesBetter: 'rest and pressure',
    });

    expect(result.blocked).toBe(false);
    expect(result.suggestions[0]?.remedy).toBe('Bryonia alba');
    expect(result.suggestions[0]?.matchedCharacteristics).toContain('Worse from movement');
  });

  it('blocks remedy suggestions when an emergency red flag is present', () => {
    const result = suggestRemedies({
      ...baseCase,
      chiefComplaint: 'Crushing chest pain with shortness of breath',
    });

    expect(result.blocked).toBe(true);
    expect(result.suggestions).toHaveLength(0);
    expect(result.redFlags.length).toBeGreaterThan(0);
  });

  it('detects neurological emergency language', () => {
    expect(
      detectRedFlags({
        ...baseCase,
        chiefComplaint: 'Sudden facial droop and slurred speech',
      }),
    ).toContain('Possible stroke symptom');
  });
});
