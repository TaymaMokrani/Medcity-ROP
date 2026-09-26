import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Two tables that make the gateway answerable: who may read a file, and who
 * did what.
 *
 * `access_grants` gives an owner to the two things that never had one — the
 * files on disk and the analysis jobs the Python service holds in memory.
 * Until now both were reachable by any authenticated doctor, and the files by
 * anyone at all, because they were served as static assets. The primary key
 * is (kind, key) so one row answers the file route's whole question.
 *
 * `audit_log` is append only. There is no update path in the code and none is
 * intended; the table is written by one service that exposes `record` and
 * `list` and nothing else.
 *
 * Existing photographs get grants in the same transaction, from the
 * screenings that reference them — otherwise every screening recorded before
 * today would lose its images the moment the static route came down. The
 * evidence renders are picked out of `phase2Summary` the same way.
 */
export class AddAccessGrantsAndAuditLog1786000600000 implements MigrationInterface {
  name = 'AddAccessGrantsAndAuditLog1786000600000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "access_grants" (
        "kind" character varying NOT NULL,
        "key" text NOT NULL,
        "ownerId" character varying NOT NULL,
        "createdAt" character varying NOT NULL,
        CONSTRAINT "PK_access_grants" PRIMARY KEY ("kind", "key")
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_access_grants_owner" ON "access_grants" ("ownerId")`,
    );

    await queryRunner.query(`
      CREATE TABLE "audit_log" (
        "id" character varying NOT NULL,
        "actorId" character varying NOT NULL,
        "action" character varying NOT NULL,
        "subjectType" character varying NOT NULL,
        "subjectId" text,
        "subjectLabel" text,
        "detail" text,
        "at" character varying NOT NULL,
        CONSTRAINT "PK_audit_log" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_audit_log_actor" ON "audit_log" ("actorId")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_audit_log_at" ON "audit_log" ("at")`,
    );

    // Photographs already on disk, from the screenings that point at them.
    //
    // Every unnested element is given an explicit column alias, and every
    // reference is qualified. `AS photo` alone would name the table, not the
    // column — and `detections` already has an `image` column and an `eye`
    // column, so an unqualified `image` silently resolves to the text column
    // on the row rather than to the JSON element.
    await queryRunner.query(`
      INSERT INTO "access_grants" ("kind", "key", "ownerId", "createdAt")
      SELECT DISTINCT 'file', photo.item->>'url', d."ownerId", d."createdAt"
        FROM "detections" d,
             jsonb_array_elements(d."images") AS photo(item)
       WHERE jsonb_typeof(d."images") = 'array'
         AND photo.item->>'url' IS NOT NULL
      ON CONFLICT DO NOTHING
    `);

    // Rendered evidence: one map and one front per eye, plus a render per photograph.
    await queryRunner.query(`
      INSERT INTO "access_grants" ("kind", "key", "ownerId", "createdAt")
      SELECT DISTINCT 'file', urls.url, d."ownerId", d."createdAt"
        FROM "detections" d,
             jsonb_array_elements(d."phase2Summary"->'eyes') AS side(item),
             LATERAL (
               SELECT side.item->'evidence'->>'map' AS url
               UNION ALL
               SELECT side.item->'evidence'->>'front'
               UNION ALL
               SELECT render.item->>'image'
                 FROM jsonb_array_elements(
                        COALESCE(side.item->'evidence'->'photos', '[]'::jsonb)
                      ) AS render(item)
             ) AS urls
       WHERE d."phase2Summary" IS NOT NULL
         AND jsonb_typeof(d."phase2Summary"->'eyes') = 'array'
         AND urls.url IS NOT NULL
      ON CONFLICT DO NOTHING
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "audit_log"`);
    await queryRunner.query(`DROP TABLE "access_grants"`);
  }
}
