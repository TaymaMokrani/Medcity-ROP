import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Makes the database enforce what the code already assumed.
 *
 * 1. Foreign keys. Every patient, screening and grant belongs to a user, and
 *    every screening to a patient. Until now nothing stopped a row pointing at
 *    something that no longer exists. All four are RESTRICT: deleting goes
 *    through the services, which remove photographs and grants first, and the
 *    constraint is the net under that — never a silent cascade.
 *
 *    `audit_log.actorId` gets no foreign key on purpose. The log is history and
 *    keeps its lines whatever happens to the rows it mentions.
 *
 * 2. Real types. Owner ids become `uuid` to match `users.id` (a foreign key
 *    needs both sides alike). Days become `date`, moments become `timestamptz`,
 *    so they sort and compare as time rather than as text.
 *
 * 3. `detections.patientName` is dropped. It was a copy of the patient's name
 *    and went stale on every rename; the entity now reads it from `patients`.
 *
 * 4. `modelVersion` and `phase2Version` record which model produced a result.
 *    Existing screenings stay null: unknown, not guessed.
 *
 * Broken links are checked first. If any exist the migration stops and lists
 * them rather than deleting anything — which rows to keep is a person's call.
 */
export class RelationsDatesAndModelVersion1786000700000 implements MigrationInterface {
  name = 'RelationsDatesAndModelVersion1786000700000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await this.refuseBrokenLinks(queryRunner);

    // --- types -------------------------------------------------------------
    await queryRunner.query(`
      ALTER TABLE "patients"
        ALTER COLUMN "ownerId" TYPE uuid USING "ownerId"::uuid,
        ALTER COLUMN "dateOfBirth" TYPE date USING "dateOfBirth"::date,
        ALTER COLUMN "createdAt" TYPE timestamptz USING "createdAt"::timestamptz
    `);
    await queryRunner.query(`
      ALTER TABLE "detections"
        ALTER COLUMN "ownerId" TYPE uuid USING "ownerId"::uuid,
        ALTER COLUMN "date" TYPE date USING "date"::date,
        ALTER COLUMN "decidedAt" TYPE timestamptz USING NULLIF("decidedAt", '')::timestamptz,
        ALTER COLUMN "phase2At" TYPE timestamptz USING NULLIF("phase2At", '')::timestamptz,
        ALTER COLUMN "createdAt" TYPE timestamptz USING "createdAt"::timestamptz
    `);
    await queryRunner.query(`
      ALTER TABLE "access_grants"
        ALTER COLUMN "ownerId" TYPE uuid USING "ownerId"::uuid,
        ALTER COLUMN "createdAt" TYPE timestamptz USING "createdAt"::timestamptz
    `);
    for (const table of ['patients', 'detections', 'access_grants']) {
      await queryRunner.query(
        `ALTER TABLE "${table}" ALTER COLUMN "createdAt" SET DEFAULT now()`,
      );
    }
    await queryRunner.query(`
      ALTER TABLE "audit_log"
        ALTER COLUMN "actorId" TYPE uuid USING "actorId"::uuid,
        ALTER COLUMN "at" TYPE timestamptz USING "at"::timestamptz
    `);

    // --- columns -----------------------------------------------------------
    await queryRunner.query(
      `ALTER TABLE "detections" DROP COLUMN "patientName"`,
    );
    await queryRunner.query(
      `ALTER TABLE "detections" ADD "modelVersion" character varying`,
    );
    await queryRunner.query(
      `ALTER TABLE "detections" ADD "phase2Version" character varying`,
    );

    // Every patient page lists that patient's screenings.
    await queryRunner.query(
      `CREATE INDEX "IDX_detections_patient" ON "detections" ("patientId")`,
    );

