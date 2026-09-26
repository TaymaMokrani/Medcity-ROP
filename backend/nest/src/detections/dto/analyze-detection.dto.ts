import { IsIn, IsString } from 'class-validator';
import { EYE_SELECTIONS, type EyeSelection } from '../rop';

export class AnalyzeDetectionDto {
  @IsIn(EYE_SELECTIONS)
  eye: EyeSelection;

  @IsString()
  patientId: string;

  @IsString()
  date: string;
}
