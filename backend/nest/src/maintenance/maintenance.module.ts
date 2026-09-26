import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BullModule } from '@nestjs/bullmq';
import { Detection } from '../detections/detection.entity';
import { AccessGrant } from '../access/access-grant.entity';
import { MAINTENANCE_QUEUE } from '../queue/queue.constants';
import { CleanupService } from './cleanup.service';
import { MaintenanceProcessor } from './maintenance.processor';

@Module({
  imports: [
    TypeOrmModule.forFeature([Detection, AccessGrant]),
    BullModule.registerQueue({ name: MAINTENANCE_QUEUE }),
  ],
  providers: [CleanupService, MaintenanceProcessor],
})
export class MaintenanceModule {}
