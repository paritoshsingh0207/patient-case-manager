export type Sex = 'female' | 'male' | 'other' | 'prefer-not-to-say';

export interface Patient {
  id: string;
  ownerId: string;
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
  ownerId: string;
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

export type CaseInput = Omit<CaseRecord, 'id' | 'ownerId' | 'patientId' | 'createdAt' | 'updatedAt'>;

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
