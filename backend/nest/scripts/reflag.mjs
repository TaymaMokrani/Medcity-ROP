/**
 * Re-flag the saved screenings at a new operating line.
 *
 * `flagged` is written by the model at the moment a screening is scored, so
 * moving the service's line leaves every older screening carrying the old
 * answer. This walks the table once and re-reads each stored risk against the
 * new line — per eye and for the screening as a whole — and records the line it
 * was read against, exactly as the service does.
 *
 *   node scripts/reflag.mjs            # dry run, prints what would change
 *   node scripts/reflag.mjs --write    # writes it
 *   node scripts/reflag.mjs --line 0.4 --write
 *
 * The API must not be running: PGlite opens its data directory exclusively.
 */
import { PGlite } from "@electric-sql/pglite";

const args = process.argv.slice(2);
const write = args.includes("--write");
const lineArg = args.indexOf("--line");
const LINE = lineArg >= 0 ? Number(args[lineArg + 1]) : 0.4;
const DIR = process.env.PGLITE_DIR ?? "./data";

if (!Number.isFinite(LINE) || LINE <= 0 || LINE >= 1) {
  console.error("--line must be between 0 and 1");
  process.exit(1);
}

const db = new PGlite(DIR);
const { rows } = await db.query(
  `SELECT id, "patientName", date, risk, flagged, "eyeResults" FROM detections ORDER BY date`,
);

let changed = 0;
for (const row of rows) {
  const eyes = (row.eyeResults ?? []).map((eye) => ({
    ...eye,
    flagged: eye.risk >= LINE,
    threshold: LINE,
  }));
  const flagged = eyes.length > 0 ? eyes.some((e) => e.flagged) : row.risk >= LINE;

  const wasEyes = JSON.stringify(row.eyeResults ?? []);
  if (flagged === row.flagged && JSON.stringify(eyes) === wasEyes) continue;

  changed++;
  const risk = `${Math.round(row.risk * 100)}%`.padStart(4);
  console.log(
    `${row.flagged ? "flagged    " : "not flagged"} -> ${flagged ? "flagged    " : "not flagged"}  ${risk}  ${row.date}  ${row.patientName}`,
  );

  if (write) {
    await db.query(`UPDATE detections SET flagged = $1, "eyeResults" = $2 WHERE id = $3`, [
      flagged,
      JSON.stringify(eyes),
      row.id,
    ]);
  }
}

const stillFlagged = rows.filter((r) =>
  (r.eyeResults ?? []).length > 0
    ? r.eyeResults.some((e) => e.risk >= LINE)
    : r.risk >= LINE,
).length;

console.log(
  `\n${rows.length} screenings · ${changed} would change · ${stillFlagged} flagged at ${LINE}` +
    (write ? " · written" : " · dry run, nothing written"),
);
await db.close();
