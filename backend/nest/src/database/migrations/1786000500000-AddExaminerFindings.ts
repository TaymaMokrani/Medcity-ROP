import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Where the examining clinician's own zone and plus are kept.
 *
 * Until now the doctor could record one thing: the ICROP stage, because that
 * was the axis the pipeline could not measure. Zone and plus were the
 * analyser's alone, so a doctor who disagreed with a measured zone had nowhere
 * to say so, and a screening with no severity analysis had nowhere to record
 * any finding at all.
 *
 * Separate from `phase2Summary` on purpose. The analyser's values and the
 * doctor's are both kept, shown side by side, and never merged — a record that
 * cannot say who found what is not a record.
 *
 * Empty object rather than null: there is no difference between "no findings
 * entered" and "an empty set of findings", and a default keeps every read from
 * having to guard.
 */
export class AddExaminerFindings1786000500000 implements MigrationInterface {
  name = 'AddExaminerFindings1786000500000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "detections" ADD "examinerFindings" jsonb NOT NULL DEFAULT '{}'::jsonb`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "detections" DROP COLUMN "examinerFindings"`,
    );
  }
}
