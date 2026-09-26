/**
 * Move the demonstration babies to the account that is actually signed in.
 *
 * Patients belong to one doctor: every list is filtered by `ownerId`. The babies
 * added by `add-demo-patients.mjs` went to whichever account already had the
 * most records, which is not necessarily the one at the keyboard — so they are
 * invisible to everyone else.
 *
 *   node scripts/move-demo-patients.mjs                       # who exists, and who owns what
 *   node scripts/move-demo-patients.mjs --to a@b.c --write    # move them to that account
 *
 * The API must not be running: PGlite opens its data directory exclusively.
 */
import { PGlite } from "@electric-sql/pglite";

const args = process.argv.slice(2);
const write = args.includes("--write");
const toIndex = args.indexOf("--to");
const to = toIndex >= 0 ? args[toIndex + 1] : null;
const DIR = process.env.PGLITE_DIR ?? "./data";
const MARK = "Added as demonstration data.";

const db = new PGlite(DIR);

const accounts = await db.query(
  `SELECT u.id, u.email, u.name,
          (SELECT COUNT(*)::int FROM patients p WHERE p."ownerId" = u.id::text) AS patients,
          (SELECT COUNT(*)::int FROM detections d WHERE d."ownerId" = u.id::text) AS screenings
     FROM users u
    ORDER BY patients DESC`,
);

console.log("accounts:");
for (const a of accounts.rows) {
  console.log(`  ${a.email}  ${a.name}  ·  ${a.patients} patients, ${a.screenings} screenings`);
}

const demo = await db.query(
  `SELECT id, "firstName", "lastName", "ownerId" FROM patients WHERE notes = $1`,
  [MARK],
);
console.log(`\n${demo.rows.length} demonstration babies, owned by:`);
for (const owner of new Set(demo.rows.map((r) => r.ownerId))) {
  const account = accounts.rows.find((a) => a.id === owner);
  console.log(`  ${account ? account.email : owner}`);
}

if (!to) {
  console.log("\nPass --to <email> --write to move them.");
  await db.close();
  process.exit(0);
}

const target = accounts.rows.find((a) => a.email.toLowerCase() === to.toLowerCase());
if (!target) {
  console.error(`\nNo account with the email ${to}.`);
  process.exit(1);
}

console.log(`\n${write ? "moving" : "would move"} ${demo.rows.length} babies to ${target.email}`);
if (write) {
  await db.query(`UPDATE patients SET "ownerId" = $1 WHERE notes = $2`, [String(target.id), MARK]);
  const now = await db.query(`SELECT COUNT(*)::int AS n FROM patients WHERE "ownerId" = $1`, [target.id]);
  console.log(`done · ${now.rows[0].n} patients on that list`);
} else {
  console.log("dry run, nothing written");
}
await db.close();
