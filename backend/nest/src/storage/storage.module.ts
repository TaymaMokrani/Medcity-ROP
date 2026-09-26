import { Global, Module } from '@nestjs/common';
import { StorageService } from './storage.service';

/** Global: photographs are written by screenings, read by the file route and
 * the Workspace, and deleted with patients. One client serves them all. */
@Global()
@Module({
  providers: [StorageService],
  exports: [StorageService],
})
export class StorageModule {}
