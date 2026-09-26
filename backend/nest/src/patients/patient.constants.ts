export const GENDERS = ['Male', 'Female'] as const;
export type Gender = (typeof GENDERS)[number];

export const PATIENT_STATUSES = [
  'Active',
  'Discharged',
  'Critical',
  'Follow-up',
] as const;
export type PatientStatus = (typeof PATIENT_STATUSES)[number];
