import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Photographs and evidence move from the gateway's disk to object storage.
 *
 * Every reference to a file changes form, from a path under the gateway's own
 * uploads folder to a storage key:
 *
 *   /uploads/detections/1234-5678.jpg   ->   detections/1234-5678.jpg
 *   /uploads/severity/<job>-L_map.jpg   ->   severity/<job>-L_map.jpg
 *
 * A key names an object in a bucket, and means the same thing on a laptop, a
 * server or Amazon S3. It is rewritten wherever a file is named: the cover
 * image, the photographs, each eye's result, the evidence renders inside the
 * assessment, and the access grants, whose key is the same string.
 *
 * The files themselves are copied by `npm run storage:copy-from-disk`, which
 * also moves each screening's evidence packets out of `phase2Evidence` into
 * one JSON object and records it in the new `phase2EvidenceKey`.
 *
 * The prefix is matched with its opening quote inside the JSON, so only a
 * string that starts with it is rewritten — never text that merely contains it.
 */
export class MoveFilesToObjectStorage1786000800000 implements MigrationInterface {
  name = 'MoveFilesToObjectStorage1786000800000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await this.rewrite(queryRunner, '/uploads/', '');

    await queryRunner.query(
      `ALTER TABLE "detections" ADD "phase2EvidenceKey" character varying`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Packets that already live in storage would be orphaned by dropping the
    // column that points at them. Refuse rather than lose them.
    const [{ n }] = (await queryRunner.query(
      `SELECT count(*)::int AS n FROM "detections" WHERE "phase2EvidenceKey" IS NOT NULL`,
    )) as { n: number }[];
    if (n > 0) {
      throw new Error(
        `${n} screenings keep their evidence packets in object storage. ` +
          'Reverting would lose track of them. Nothing was changed.',
      );
    }

    await queryRunner.query(
      `ALTER TABLE "detections" DROP COLUMN "phase2EvidenceKey"`,
    );
    await this.rewrite(queryRunner, '', '/uploads/');
  }

  /** Swaps the prefix on every file reference, in both folders. */
  private async rewrite(
    queryRunner: QueryRunner,
    from: string,
    to: string,
  ): Promise<void> {
    for (const folder of ['detections/', 'severity/']) {
      const old = `${from}${folder}`;
      const now = `${to}${folder}`;

      // A plain text column: the whole value is the reference.
      await queryRunner.query(
        `UPDATE "detections" SET "image" = $2 || substr("image", length($1) + 1)
          WHERE "image" LIKE $1 || '%'`,
        [old, now],
      );

      // JSON columns: every string value that starts with the old prefix.
      for (const column of ['images', 'eyeResults', 'phase2Summary']) {
        await queryRunner.query(
          `UPDATE "detections"
              SET "${column}" = replace("${column}"::text, '"' || $1, '"' || $2)::jsonb
            WHERE "${column}"::text LIKE '%"' || $1 || '%'`,
          [old, now],
        );
      }

      await queryRunner.query(
        `UPDATE "access_grants" SET "key" = $2 || substr("key", length($1) + 1)
          WHERE "kind" = 'file' AND "key" LIKE $1 || '%'`,
        [old, now],
      );
    }
  }
}
