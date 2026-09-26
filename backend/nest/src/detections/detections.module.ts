import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BullModule } from '@nestjs/bullmq';
import { Detection } from './detection.entity';
import { Patient } from '../patients/patient.entity';
import { DetectionsService } from './detections.service';
import { DetectionsController } from './detections.controller';
import { SeverityQueueService } from './severity-queue.service';
import { SeverityProcessor } from './severity.processor';
import { MlModule } from '../ml/ml.module';
import { SeverityModule } from '../severity/severity.module';
import { SEVERITY_QUEUE } from '../queue/queue.constants';

@Module({
  imports: [
    TypeOrmModule.forFeature([Detection, Patient]),
    BullModule.registerQueue({ name: SEVERITY_QUEUE }),
    MlModule,
    SeverityModule,
  ],
  providers: [DetectionsService, SeverityQueueService, SeverityProcessor],
  controllers: [DetectionsController],
  exports: [DetectionsService, SeverityQueueService],
})
export class DetectionsModule {}
