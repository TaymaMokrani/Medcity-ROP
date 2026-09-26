import {
  IsString,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsIn,
  Max,
  Min,
} from 'class-validator';
import {
  GENDERS,
  PATIENT_STATUSES,
  type Gender,
  type PatientStatus,
} from '../patient.constants';

export class CreatePatientDto {
  @IsString()
  @IsNotEmpty()
  firstName: string;

  @IsString()
  @IsNotEmpty()
  lastName: string;

  @IsString()
  @IsNotEmpty()
  dateOfBirth: string;

  @IsIn(GENDERS)
  gender: Gender;

  /**
   * Weeks at birth, 20 to 42.
   *
   * The range is enforced here and not only in the form, because this number
   * is fed to the screening model. A typed 2 instead of 28 would come back as
   * a risk with nothing to say it was nonsense.
   */
  @IsNumber()
  @Min(20)
  @Max(42)
  gestationalAge: number;

  /** Grams at birth, 300 to 5000. Same reason as gestational age. */
  @IsNumber()
  @Min(300)
  @Max(5000)
  birthWeight: number;

  /** Optional: a baby can arrive in the unit before the mother is identified. */
  @IsString()
  @IsOptional()
  motherName?: string;

  @IsString()
  @IsOptional()
  phone?: string;

  @IsString()
  @IsOptional()
  email?: string;

  @IsString()
  @IsOptional()
  address?: string;

  @IsString()
  @IsOptional()
  bloodType?: string;

  @IsString()
  @IsOptional()
  notes?: string;

  /**
   * Administrative status.
   *
   * Optional, and no longer asked for in the app. It was a second status sitting
   * beside the screening state — one typed by hand, one computed — both drawn as
   * red and green pills, meaning different things. The screening state is the
   * one that comes from evidence, so it is the one that stayed.
   */
  @IsIn(PATIENT_STATUSES)
  @IsOptional()
  status?: PatientStatus;
}
