import { IsString, IsOptional, IsIn } from 'class-validator';
import {
  DOCTOR_DECISIONS,
  EYE_SELECTIONS,
  type DoctorDecision,
  type EyeSelection,
} from '../rop';

export class UpdateDetectionDto {
  @IsString()
  @IsOptional()
  patientId?: string;

  @IsString()
  @IsOptional()
  patientName?: string;

  @IsString()
  @IsOptional()
  date?: string;

  @IsIn(EYE_SELECTIONS)
  @IsOptional()
  eye?: EyeSelection;

  @IsString()
  @IsOptional()
  notes?: string;

  @IsIn(DOCTOR_DECISIONS)
  @IsOptional()
  doctorDecision?: DoctorDecision;
}
