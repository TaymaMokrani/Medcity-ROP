import { apiGet, apiPost, apiPut, apiDelete, ApiError } from "./api";

export interface Patient {
  id: string;
  firstName: string;
  lastName: string;
  dateOfBirth: string;
  gender: "Male" | "Female";
  gestationalAge: number;
  birthWeight: number;
  motherName: string;
  phone: string;
  email: string;
  address: string;
  bloodType: string;
  notes: string;
  status: "Active" | "Discharged" | "Critical" | "Follow-up";
  createdAt: string;
}

export async function getPatients(): Promise<Patient[]> {
  return apiGet<Patient[]>("/patients");
}

export async function getPatientById(id: string): Promise<Patient | undefined> {
  try {
    return await apiGet<Patient>(`/patients/${id}`);
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) return undefined;
    throw e;
  }
}

export async function addPatient(data: Omit<Patient, "id" | "createdAt">): Promise<Patient> {
  return apiPost<Patient>("/patients", data);
}

export async function updatePatient(
  id: string,
  data: Partial<Patient>,
): Promise<Patient> {
  return apiPut<Patient>(`/patients/${id}`, data);
}

export async function deletePatient(id: string): Promise<void> {
  await apiDelete<{ success: boolean }>(`/patients/${id}`);
}
