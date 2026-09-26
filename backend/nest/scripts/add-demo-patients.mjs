/**
 * Add a handful of babies to a doctor's list, so the dashboard has a ward to draw.
 *
 * Patients only: no screenings. A screening carries a risk the model produced,
 * and writing invented ones into the record would put numbers in the charts
 * that no model ever said.
 *
 *   node scripts/add-demo-patients.mjs            # dry run
 *   node scripts/add-demo-patients.mjs --write
 *
 * The API must not be running: PGlite opens its data directory exclusively.
 */
import { PGlite } from "@electric-sql/pglite";

const write = process.argv.includes("--write");
const DIR = process.env.PGLITE_DIR ?? "./data";

const BABIES = [
  { firstName: "Amira", lastName: "Ben Salah", gender: "Female", gestationalAge: 26, birthWeight: 820, motherName: "Ines Ben Salah", days: 34 },
  { firstName: "Youssef", lastName: "Trabelsi", gender: "Male", gestationalAge: 29, birthWeight: 1180, motherName: "Sonia Trabelsi", days: 27 },
  { firstName: "Nour", lastName: "Gharbi", gender: "Female", gestationalAge: 31, birthWeight: 1490, motherName: "Rim Gharbi", days: 19 },
  { firstName: "Mehdi", lastName: "Bouazizi", gender: "Male", gestationalAge: 27, birthWeight: 940, motherName: "Hajer Bouazizi", days: 12 },
  { firstName: "Sirine", lastName: "Chaabane", gender: "Female", gestationalAge: 33, birthWeight: 1830, motherName: "Olfa Chaabane", days: 6 },
];

/** The same shape of id the gateway makes. */
function newId() {
  const stamp = Date.now().toString(36).toUpperCase();
  const tail = Math.random().toString(36).slice(2, 12).toUpperCase();
  return `PAT-${stamp}${tail}`.slice(0, 26);
}

function isoDaysAgo(days) {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return date.toISOString().split("T")[0];
}

const db = new PGlite(DIR);

// whoever owns the records already: these babies join that doctor's list
const owners = await db.query(
  `SELECT "ownerId", COUNT(*)::int AS n FROM patients GROUP BY "ownerId" ORDER BY n DESC LIMIT 1`,
);
const ownerId = owners.rows[0]?.ownerId;
if (!ownerId) {
  console.error("No patients on record, so there is no doctor to add these to.");
  process.exit(1);
}

for (const baby of BABIES) {
  const row = {
    id: newId(),
    ownerId,
    firstName: baby.firstName,
    lastName: baby.lastName,
    dateOfBirth: isoDaysAgo(baby.days),
    gender: baby.gender,
    gestationalAge: baby.gestationalAge,
    birthWeight: baby.birthWeight,
    motherName: baby.motherName,
    phone: null,
    email: null,
    address: null,
    bloodType: null,
    notes: "Added as demonstration data.",
    status: "Active",
    createdAt: new Date().toISOString(),
  };

  console.log(
    `${row.firstName} ${row.lastName} · ${row.gender} · ${row.gestationalAge}w · ${row.birthWeight} g · born ${row.dateOfBirth}`,
  );

  if (write) {
    await db.query(
      `INSERT INTO patients (id, "ownerId", "firstName", "lastName", "dateOfBirth", gender,
        "gestationalAge", "birthWeight", "motherName", phone, email, address, "bloodType",
        notes, status, "createdAt")
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`,
      [
        row.id, row.ownerId, row.firstName, row.lastName, row.dateOfBirth, row.gender,
        row.gestationalAge, row.birthWeight, row.motherName, row.phone, row.email,
        row.address, row.bloodType, row.notes, row.status, row.createdAt,
      ],
    );
  }
}

const total = await db.query(`SELECT COUNT(*)::int AS n FROM patients WHERE "ownerId" = $1`, [ownerId]);
console.log(
  `\n${BABIES.length} babies ${write ? "added" : "would be added"} · ${total.rows[0].n} patients on this doctor's list` +
    (write ? "" : " · dry run, nothing written"),
);
await db.close();
