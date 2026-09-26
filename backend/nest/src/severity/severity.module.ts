import { Module } from '@nestjs/common';
import { SeverityService } from './severity.service';
import { SeverityProcessService } from './severity-process.service';

@Module({
  providers: [SeverityService, SeverityProcessService],
  exports: [SeverityService],
})
export class SeverityModule {}