    // --- foreign keys ------------------------------------------------------
    await queryRunner.query(`
      ALTER TABLE "patients" ADD CONSTRAINT "FK_patients_owner"
        FOREIGN KEY ("ownerId") REFERENCES "users"("id")
        ON DELETE RESTRICT ON UPDATE NO ACTION
    `);
    await queryRunner.query(`
      ALTER TABLE "detections" ADD CONSTRAINT "FK_detections_owner"
        FOREIGN KEY ("ownerId") REFERENCES "users"("id")
        ON DELETE RESTRICT ON UPDATE NO ACTION
    `);
    await queryRunner.query(`
      ALTER TABLE "detections" ADD CONSTRAINT "FK_detections_patient"
        FOREIGN KEY ("patientId") REFERENCES "patients"("id")
        ON DELETE RESTRICT ON UPDATE NO ACTION
    `);
    await queryRunner.query(`
      ALTER TABLE "access_grants" ADD CONSTRAINT "FK_access_grants_owner"
        FOREIGN KEY ("ownerId") REFERENCES "users"("id")
        ON DELETE RESTRICT ON UPDATE NO ACTION
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    for (const [table, constraint] of [
      ['access_grants', 'FK_access_grants_owner'],
      ['detections', 'FK_detections_patient'],
      ['detections', 'FK_detections_owner'],
      ['patients', 'FK_patients_owner'],
    ]) {
      await queryRunner.query(
        `ALTER TABLE "${table}" DROP CONSTRAINT "${constraint}"`,
      );
    }
    await queryRunner.query(`DROP INDEX "public"."IDX_detections_patient"`);

    await queryRunner.query(
      `ALTER TABLE "detections" DROP COLUMN "phase2Version"`,
    );
    await queryRunner.query(
      `ALTER TABLE "detections" DROP COLUMN "modelVersion"`,
    );

    // The copy comes back, filled from the patient it belongs to.
    await queryRunner.query(
      `ALTER TABLE "detections" ADD "patientName" character varying NOT NULL DEFAULT ''`,
    );
    await queryRunner.query(`
      UPDATE "detections" d
         SET "patientName" = trim(p."firstName" || ' ' || p."lastName")
        FROM "patients" p
       WHERE p."id" = d."patientId"
    `);
    await queryRunner.query(
      `ALTER TABLE "detections" ALTER COLUMN "patientName" DROP DEFAULT`,
    );

    // Back to text, in the formats the old code wrote: a bare day for the
    // two `createdAt` columns and the dates, a full ISO instant for the rest.
    const day = (column: string) => `to_char("${column}", 'YYYY-MM-DD')`;
    const instant = (column: string) =>
      `to_char("${column}" AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`;

    for (const table of ['patients', 'detections', 'access_grants']) {
      await queryRunner.query(
        `ALTER TABLE "${table}" ALTER COLUMN "createdAt" DROP DEFAULT`,
      );
    }
    await queryRunner.query(`
      ALTER TABLE "audit_log"
        ALTER COLUMN "actorId" TYPE character varying USING "actorId"::text,
        ALTER COLUMN "at" TYPE character varying USING ${instant('at')}
    `);
    await queryRunner.query(`
      ALTER TABLE "access_grants"
        ALTER COLUMN "ownerId" TYPE character varying USING "ownerId"::text,
        ALTER COLUMN "createdAt" TYPE character varying USING ${instant('createdAt')}
    `);
    await queryRunner.query(`
      ALTER TABLE "detections"
        ALTER COLUMN "ownerId" TYPE character varying USING "ownerId"::text,
        ALTER COLUMN "date" TYPE character varying USING ${day('date')},
        ALTER COLUMN "decidedAt" TYPE text USING ${instant('decidedAt')},
        ALTER COLUMN "phase2At" TYPE text USING ${instant('phase2At')},
        ALTER COLUMN "createdAt" TYPE character varying
          USING ${day('createdAt')}
    `);
    await queryRunner.query(`
      ALTER TABLE "patients"
        ALTER COLUMN "ownerId" TYPE character varying USING "ownerId"::text,
        ALTER COLUMN "dateOfBirth" TYPE character varying USING ${day('dateOfBirth')},
        ALTER COLUMN "createdAt" TYPE character varying
          USING ${day('createdAt')}
    `);
  }

  /**
   * Stops the migration if any row points at something that is not there, or
   * holds an owner id that is not a uuid. Lists up to ten of each.
   */
  private async refuseBrokenLinks(queryRunner: QueryRunner): Promise<void> {
    const uuid = `'^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'`;
    const checks: [string, string][] = [
      [
        'patients whose owner is not a user',
        `SELECT "id" FROM "patients" WHERE "ownerId" NOT IN (SELECT "id"::text FROM "users")`,
      ],
      [
        'screenings whose owner is not a user',
        `SELECT "id" FROM "detections" WHERE "ownerId" NOT IN (SELECT "id"::text FROM "users")`,
      ],
      [
        'screenings whose patient does not exist',
        `SELECT "id" FROM "detections" WHERE "patientId" NOT IN (SELECT "id" FROM "patients")`,
      ],
      [
        'access grants whose owner is not a user',
        `SELECT "kind" || ':' || "key" AS "id" FROM "access_grants" WHERE "ownerId" NOT IN (SELECT "id"::text FROM "users")`,
      ],
      [
        'activity lines whose actor id is not a uuid',
        `SELECT "id" FROM "audit_log" WHERE "actorId" !~ ${uuid}`,
      ],
    ];

    const problems: string[] = [];
    for (const [label, sql] of checks) {
      const rows = (await queryRunner.query(sql)) as { id: string }[];
      if (rows.length) {
        const sample = rows
          .slice(0, 10)
          .map((row) => row.id)
          .join(', ');
        problems.push(`  ${rows.length} ${label}: ${sample}`);
      }
    }

    if (problems.length) {
      throw new Error(
        'Cannot add the foreign keys: some rows point at nothing.\n' +
          problems.join('\n') +
          '\nNothing was changed. Fix or delete these rows, then start again.',
      );
    }
  }
}
