import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * The stage column goes with it. The model returns an estimated risk and nothing
 * else, so no stage in this column was ever a model output. Severity grading is
 * phase 2 and will bring its own column.
 */
export class DropResultStage1786000200000 implements MigrationInterface {
  name = 'DropResultStage1786000200000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "detections" DROP COLUMN "result"`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "detections" ADD "result" character varying NOT NULL DEFAULT ''`,
    );
  }
}
