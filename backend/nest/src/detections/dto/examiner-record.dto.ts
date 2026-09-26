import { IsIn, IsOptional, ValidateIf } from 'class-validator';
import {
  EYES,
  ICROP_STAGES,
  PLUS_GRADES,
  ZONES,
  type Eye,
  type IcropStage,
  type PlusGrade,
  type Zone,
} from '../rop';

/**
 * What the examining clinician found in one eye.
 *
 * All three axes are optional and each is sent only when it changes. `null`
 * clears an axis, which is not the same as a value: for stage, null means
 * nobody has recorded one, while 0 means the doctor looked and found no ROP
 * staging. The same distinction holds for zone and plus.
 */
export class ExaminerRecordDto {
  @IsIn(EYES)
  eye: Eye;

  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsIn(ICROP_STAGES)
  stage?: IcropStage | null;

  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsIn(ZONES)
  zone?: Zone | null;

  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsIn(PLUS_GRADES)
  plus?: PlusGrade | null;
}
