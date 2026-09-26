/**
 * One-time move from the embedded PGlite database to a PostgreSQL server.
 *
 *   npm run db:copy-from-pglite            reads ./data
 *   npm run db:copy-from-pglite -- <dir>   reads another PGlite folder
 *
 * The target is DATABASE_URL from .env and must be a postgres:// URL.
 *
 * What it does, in order:
 *   1. Refuses if the target already holds users — it never merges or overwrites.
 *   2. Runs every migration on the target, so it has today's schema.
 *   3. Copies each table in one transaction, parents before children so the
 *      foreign keys are satisfied. All or nothing.
 *   4. Compares the row counts of source and target.
 *
 * The PGlite folder is only read. If anything goes wrong it is exactly as it
 * was, and the gateway can be pointed back at it.
 *
 * The source may still have the old schema (text dates, `patientName`). Only
 * the columns both sides share are copied, and every value travels as text and
 * is cast by Postgres into the target's type — a day becomes a `date`, an ISO
 * string a `timestamptz`, a JSON string `jsonb`.
 */
import { config as loadEnv } from 'dotenv';
import { resolve } from 'path';
import { existsSync } from 'fs';
import { DataSource } from 'typeorm';
import { buildDataSourceOptions } from './data-source-options';

loadEnv();

/** Parents first: a row is copied only after everything it points at. */
const TABLES = [
  'users',
  'patients',
  'detections',
  'access_grants',
  'audit_log',
] as const;

interface ColumnInfo {
  column_name: string;
  udt_name: string;
}

async function main() {
  const sourceDir = resolve(process.argv[2] ?? './data');
  const targetUrl = process.env.DATABASE_URL ?? '';

  if (!existsSync(sourceDir)) {
    throw new Error(`No PGlite folder at ${sourceDir}`);
  }
  if (!targetUrl.startsWith('postgres://')) {
    throw new Error(
      'DATABASE_URL must point at the Postgres server (postgres://...). ' +
        'Set it in .env first.',
    );
  }

  const { PGlite } = await import('@electric-sql/pglite');
  const source = new PGlite(sourceDir);
  const target = new DataSource(await buildDataSourceOptions(targetUrl));

  try {
    await target.initialize();
    console.log(`source  ${sourceDir}`);
    console.log(`target  ${targetUrl.replace(/:[^:@/]*@/, ':***@')}\n`);

    // 1. never on top of existing data
    const hasUsers = await target.query<{ exists: boolean }[]>(
      `SELECT to_regclass('public.users') IS NOT NULL AS "exists"`,
    );
    if (hasUsers[0].exists) {
      const [{ n }] = await target.query<{ n: number }[]>(
        `SELECT count(*)::int AS n FROM "users"`,
      );
      if (n > 0) {
        throw new Error(
          `The target already has ${n} users. This script only fills an empty ` +
            'database. Nothing was copied.',
        );
      }
    }

    // 2. today's schema
    const ran = await target.runMigrations({ transaction: 'all' });
    console.log(`migrations run on the target: ${ran.length}`);

    // 3. the rows, all in one transaction
    const copied: Record<string, number> = {};
    await target.transaction(async (manager) => {
      for (const table of TABLES) {
        const sourceColumns = await columnsOf(
          (sql, params) => source.query(sql, params).then((r) => r.rows),
          table,
        );
        const targetColumns = await columnsOf(
          (sql, params) => manager.query(sql, params),
          table,
        );
        const targetType = new Map(
          targetColumns.map((c) => [c.column_name, c.udt_name]),
        );
        const shared = sourceColumns
          .map((c) => c.column_name)
          .filter((name) => targetType.has(name));

        const select = shared.map((c) => `"${c}"::text AS "${c}"`).join(', ');
        const rows = (
          await source.query<Record<string, string | null>>(
            `SELECT ${select} FROM "${table}"`,
          )
        ).rows;

        const columns = shared.map((c) => `"${c}"`).join(', ');
        const values = shared
          .map((c, i) => `$${i + 1}::${targetType.get(c)}`)
          .join(', ');
        const insert = `INSERT INTO "${table}" (${columns}) VALUES (${values})`;

        for (const row of rows) {
          await manager.query(
            insert,
            shared.map((c) => row[c]),
          );
        }
        copied[table] = rows.length;

        const skipped = sourceColumns
          .map((c) => c.column_name)
          .filter((name) => !targetType.has(name));
        console.log(
          `copied  ${table.padEnd(14)} ${String(rows.length).padStart(5)} rows` +
            (skipped.length
              ? `   (not in the new schema: ${skipped.join(', ')})`
              : ''),
        );
      }
    });

    // 4. counts must match
    console.log('');
    let mismatch = false;
    for (const table of TABLES) {
      const [{ n: sourceCount }] = (
        await source.query<{ n: number }>(
          `SELECT count(*)::int AS n FROM "${table}"`,
        )
      ).rows;
      const [{ n: targetCount }] = await target.query<{ n: number }[]>(
        `SELECT count(*)::int AS n FROM "${table}"`,
      );
      const ok = sourceCount === targetCount;
      mismatch ||= !ok;
      console.log(
        `check   ${table.padEnd(14)} source ${sourceCount}  target ${targetCount}  ${ok ? 'OK' : 'MISMATCH'}`,
      );
    }
    if (mismatch) throw new Error('Row counts differ. See the lines above.');

    console.log('\nDone. The PGlite folder was not modified.');
  } finally {
    if (target.isInitialized) await target.destroy();
    await source.close();
  }
}

async function columnsOf(
  query: (sql: string, params: unknown[]) => Promise<unknown[]>,
  table: string,
): Promise<ColumnInfo[]> {
  return (await query(
    `SELECT column_name, udt_name FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = $1
      ORDER BY ordinal_position`,
    [table],
  )) as ColumnInfo[];
}

main().catch((error) => {
  console.error(
    `\nCopy failed: ${error instanceof Error ? error.message : String(error)}`,
  );
  process.exit(1);
});
