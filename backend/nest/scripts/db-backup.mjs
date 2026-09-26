/**
 * A full backup of the Postgres database, in one file.
 *
 *   npm run db:backup
 *
 * Writes backups/medcity-YYYY-MM-DD-HHMM.dump using pg_dump inside the
 * medcity-postgres container, so nothing needs installing on this machine.
 * The folder is ignored by git: a backup is patient data.
 *
 * To restore one into the running database (replaces what is there):
 *
 *   docker exec -i medcity-postgres pg_restore -U medcity -d medcity --clean --if-exists < backups/<file>.dump
 *
 * Photographs are files, not rows: copy uploads/ alongside the dump.
 */
import 'dotenv/config';
import { spawn } from 'node:child_process';
import { createWriteStream, mkdirSync, statSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';

const CONTAINER = process.env.POSTGRES_CONTAINER ?? 'medcity-postgres';

const url = new URL(process.env.DATABASE_URL ?? '');
if (url.protocol !== 'postgres:') {
  console.error('DATABASE_URL is not a postgres:// URL; nothing to back up.');
  process.exit(1);
}
const user = decodeURIComponent(url.username);
const database = url.pathname.replace(/^\//, '');

const stamp = new Date().toISOString().slice(0, 16).replace('T', '-').replace(':', '');
const folder = join(process.cwd(), 'backups');
const file = join(folder, `medcity-${stamp}.dump`);
mkdirSync(folder, { recursive: true });

// -Fc: Postgres's compressed custom format, the one pg_restore reads.
const dump = spawn('docker', ['exec', CONTAINER, 'pg_dump', '-U', user, '-d', database, '-Fc'], {
  stdio: ['ignore', 'pipe', 'inherit'],
});
const out = createWriteStream(file);
dump.stdout.pipe(out);

dump.on('error', (error) => {
  console.error(`Could not run docker: ${error.message}`);
  process.exit(1);
});

dump.on('close', (code) => {
  out.close(() => {
    if (code !== 0) {
      unlinkSync(file);
      console.error(`pg_dump failed (exit ${code}). Is the container running? docker compose ps`);
      process.exit(1);
    }
    const kb = Math.round(statSync(file).size / 1024);
    console.log(`Backup written: backups/medcity-${stamp}.dump (${kb} kB)`);
  });
});
