import { MigrationInterface, QueryRunner } from 'typeorm';

export class InitialSchema1785805366535 implements MigrationInterface {
  name = 'InitialSchema1785805366535';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "users" ("id" uuid NOT NULL, "name" character varying NOT NULL, "email" character varying NOT NULL, "passwordHash" character varying NOT NULL, "createdAt" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "UQ_97672ac88f789774dd47f7c8be3" UNIQUE ("email"), CONSTRAINT "PK_a3ffb1c0c8416b9fc6f907b7433" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE TABLE "patients" ("id" character varying NOT NULL, "ownerId" character varying NOT NULL, "firstName" character varying NOT NULL, "lastName" character varying NOT NULL, "dateOfBirth" character varying NOT NULL, "gender" character varying NOT NULL, "gestationalAge" double precision NOT NULL, "birthWeight" double precision NOT NULL, "motherName" character varying NOT NULL, "phone" character varying, "email" character varying, "address" character varying, "bloodType" character varying, "notes" text, "status" character varying NOT NULL, "ropStage" character varying NOT NULL, "lastScreening" character varying, "createdAt" character varying NOT NULL, CONSTRAINT "PK_a7f0b9fcbb3469d5ec0b0aceaa7" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_4e8dab9c92c195489e9e09f9d8" ON "patients"  ("ownerId") `,
    );
    await queryRunner.query(
      `CREATE TABLE "detections" ("id" character varying NOT NULL, "ownerId" character varying NOT NULL, "patientId" character varying NOT NULL, "patientName" character varying NOT NULL, "date" character varying NOT NULL, "result" character varying NOT NULL, "confidence" double precision NOT NULL, "eye" character varying NOT NULL, "image" text, "images" jsonb NOT NULL DEFAULT '[]'::jsonb, "eyeResults" jsonb NOT NULL DEFAULT '[]'::jsonb, "notes" text, "createdAt" character varying NOT NULL, CONSTRAINT "PK_4da30bad53c898b6d767852594e" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_b89805affcec68fe42432bf8dd" ON "detections"  ("ownerId") `,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX "public"."IDX_b89805affcec68fe42432bf8dd"`,
    );
    await queryRunner.query(`DROP TABLE "detections"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_4e8dab9c92c195489e9e09f9d8"`,
    );
    await queryRunner.query(`DROP TABLE "patients"`);
    await queryRunner.query(`DROP TABLE "users"`);
  }
}
