/**
 * One-time move of photographs and evidence from the gateway's disk into
 * object storage.
 *
 *   npm run storage:copy-from-disk
 *
 * Reads ./uploads/detections and ./uploads/severity, and the database named by
 * DATABASE_URL. Writes to the bucket named by STORAGE_*.
 *
 * In order:
 *   1. Runs the migrations, so every reference in the database is a storage
 *      key (`detections/…`) rather than a path (`/uploads/detections/…`).
 *   2. Works out which files the records use: named by a screening, or
 *      covered by an access grant. Leftovers (an abandoned preview's renders,
 *      a failed upload) stay on disk and are not carried over.
 *   3. Uploads those, keeping each name: `uploads/detections/x.jpg` becomes
 *      the object `detections/x.jpg`, and checks each one's size in the bucket.
 *   4. Checks every file the database refers to exists in the bucket, and
 *      lists any that do not (files already missing from disk before the move).
 *   5. Moves each screening's evidence packets from the `phase2Evidence`
 *      column into one JSON object, reads it back and compares it byte for
 *      byte, and only then empties the column.
 *
 * Nothing on disk is deleted. Safe to run again: uploads overwrite with the
 * same bytes, and screenings already moved are skipped.
 */
import { config as loadEnv } from 'dotenv';
import { createHash } from 'crypto';
import { existsSync, readdirSync, readFileSync, statSync } from 'fs';
import { join } from 'path';
import { ConfigService } from '@nestjs/config';
import { DataSource, IsNull, Not } from 'typeorm';
import { buildDataSourceOptions } from '../database/data-source-options';
import { Detection } from '../detections/detection.entity';
import { AccessGrant } from '../access/access-grant.entity';
import { storedImageUrls } from '../detections/detection-storage';
import { StorageService } from './storage.service';
import { contentTypeOf, evidenceKey, isSafeName } from './keys';

loadEnv();

const FOLDERS = ['detections', 'severity'] as const;

async function main() {
  const uploads = join(process.cwd(), 'uploads');
  const storage = new StorageService(
    new ConfigService(process.env as Record<string, string>),
  );
  const db = new DataSource(
    await buildDataSourceOptions(process.env.DATABASE_URL),
  );

  try {
    // 1. references become keys
    await db.initialize();
    const ran = await db.runMigrations({ transaction: 'all' });
    console.log(`migrations run: ${ran.length}`);
    await storage.ensureBucket();
    console.log(`bucket: ${storage.bucket}\n`);

    // 2. what the records use: every file a screening names, and every file
    // someone holds a grant for. Nothing else is worth carrying over — a file
    // with no grant cannot be opened by anyone.
    const detections = await db.getRepository(Detection).find();
    const referenced = new Set(detections.flatMap(storedImageUrls));
    const grants = await db.getRepository(AccessGrant).findBy({ kind: 'file' });
    grants.forEach((grant) => referenced.add(grant.key));

    // 3. those files up, then checked against the bucket
    let problems = 0;
    for (const folder of FOLDERS) {
      const dir = join(uploads, folder);
      const names = existsSync(dir)
        ? readdirSync(dir).filter((name) => statSync(join(dir, name)).isFile())
        : [];

      const used = names.filter(
        (name) => isSafeName(name) && referenced.has(`${folder}/${name}`),
      );
      for (const name of used) {
        await storage.put(
          `${folder}/${name}`,
          readFileSync(join(dir, name)),
          contentTypeOf(name),
        );
      }

      const inBucket = await storage.list(`${folder}/`);
      const wrong = used.filter(
        (name) =>
          inBucket.get(`${folder}/${name}`)?.size !==
          statSync(join(dir, name)).size,
      );
      problems += wrong.length;
      for (const name of wrong) {
        console.log(`  NOT VERIFIED: ${folder}/${name}`);
      }

      console.log(
        `uploaded ${folder.padEnd(11)} ${String(used.length).padStart(4)} files` +
          `   verified ${used.length - wrong.length}/${used.length}` +
          `   (${names.length - used.length} unused files left on disk)`,
      );
    }

    // 4. every reference points at something
    const [photos, renders] = await Promise.all(
      FOLDERS.map((folder) => storage.list(`${folder}/`)),
    );
    const present = new Set([...photos.keys(), ...renders.keys()]);

    const missing = [...referenced].filter((key) => !present.has(key));
    console.log(
      `\nfiles the database refers to: ${referenced.size}, ` +
        `found in storage: ${referenced.size - missing.length}`,
    );
    if (missing.length) {
      console.log(
        `  ${missing.length} referenced but not in storage. These files were ` +
          'not on disk either, so there was nothing to copy:',
      );
      missing.slice(0, 20).forEach((key) => console.log(`    ${key}`));
      if (missing.length > 20) {
        console.log(`    ... and ${missing.length - 20} more`);
      }
    }

    // 5. evidence packets, one screening at a time
    const repo = db.getRepository(Detection);
    const pending = await repo.find({
      where: { phase2Evidence: Not(IsNull()), phase2EvidenceKey: IsNull() },
      select: { id: true, phase2Evidence: true },
    });

    let moved = 0;
    for (const row of pending) {
      const body = JSON.stringify(row.phase2Evidence);
      const key = evidenceKey(row.id);
      await storage.put(key, body, 'application/json');

      const back = await storage.read(key);
      if (sha256(back) !== sha256(Buffer.from(body, 'utf8'))) {
        console.log(`  NOT VERIFIED, left in the database: ${key}`);
        problems += 1;
        continue;
      }

      await repo.update(row.id, {
        phase2EvidenceKey: key,
        phase2Evidence: null,
      });
      moved += 1;
    }
    console.log(
      `\nevidence packets moved to storage: ${moved}/${pending.length}` +
        (pending.length === 0 ? ' (nothing left to move)' : ''),
    );

    if (problems) {
      throw new Error(`${problems} item(s) could not be verified. See above.`);
    }
    console.log(
      '\nDone. Nothing on disk was deleted. Once the app shows every photograph,\n' +
        'the uploads folder is no longer used and can be removed.',
    );
  } finally {
    if (db.isInitialized) await db.destroy();
  }
}

function sha256(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex');
}

main().catch((error) => {
  console.error(
    `\nCopy failed: ${error instanceof Error ? error.message : String(error)}`,
  );
  process.exit(1);
});
