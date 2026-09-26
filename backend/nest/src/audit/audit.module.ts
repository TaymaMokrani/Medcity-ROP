import { Global, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuditEntry } from './audit.entity';
import { AuditService } from './audit.service';
import { AuditController } from './audit.controller';

/**
 * Global, for the same reason as the access module: every service that
 * changes a record writes to it, and an import list is not what should decide
 * whether an action is accounted for.
 */
@Global()
@Module({
  imports: [TypeOrmModule.forFeature([AuditEntry])],
  providers: [AuditService],
  controllers: [AuditController],
  exports: [AuditService],
})
export class AuditModule {}
