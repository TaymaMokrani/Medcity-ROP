import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Phase 2 columns: how severe an eye is, and how soon it needs treating.
 *
 * Until now a detection carried an estimated risk and nothing else, because the
 * Phase 1 model has no notion of severity. The severity pipeline measures vessel
 * tortuosity, caliber and the vascular front, and produces a grade with the
 * evidence behind it.
 *
 * Three things about the defaults are deliberate:
 *
 *   `phase2Status` starts at 'none', not at a severity. A screening nobody has
 *   analysed must not be indistinguishable from one that came back mild.
 *
 *   `severity` is nullable and has no default for the same reason. The severity
 *   vocabulary includes 'unknown', which means measured-and-inconclusive; that
 *   is a different state from never-run and the two must not collapse.
 *
 *   the assessment and the evidence are separate columns. The assessment is a
 *   few kilobytes and travels with every detection; the evidence packets are
 *   around 400 kB per photograph and are read only when someone opens the
 *   viewer, so they are never dragged through a list query.
 */
export class AddPhase2Severity1786000400000 implements MigrationInterface {
  name = 'AddPhase2Severity1786000400000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "detections" ADD "phase2Status" character varying NOT NULL DEFAULT 'none'`,
    );
    await queryRunner.query(
      `ALTER TABLE "detections" ADD "phase2JobId" character varying`,
    );
    await queryRunner.query(`ALTER TABLE "detections" ADD "phase2Error" text`);
    await queryRunner.query(`ALTER TABLE "detections" ADD "phase2At" text`);
    await queryRunner.query(
      `ALTER TABLE "detections" ADD "severity" character varying`,
    );
    await queryRunner.query(
      `ALTER TABLE "detections" ADD "severityUrgent" boolean NOT NULL DEFAULT false`,
    );
    await queryRunner.query(
      `ALTER TABLE "detections" ADD "phase2Summary" jsonb`,
    );
    await queryRunner.query(
      `ALTER TABLE "detections" ADD "phase2Evidence" jsonb`,
    );
    await queryRunner.query(
      `ALTER TABLE "detections" ADD "icropStages" jsonb NOT NULL DEFAULT '{}'::jsonb`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    for (const column of [
      'icropStages',
      'phase2Evidence',
      'phase2Summary',
      'severityUrgent',
      'severity',
      'phase2At',
      'phase2Error',
      'phase2JobId',
      'phase2Status',
    ]) {
      await queryRunner.query(
        `ALTER TABLE "detections" DROP COLUMN "${column}"`,
      );
    }
  }
}
