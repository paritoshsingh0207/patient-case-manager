/** Client-side preflight for the 881-entry clinician-approved registry export.
 * The server repeats all validation; a browser is not a trust boundary.
 */
export interface VerifiedImportEntry {
  code: string;
  remedyName: string;
  expertVerified: true;
  reviewStatus: 'Verified';
  legacyCode?: string;
  traditionalAbbreviation?: string;
  synonymsOrAliases?: string;
  sourceCoverage?: string;
}
export interface VerifiedImport {
  schemaVersion: '1';
  releaseVersion: '1.0-expert-verified';
  documents: VerifiedImportEntry[];
}
export function parseVerifiedMedicineJson(json: string): VerifiedImport {
  const value: unknown = JSON.parse(json);
  if (!value || typeof value !== 'object') throw Error('Expected a JSON registry object.');
  const data = value as Record<string, unknown>;
  if (data.schemaVersion !== '1' || data.releaseVersion !== '1.0-expert-verified' || !Array.isArray(data.documents) || data.documents.length !== 881) {
    throw Error('Select the expert-verified v1 JSON file with exactly 881 entries.');
  }
  const codes = new Set<string>();
  const names = new Set<string>();
  const documents: VerifiedImportEntry[] = data.documents.map((raw: unknown) => {
    if (!raw || typeof raw !== 'object') throw Error('Invalid medicine row.');
    const item = raw as Record<string, unknown>;
    if (typeof item.code !== 'string' || typeof item.remedyName !== 'string' ||
      !/^[A-Z]{2}[1-9]\d*$/.test(item.code) ||
      item.code.slice(0, 2) !== item.remedyName.toUpperCase().replace(/[^A-Z]/g, '').slice(0, 2) ||
      item.expertVerified !== true || item.reviewStatus !== 'Verified') {
      throw Error('Invalid or unverified code/name in the registry.');
    }
    const name = item.remedyName.trim().toLowerCase();
    if (!name || codes.has(item.code) || names.has(name)) throw Error('Empty or duplicated code/medicine name.');
    codes.add(item.code);
    names.add(name);
    return {
      code: item.code,
      remedyName: item.remedyName,
      expertVerified: true,
      reviewStatus: 'Verified',
      legacyCode: typeof item.legacyCode === 'string' ? item.legacyCode : '',
      traditionalAbbreviation: typeof item.traditionalAbbreviation === 'string' ? item.traditionalAbbreviation : '',
      synonymsOrAliases: typeof item.synonymsOrAliases === 'string' ? item.synonymsOrAliases : '',
      sourceCoverage: typeof item.sourceCoverage === 'string' ? item.sourceCoverage : '',
    };
  });
  return { schemaVersion: '1', releaseVersion: '1.0-expert-verified', documents };
}
