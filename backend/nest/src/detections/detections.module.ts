import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Detection } from './detection.entity';
import { Patient } from '../patients/patient.entity';
import { DetectionsService } from './detections.service';
import { DetectionsController } from './detections.controller';
import { MlModule } from '../ml/ml.module';
import { SeverityModule } from '../severity/severity.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Detection, Patient]),
    MlModule,
    SeverityModule,
  ],
  providers: [DetectionsService],
  controllers: [DetectionsController],
  exports: [DetectionsService],
})
export class DetectionsModule {}
