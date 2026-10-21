export type Sex = 'female' | 'male' | 'other' | 'prefer-not-to-say';
export type AppRole = 'doctor' | 'admin' | 'unknown';

export interface PractitionerAccess {
  uid: string;
  active: boolean;
  role: AppRole;
  displayName?: string;
  email?: string;
}

export interface DoctorProfile {
  uid: string;
  active: boolean;
  role: 'doctor';
  displayName: string;
  email: string;
  deleted?: boolean;
}

export interface Patient {
  id: string;
  createdBy: string;
  doctorIds: string[];
  firstName: string;
  lastName: string;
  dateOfBirth?: string;
  sex?: Sex;
  phone?: string;
  email?: string;
  occupation?: string;
  address?: string;
  medicalHistory?: string;
  familyHistory?: string;
  allergies?: string;
  currentMedications?: string;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface PatientInput {
  firstName: string;
  lastName: string;
  dateOfBirth?: string;
  sex?: Sex;
  phone?: string;
  email?: string;
  occupation?: string;
  address?: string;
  medicalHistory?: string;
  familyHistory?: string;
  allergies?: string;
  currentMedications?: string;
}

export interface CaseRecord {
  id: string;
  createdBy: string;
  createdByName?: string;
  patientId: string;
  consultationDate: string;
  chiefComplaint: string;
  duration?: string;
  location?: string;
  sensation?: string;
  modalitiesBetter?: string;
  modalitiesWorse?: string;
  concomitants?: string;
  mentalGenerals?: string;
  physicalGenerals?: string;
  notes?: string;
  status: 'draft' | 'completed';
  createdAt?: Date;
  updatedAt?: Date;
}

export type CaseInput = Omit<CaseRecord, 'id' | 'createdBy' | 'createdByName' | 'patientId' | 'createdAt' | 'updatedAt'>;

export interface RemedySuggestion {
  remedy: string;
  commonName: string;
  score: number;
  matchedCharacteristics: string[];
  unmatchedCharacteristics: string[];
  rationale: string;
  sourceNote: string;
}

export interface SuggestionResult {
  blocked: boolean;
  redFlags: string[];
  suggestions: RemedySuggestion[];
  analyzedText: string;
}

export interface MedicineCode {
  id: string;
  code: string;
  remedyName: string;
  notes?: string;
  active: boolean;
  approvedForNewRx: boolean;
  expertVerified?: boolean;
  legacyCode?: string;
  traditionalAbbreviation?: string;
  synonymsOrAliases?: string;
  sourceCoverage?: string;
  releaseVersion?: string;
  createdBy?: string;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface PrescriptionItem {
  code: string;
  potency?: string;
  dosageForm?: string;
  directions: string;
  quantity?: string;
}

export interface PrescriptionRecord {
  id: string;
  patientId: string;
  createdBy: string;
  issuedByName: string;
  issuedAt: string;
  items: PrescriptionItem[];
  patientInstructions?: string;
  clinicalReviewConfirmed?: boolean;
  voidedAt?: Date;
  voidedBy?: string;
  voidReason?: string;
  createdAt?: Date;
}
