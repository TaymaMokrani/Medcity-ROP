import { Module } from '@nestjs/common';
import { SeverityModule } from '../severity/severity.module';
import { WorkspaceController } from './workspace.controller';

@Module({
  imports: [SeverityModule],
  controllers: [WorkspaceController],
})
export class WorkspaceModule {}
