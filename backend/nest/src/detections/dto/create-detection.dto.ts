import { IsString, IsIn, IsOptional } from 'class-validator';
import { EYE_SELECTIONS, type EyeSelection } from '../rop';
export class CreateDetectionDto {
  @IsString()
  patientId: string;

  @IsString()
  date: string;

  @IsIn(EYE_SELECTIONS)
  eye: EyeSelection;

  @IsString()
  notes: string;

  /** The severity analysis the doctor ran before saving, if they ran one. */
  @IsString()
  @IsOptional()
  severityJobId?: string;

  /** ICROP stages the examiner recorded before saving, as JSON: {"Left": 3}.
   * A string because this arrives as multipart form data, which has no nesting. */
  @IsString()
  @IsOptional()
  icropStages?: string;

  /** Zone and plus the examiner recorded before saving, as JSON:
   * {"Left": {"zone": "2", "plus": "pre-plus"}}. Same reason it is a string.
   *
   * What a doctor writes down while the screening is still open has to survive
   * the save. Dropping it would teach them not to fill it in until afterwards,
   * which is the opposite of what the record needs. */
  @IsString()
  @IsOptional()
  examinerFindings?: string;
}
