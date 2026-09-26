import { join } from 'path';
import type { DataSourceOptions } from 'typeorm';
import { User } from '../users/user.entity';
import { Patient } from '../patients/patient.entity';
import { Detection } from '../detections/detection.entity';
import { AccessGrant } from '../access/access-grant.entity';
import { AuditEntry } from '../audit/audit.entity';

export async function buildDataSourceOptions(
  databaseUrl: string | undefined,
): Promise<DataSourceOptions> {
  const url = databaseUrl ?? '';

  const common = {
    type: 'postgres' as const,
    entities: [User, Patient, Detection, AccessGrant, AuditEntry],
    migrations: [join(__dirname, 'migrations', '*.{ts,js}')],
    synchronize: false,
  };

  if (url === 'pglite' || !url || url.startsWith('pglite://')) {
    const { PGliteDriver } = await import('typeorm-pglite');

    const dataDir = url.startsWith('pglite://')
      ? url.replace('pglite://', '')
      : undefined;

    return {
      ...common,
      driver: new PGliteDriver({ dataDir }).driver,
    };
  }

  return { ...common, url };
}
