import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { json, urlencoded } from 'express';
import { HttpExceptionFilter } from './common/http-exception.filter';
import { ensureUploadDir } from './detections/upload.config';
import { ensureSeverityDir } from './detections/severity-storage';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const config = app.get(ConfigService);

  ensureUploadDir();
  ensureSeverityDir();
  app.setGlobalPrefix('api');

  app.enableShutdownHooks();

  app.use(json({ limit: '50mb' }));
  app.use(urlencoded({ limit: '50mb', extended: true }));

  // Photographs are NOT served as static assets. `useStaticAssets` asks for no
  // token and knows no owner, so anyone with a URL could download a patient's
  // retina. They are served by FilesController instead, which requires a
  // bearer token and a grant naming the doctor the file belongs to.

  app.enableCors({
    origin: (config.get<string>('CORS_ORIGINS') ?? 'http://localhost:3000')
      .split(',')
      .map((origin) => origin.trim())
      .filter(Boolean),
    credentials: true,
  });

  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  app.useGlobalFilters(new HttpExceptionFilter());

  const docs = new DocumentBuilder()
    .setTitle('MedCity ROP — Gateway API')
    .setDescription(
      'The only API the frontend talks to. Handles authentication, business ' +
        'logic and persistence, and is the sole caller of the FastAPI ML service. ' +
        'Every route except /health and /auth/* requires a bearer token, and ' +
        'every record, file and analysis job is scoped to the doctor who owns ' +
        'it. Photographs are served by /uploads/* against an access grant, ' +
        'never as static files.',
    )
    .setVersion('0.1.0')
    .addBearerAuth()
    .build();

  SwaggerModule.setup(
    'api/docs',
    app,
    SwaggerModule.createDocument(app, docs),
    {
      swaggerOptions: { persistAuthorization: true },
    },
  );

  const port = config.get<number>('PORT') ?? 4000;
  await app.listen(port);
  console.log(`Server running on http://localhost:${port}/api`);
  console.log(`API docs at        http://localhost:${port}/api/docs`);
}

void bootstrap();
