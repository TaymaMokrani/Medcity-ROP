import { Global, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AccessGrant } from './access-grant.entity';
import { AccessService } from './access.service';

/**
 * Global on purpose.
 *
 * Every module that writes a file or starts a job has to grant it, so making
 * each one import this module would only be ceremony — and a module that
 * forgot the import would still compile and quietly write ungranted files.
 */
@Global()
@Module({
  imports: [TypeOrmModule.forFeature([AccessGrant])],
  providers: [AccessService],
  exports: [AccessService],
})
export class AccessModule {}
