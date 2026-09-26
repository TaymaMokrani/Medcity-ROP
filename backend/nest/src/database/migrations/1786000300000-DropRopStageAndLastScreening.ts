import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Both columns claimed things the record could not know.
 *
 * `ropStage` was typed by hand. The model does not grade severity — it returns
 * an estimated risk and nothing else — so a stage on a patient record was one
 * doctor's opinion wearing the tool's clothes. Severity grading is phase 2 and
 * will bring its own column, written by the model rather than a text field.
 *
 * `lastScreening` was also typed, and nothing ever updated it when a screening
 * was actually recorded. A patient who had never been screened could still show
 * a screening date. It is now derived from the detections themselves, which is
 * the only place that knows when a screening really happened.
 */
export class DropRopStageAndLastScreening1786000300000 implements MigrationInterface {
  name = 'DropRopStageAndLastScreening1786000300000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "patients" DROP COLUMN "ropStage"`);
    await queryRunner.query(
      `ALTER TABLE "patients" DROP COLUMN "lastScreening"`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // the values themselves are not recoverable, and were never trustworthy;
    // the column comes back with the default the schema originally carried
    await queryRunner.query(
      `ALTER TABLE "patients" ADD "ropStage" character varying NOT NULL DEFAULT 'None'`,
    );
    await queryRunner.query(
      `ALTER TABLE "patients" ADD "lastScreening" character varying`,
    );
  }
}
