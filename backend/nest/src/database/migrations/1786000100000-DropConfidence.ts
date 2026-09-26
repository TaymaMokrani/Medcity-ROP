import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * `confidence` predates the model: a percentage attached to a stage, neither of
 * which the model produces. It produces one number, `risk`, and the previous
 * migration already carried the old values across into it. A stage is now only
 * ever typed by a doctor, so `result` starts empty.
 */
export class DropConfidence1786000100000 implements MigrationInterface {
  name = 'DropConfidence1786000100000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "detections" DROP COLUMN "confidence"`,
    );
    await queryRunner.query(
      `ALTER TABLE "detections" ALTER COLUMN "result" SET DEFAULT ''`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "detections" ALTER COLUMN "result" DROP DEFAULT`,
    );
    await queryRunner.query(
      `ALTER TABLE "detections" ADD "confidence" double precision NOT NULL DEFAULT 0`,
    );
    await queryRunner.query(
      `UPDATE "detections" SET "confidence" = "risk" * 100`,
    );
  }
}
