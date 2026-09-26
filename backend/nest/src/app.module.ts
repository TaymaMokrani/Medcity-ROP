import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AppController } from './app.controller';
import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';
import { PatientsModule } from './patients/patients.module';
import { DetectionsModule } from './detections/detections.module';
import { WorkspaceModule } from './workspace/workspace.module';
import { AccessModule } from './access/access.module';
import { AuditModule } from './audit/audit.module';
import { FilesModule } from './files/files.module';
import { StorageModule } from './storage/storage.module';
import { validateEnv } from './config/env.validation';
import { buildDataSourceOptions } from './database/data-source-options';
@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, validate: validateEnv }),
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: async (config: ConfigService) => ({
        ...(await buildDataSourceOptions(config.get<string>('DATABASE_URL'))),
        migrationsRun: true,
      }),
      inject: [ConfigService],
    }),
    StorageModule,
    AccessModule,
    AuditModule,
    AuthModule,
    UsersModule,
    PatientsModule,
    DetectionsModule,
    WorkspaceModule,
    FilesModule,
  ],
  controllers: [AppController],
})
export class AppModule {}
