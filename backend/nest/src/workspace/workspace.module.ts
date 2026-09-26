import { Module } from '@nestjs/common';
import { DetectionsModule } from '../detections/detections.module';
import { WorkspaceController } from './workspace.controller';

@Module({
  imports: [DetectionsModule],
  controllers: [WorkspaceController],
})
export class WorkspaceModule {}
