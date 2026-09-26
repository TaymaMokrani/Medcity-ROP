import {
  BadRequestException,
  Controller,
  Get,
  Param,
  Post,
  StreamableFile,
  UploadedFiles,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { ApiBearerAuth, ApiConsumes, ApiTags } from '@nestjs/swagger';
import { FileFieldsInterceptor } from '@nestjs/platform-express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser, type AuthUser } from '../auth/current-user.decorator';
import { AccessService } from '../access/access.service';
import { keepInMemory, type EyeFiles } from '../detections/upload.config';
import { StorageService } from '../storage/storage.service';
import { RENDER_PREFIX } from '../storage/keys';
import { SeverityQueueService } from '../detections/severity-queue.service';
import { WORKSPACE_FIELDS, workspaceUploads } from './workspace-files';

/** A render name the gateway stored under `severity/`: no paths, no dots first. */
const EVIDENCE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*\.(jpg|jpeg|png)$/i;

/**
 * The Vessel Workspace: vessel measurements without an examination.
 *
 * A doctor imports photographs and studies the vessels. Nothing is written to
 * the database. The job it starts is polled through the same preview routes
 * the detection flow uses (`/detections/severity-jobs/:jobId`), so the only
 * things this adds are an upload that accepts a single photograph, and a way to
 * read an evidence image that a canvas is allowed to export.
 */
@ApiTags('workspace')
@ApiBearerAuth()
@Controller('workspace')
@UseGuards(JwtAuthGuard)
export class WorkspaceController {
  constructor(
    private readonly severityQueue: SeverityQueueService,
    private readonly access: AccessService,
    private readonly storage: StorageService,
  ) {}

  @Post('analyze')
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(FileFieldsInterceptor(WORKSPACE_FIELDS, keepInMemory))
  async analyze(
    @UploadedFiles() files: EyeFiles,
    @CurrentUser() user: AuthUser,
  ) {
    const job = await this.severityQueue.enqueuePreview(
      workspaceUploads(files),
      'workspace',
      user.id,
    );
    // The same grant the detection flow writes. It is what the shared polling
    // routes check, so without it the Workspace could not read back the job it
    // just started — and with it, nobody else can either.
    await this.access.grant('job', job.jobId, user.id);
    return { jobId: job.jobId, status: job.status };
  }

  /**
   * One rendered evidence image, served so a canvas may export it.
   *
   * `/files/severity/:name` serves the same file, but as an opaque download
   * for an `<img>`; a canvas that has drawn it can only be exported when the
   * response carried CORS headers, which is what this route is for.
   *
   * Same check as the file route, and it is not optional. This used to serve
   * any name in the severity folder to any signed-in doctor, on the reasoning
   * that the file was public under the static route anyway. The static route
   * is gone, and that reasoning went with it.
   */
  @Get('evidence-image/:name')
  async evidenceImage(
    @Param('name') name: string,
    @CurrentUser() user: AuthUser,
  ): Promise<StreamableFile> {
    if (!EVIDENCE_NAME.test(name)) {
      throw new BadRequestException('Not an evidence image name');
    }
    const key = `${RENDER_PREFIX}${name}`;
    await this.access.require('file', key, user.id);

    const file = await this.storage.open(key);
    return new StreamableFile(file.stream, {
      type: file.contentType,
      length: file.length,
    });
  }
}
