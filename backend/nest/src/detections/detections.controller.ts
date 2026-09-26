import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  Query,
  Header,
  UseGuards,
  NotFoundException,
  UseInterceptors,
  UploadedFiles,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiConsumes } from '@nestjs/swagger';
import { FileFieldsInterceptor } from '@nestjs/platform-express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser, type AuthUser } from '../auth/current-user.decorator';
import { DetectionsService } from './detections.service';
import { CreateDetectionDto } from './dto/create-detection.dto';
import { UpdateDetectionDto } from './dto/update-detection.dto';
import { AnalyzeDetectionDto } from './dto/analyze-detection.dto';
import { ExaminerRecordDto } from './dto/examiner-record.dto';
import {
  EYE_FIELDS,
  keepInMemory,
  saveToDisk,
  type EyeFiles,
} from './upload.config';

@ApiTags('detections')
@ApiBearerAuth()
@Controller('detections')
@UseGuards(JwtAuthGuard)
export class DetectionsController {
  constructor(private readonly detectionsService: DetectionsService) {}

  @Get()
  async findAll(
    @CurrentUser() user: AuthUser,
    @Query('patientId') patientId?: string,
  ) {
    if (patientId) {
      return this.detectionsService.findByPatient(patientId, user.id);
    }
    return this.detectionsService.findAll(user.id);
  }

  @Get(':id')
  async findOne(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    const detection = await this.detectionsService.findOne(id, user.id);
    if (!detection) throw new NotFoundException('Detection not found');
    return detection;
  }

  @Post('analyze')
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(FileFieldsInterceptor(EYE_FIELDS, keepInMemory))
  async analyze(
    @UploadedFiles() files: EyeFiles,
    @Body() dto: AnalyzeDetectionDto,
    @CurrentUser() user: AuthUser,
  ) {
    const eyeResults = await this.detectionsService.analyze(
      dto,
      files,
      user.id,
    );
    return { eyeResults };
  }

  /**
   * Measures severity on an upload that has not been saved yet.
   *
   * The doctor commits a screening once, when they are satisfied with all of it,
   * so the analysis has to be available before there is a record. The job id
   * comes back with the create request later, and the assessment is attached
   * then.
   */
  @Post('analyze-severity')
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(FileFieldsInterceptor(EYE_FIELDS, keepInMemory))
  async analyzeSeverity(
    @UploadedFiles() files: EyeFiles,
    @Body() dto: AnalyzeDetectionDto,
    @CurrentUser() user: AuthUser,
  ) {
    const job = await this.detectionsService.startSeverityPreview(
      files,
      dto.eye,
      user.id,
    );
    return { jobId: job.jobId, status: job.status };
  }

  /**
   * How a preview analysis is getting on, and its assessment once it is done.
   *
   * Scoped to the doctor who started it. A preview has no record behind it
   * yet, so there is nothing for the usual owner check to read — the job
   * itself is what carries the owner.
   */
  @Get('severity-jobs/:jobId')
  async severityJob(
    @Param('jobId') jobId: string,
    @CurrentUser() user: AuthUser,
  ) {
    const { job, summary } = await this.detectionsService.severityJob(
      jobId,
      user.id,
    );
    return {
      status: job.status,
      jobId: job.jobId,
      step: job.step,
      progress: job.progress,
      seconds: job.seconds,
      error: job.error,
      summary,
    };
  }

  /** One photograph's evidence packet from a preview job, for the viewer. */
  @Get('severity-jobs/:jobId/evidence/:key')
  async severityJobPacket(
    @Param('jobId') jobId: string,
    @Param('key') key: string,
    @CurrentUser() user: AuthUser,
  ) {
    return this.detectionsService.severityJobPacket(jobId, key, user.id);
  }

  @Post()
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(FileFieldsInterceptor(EYE_FIELDS, saveToDisk))
  async create(
    @UploadedFiles() files: EyeFiles,
    @Body() dto: CreateDetectionDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.detectionsService.createFromUpload(dto, files, user.id);
  }

  /**
   * Starts the severity analysis for a saved screening.
   *
   * Answers immediately: measuring a patient takes about a minute, so the
   * client polls the status route rather than holding a request open.
   */
  @Post(':id/severity')
  async startSeverity(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    const detection = await this.detectionsService.startSeverity(id, user.id);
    return {
      status: detection.phase2Status,
      jobId: detection.phase2JobId,
    };
  }

  /**
   * Where the analysis has got to, and the assessment once it is finished.
   *
   * The result is collected on the first poll that finds the job done, so this
   * route is what makes an assessment durable. The evidence packets are left
   * out; they have their own route.
   */
  @Get(':id/severity')
  async severityStatus(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    const { detection, job } = await this.detectionsService.severityStatus(
      id,
      user.id,
    );
    return {
      status: detection.phase2Status,
      jobId: detection.phase2JobId,
      error: detection.phase2Error,
      analysedAt: detection.phase2At,
      severity: detection.severity,
      urgent: detection.severityUrgent,
      icropStages: detection.icropStages,
      examinerFindings: detection.examinerFindings,
      summary: detection.phase2Summary,
      step: job?.step ?? null,
      progress: job?.progress ?? null,
      seconds: job?.seconds ?? null,
    };
  }

  /** The per-photograph evidence packets. Megabytes; fetched by the viewer only. */
  @Get(':id/severity/evidence')
  async severityEvidence(
    @Param('id') id: string,
    @CurrentUser() user: AuthUser,
  ) {
    return this.detectionsService.severityEvidence(id, user.id);
  }

  /** One photograph's evidence packet from a saved screening, for the viewer. */
  @Get(':id/severity/evidence/:key')
  async severityPacket(
    @Param('id') id: string,
    @Param('key') key: string,
    @CurrentUser() user: AuthUser,
  ) {
    return this.detectionsService.severityPacket(id, user.id, key);
  }

  /**
   * What the examining clinician found in one eye: stage, zone, plus.
   *
   * The analyser measures zone and plus and cannot measure stage. Both sets are
   * kept and neither overwrites the other, so the screen can show them side by
   * side and say which is which.
   */
  @Put(':id/examiner')
  async setExaminerRecord(
    @Param('id') id: string,
    @Body() dto: ExaminerRecordDto,
    @CurrentUser() user: AuthUser,
  ) {
    const detection = await this.detectionsService.setExaminerRecord(
      id,
      user.id,
      dto,
    );
    return {
      icropStages: detection.icropStages,
      examinerFindings: detection.examinerFindings,
    };
  }

  /**
   * The screening in the format a hospital record system can file.
   *
   * Served as its own route rather than a field on the screening: it is a
   * document, it is fetched deliberately, and it is logged when it is.
   */
  @Get(':id/fhir')
  @Header('Content-Type', 'application/fhir+json')
  async fhir(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.detectionsService.fhirBundle(id, {
      id: user.id,
      name: user.name,
    });
  }

  @Put(':id')
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateDetectionDto,
    @CurrentUser() user: AuthUser,
  ) {
    const detection = await this.detectionsService.update(id, dto, user.id);
    if (!detection) throw new NotFoundException('Detection not found');
    return detection;
  }

  @Delete(':id')
  async remove(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    const removed = await this.detectionsService.remove(id, user.id);
    if (!removed) throw new NotFoundException('Detection not found');
    return { success: true };
  }
}
