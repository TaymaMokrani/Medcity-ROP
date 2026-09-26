import { Module } from '@nestjs/common';
import { MlService } from './ml.service';
import { MlProcessService } from './ml-process.service';

@Module({
  providers: [MlService, MlProcessService],
  exports: [MlService],
})
export class MlModule {}
