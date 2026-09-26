import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * The model now returns a calibrated ROP risk instead of a made-up stage, and
 * the doctor records what they concluded from it. Existing rows keep their
 * verdict; their risk is back-filled from the confidence they were stored with.
 */
export class AddRiskAndDoctorDecision1786000000000 implements MigrationInterface {
  name = 'AddRiskAndDoctorDecision1786000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "detections" ADD "risk" double precision NOT NULL DEFAULT 0`,
    );
    await queryRunner.query(
      `ALTER TABLE "detections" ADD "flagged" boolean NOT NULL DEFAULT false`,
    );
    await queryRunner.query(
      `ALTER TABLE "detections" ADD "doctorDecision" character varying NOT NULL DEFAULT 'Pending'`,
    );
    await queryRunner.query(`ALTER TABLE "detections" ADD "decidedAt" text`);

    await queryRunner.query(
      `UPDATE "detections" SET "flagged" = ("result" <> 'No ROP Detected')`,
    );
    await queryRunner.query(
      `UPDATE "detections" SET "risk" = CASE
         WHEN "result" = 'No ROP Detected' THEN 1 - ("confidence" / 100)
         ELSE "confidence" / 100 END`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "detections" DROP COLUMN "decidedAt"`);
    await queryRunner.query(
      `ALTER TABLE "detections" DROP COLUMN "doctorDecision"`,
    );
    await queryRunner.query(`ALTER TABLE "detections" DROP COLUMN "flagged"`);
    await queryRunner.query(`ALTER TABLE "detections" DROP COLUMN "risk"`);
  }
}
