import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  Detection,
  REQUIRED_IMAGES_PER_EYE,
  type DetectionImage,
  type EyeAnalysis,
} from './detection.entity';
import { Patient } from '../patients/patient.entity';
import { AnalyzeDetectionDto } from './dto/analyze-detection.dto';
import { CreateDetectionDto } from './dto/create-detection.dto';
import { UpdateDetectionDto } from './dto/update-detection.dto';
import { applyChanges } from '../common/apply-changes';
import {
  EYES,
  eyesFor,
  ICROP_STAGES,
  PLUS_GRADES,
  ZONES,
  type ExaminerFinding,
  type ExaminerFindings,
  type Eye,
  type EyeSelection,
  type IcropStage,
  type IcropStages,
  type PlusGrade,
  type Severity,
  type Zone,
} from './rop';
import { storedImageUrls, storedObjectKeys } from './detection-storage';
import type { EyeFiles } from './upload.config';
import { MlService, type EyePrediction } from '../ml/ml.service';
import type { SeverityJob, UploadedImage } from '../severity/severity.service';
import { SeverityQueueService } from './severity-queue.service';
import { ExaminerRecordDto } from './dto/examiner-record.dto';
import { generateId } from '../common/id';
import type { Page } from '../common/page';
import { AccessService } from '../access/access.service';
import { AuditService } from '../audit/audit.service';
import { buildFhirBundle, type FhirBundle } from './fhir';
import { StorageService } from '../storage/storage.service';
import { evidenceKey, newPhotoKey, PHOTO_PREFIX } from '../storage/keys';

const GESTATIONAL_AGE_MIN = 20;
const GESTATIONAL_AGE_MAX = 45;

const AGE_WEEKS_MAX = 60;

const MS_PER_WEEK = 7 * 24 * 60 * 60 * 1000;

@Injectable()
export class DetectionsService {
  private readonly logger = new Logger(DetectionsService.name);

  constructor(
    @InjectRepository(Detection)
    private readonly detectionRepository: Repository<Detection>,
    @InjectRepository(Patient)
    private readonly patientRepository: Repository<Patient>,
    private readonly mlService: MlService,
    private readonly severityQueue: SeverityQueueService,
    private readonly access: AccessService,
    private readonly audit: AuditService,
    private readonly storage: StorageService,
  ) {}

  /** How a screening reads in the activity log once the record itself is gone. */
  private label(detection: Detection): string {
    return `${detection.patientName} — ${detection.date}`;
  }

  /** Newest first. With no page asked for, the whole list, as before. */
  async findAll(
    ownerId: string,
    page: Page = {},
  ): Promise<[Detection[], number]> {
    return this.detectionRepository.findAndCount({
      where: { ownerId },
      order: { createdAt: 'DESC' },
      take: page.limit,
      skip: page.offset,
    });
  }

  async findOne(id: string, ownerId: string): Promise<Detection | null> {
    return this.detectionRepository.findOneBy({ id, ownerId });
  }

  async findByPatient(
    patientId: string,
    ownerId: string,
    page: Page = {},
  ): Promise<[Detection[], number]> {
    return this.detectionRepository.findAndCount({
      where: { patientId, ownerId },
      order: { createdAt: 'DESC' },
      take: page.limit,
      skip: page.offset,
    });
  }

  private filesPerEye(files: EyeFiles, selection: Eye[]) {
    const byEye: Record<Eye, Express.Multer.File[]> = {
      Left: files?.leftImages ?? [],
      Right: files?.rightImages ?? [],
    };

    for (const eye of EYES) {
      const attached = byEye[eye].length;
      if (selection.includes(eye) && attached !== REQUIRED_IMAGES_PER_EYE) {
        throw new BadRequestException(
          `Exactly ${REQUIRED_IMAGES_PER_EYE} images are required for the ` +
            `${eye.toLowerCase()} eye — ${attached} attached`,
        );
      }
      if (!selection.includes(eye) && attached > 0) {
        throw new BadRequestException(
          `Images were attached for the ${eye.toLowerCase()} eye, which is not ` +
            'part of this screening',
        );
      }
    }

    return byEye;
  }

  private async clinicalFor(patientId: string, ownerId: string, date: string) {
    const patient = await this.patientRepository.findOneBy({
      id: patientId,
      ownerId,
    });
    if (!patient) {
      throw new BadRequestException('Unknown patient');
    }

    const gestationalAge = Number(patient.gestationalAge);
    if (
      !Number.isFinite(gestationalAge) ||
      gestationalAge < GESTATIONAL_AGE_MIN ||
      gestationalAge > GESTATIONAL_AGE_MAX
    ) {
      throw new BadRequestException(
        `This patient's gestational age (${patient.gestationalAge}) is outside ` +
          `the ${GESTATIONAL_AGE_MIN}–${GESTATIONAL_AGE_MAX} week range the ` +
          'model was trained on. Correct the patient record before screening.',
      );
    }

    const born = Date.parse(patient.dateOfBirth);
    const examined = Date.parse(date);
    if (Number.isNaN(born) || Number.isNaN(examined)) {
      throw new BadRequestException(
        'The date of birth or the examination date is not a valid date',
      );
    }

    const ageWeeks = (examined - born) / MS_PER_WEEK;
    if (ageWeeks < 0) {
      throw new BadRequestException(
        'The examination date is before the date of birth',
      );
    }
    if (ageWeeks > AGE_WEEKS_MAX) {
      throw new BadRequestException(
        `This patient is ${ageWeeks.toFixed(0)} weeks old at this examination ` +
          `date, beyond the ${AGE_WEEKS_MAX} weeks the model was trained on ` +
          '(screening normally happens in the first weeks of life). Check the ' +
          'date of birth and the examination date.',
      );
    }

    return {
      gestationalAge,
      ageWeeks: Math.round(ageWeeks * 100) / 100,
      patientName: `${patient.firstName} ${patient.lastName}`.trim(),
    };
  }

  private async scoreEye(
    eye: Eye,
    images: { buffer: Buffer }[],
    clinical: { gestationalAge: number; ageWeeks: number },
  ): Promise<EyePrediction> {
    return this.mlService.predict(
      images.map((file) => file.buffer),
      {
        eye,
        gestationalAge: clinical.gestationalAge,
        ageWeeks: clinical.ageWeeks,
      },
    );
  }

  private toAnalysis(
    eye: Eye,
    prediction: EyePrediction,
    images: string[] = [],
  ): EyeAnalysis {
    return {
      eye,
      risk: prediction.risk,
      flagged: prediction.flagged,
      threshold: prediction.threshold,
      modelVersion: prediction.modelVersion,
      images,
    };
  }

  async analyze(dto: AnalyzeDetectionDto, files: EyeFiles, ownerId: string) {
    const screenedEyes = eyesFor(dto.eye);
    const byEye = this.filesPerEye(files, screenedEyes);
    const clinical = await this.clinicalFor(dto.patientId, ownerId, dto.date);

    return Promise.all(
      screenedEyes.map(async (eye) =>
        this.toAnalysis(eye, await this.scoreEye(eye, byEye[eye], clinical)),
      ),
    );
  }

  async createFromUpload(
    dto: CreateDetectionDto,
    files: EyeFiles,
    ownerId: string,
  ): Promise<Detection> {
    const screenedEyes = eyesFor(dto.eye);
    const byEye = this.filesPerEye(files, screenedEyes);

    // Checked before anything is scored or written. A job this doctor did not
    // start is not theirs to attach: doing so would copy another doctor's
    // assessment, and their patient's evidence renders, onto this record.
    if (dto.severityJobId) {
      await this.access.require('job', dto.severityJobId, ownerId);
    }

    const clinical = await this.clinicalFor(dto.patientId, ownerId, dto.date);

    // Scored from memory before anything is stored, so a refused or failed
    // analysis leaves no orphaned photographs behind.
    const predictions = await Promise.all(
      screenedEyes.map((eye) => this.scoreEye(eye, byEye[eye], clinical)),
    );

    // Then each photograph goes to object storage under a fresh key. The key,
    // not a path on this machine, is what the record keeps.
    const images: DetectionImage[] = [];
    for (const eye of EYES) {
      for (const file of byEye[eye]) {
        const key = newPhotoKey(file.originalname);
        await this.storage.put(key, file.buffer, file.mimetype);
        images.push({ url: key, eye });
      }
    }

    const eyeResults: EyeAnalysis[] = screenedEyes.map((eye, index) =>
      this.toAnalysis(
        eye,
        predictions[index],
        images.filter((image) => image.eye === eye).map((i) => i.url),
      ),
    );

    const worst = eyeResults.reduce((a, b) => (b.risk > a.risk ? b : a));

    const { severityJobId, icropStages, examinerFindings, ...fields } = dto;

    const detection = this.detectionRepository.create({
      ...fields,
      icropStages: this.parseStages(icropStages, screenedEyes),
      examinerFindings: this.parseFindings(examinerFindings, screenedEyes),
      id: generateId('DET'),
      ownerId,
      risk: worst.risk,
      flagged: eyeResults.some((r) => r.flagged),
      image: images[0]?.url ?? '',
      images,
      eyeResults,
      // Every eye is scored by the same service in the same request.
      modelVersion: eyeResults[0]?.modelVersion ?? null,
      doctorDecision: 'Pending',
      decidedAt: null,
    });
    // Not a stored column: loads read it from the patient. Set here so the
    // reply and the activity log have it before the row is read back.
    detection.patientName = clinical.patientName;

    // The stored photographs get an owner of their own. Until this row
    // exists the file route serves them to nobody, so granting is part of
    // saving a screening rather than an afterthought.
    await this.access.grant(
      'file',
      images.map((image) => image.url),
      ownerId,
    );

    // The doctor ran the severity analysis before committing, so the assessment
    // already exists. Attaching it here rather than re-running keeps what they
    // approved and what gets stored the same thing.
    if (severityJobId) {
      detection.phase2JobId = severityJobId;
      try {
        const analysed = await this.attachPreview(detection, severityJobId);
        await this.recordCreated(analysed, ownerId, true);
        return analysed;
      } catch (error) {
        // A screening is worth saving even if the assessment could not be
        // reattached — the photographs and the Phase 1 estimate are the record.
        this.logger.warn(
          `could not attach severity job ${severityJobId}: ${String(error)}`,
        );
        detection.phase2Status = 'failed';
        detection.phase2Error =
          'The severity analysis could not be attached. Run it again from this screening.';
      }
    }

    const saved = await this.detectionRepository.save(detection);
    await this.recordCreated(saved, ownerId, false);
    return saved;
  }

  private async recordCreated(
    detection: Detection,
    ownerId: string,
    withSeverity: boolean,
  ): Promise<void> {
    const eyes =
      eyesFor(detection.eye).length === 2
        ? 'both eyes'
        : `the ${detection.eye.toLowerCase()} eye`;
    await this.audit.record({
      actorId: ownerId,
      action: 'screening.created',
      subjectType: 'screening',
      subjectId: detection.id,
      subjectLabel: this.label(detection),
      detail:
        `Recorded a screening of ${eyes}` +
        (withSeverity ? ', with the severity analysis attached' : ''),
    });
  }

  /* -----------------------------------------------------------------------
   * Phase 2 — severity
   * -------------------------------------------------------------------- */

  private async require(id: string, ownerId: string): Promise<Detection> {
    const detection = await this.findOne(id, ownerId);
    if (!detection) throw new NotFoundException('Detection not found');
    return detection;
  }

  /** The stored photographs of each screened eye, as storage keys. */
  private storedPhotosPerEye(
    detection: Detection,
  ): Partial<Record<Eye, string[]>> {
    const perEye: Partial<Record<Eye, string[]>> = {};
    for (const eye of eyesFor(detection.eye)) {
      const keys = (detection.images ?? [])
        .filter(
          (image) => image.eye === eye && image.url.startsWith(PHOTO_PREFIX),
        )
        .map((image) => image.url);
      if (keys.length) perEye[eye] = keys;
    }
    return perEye;
  }

  /**
   * Queues the severity analysis for a stored screening.
   *
   * Answers at once: the job waits in the queue and the worker runs it. The
   * screening follows it through `phase2Status` — queued, running, then done or
   * failed — which the worker keeps up to date.
   *
   * Deliberately not gated on the Phase 1 risk. The interface recommends which
   * eyes are worth analysing, but a doctor who wants a measurement on an eye
   * that scored below their threshold must be able to ask for one — a cut-off
   * enforced here would turn a display preference into a clinical refusal.
   */
  async startSeverity(id: string, ownerId: string): Promise<Detection> {
    const detection = await this.require(id, ownerId);

    if (
      detection.phase2Status === 'queued' ||
      detection.phase2Status === 'running'
    ) {
      return detection;
    }

    const perEye = this.storedPhotosPerEye(detection);
    if (!Object.keys(perEye).length) {
      throw new BadRequestException(
        'This screening has no stored photographs to measure. Only screenings ' +
          'saved with their images can be analysed for severity.',
      );
    }

    const job = await this.severityQueue.enqueueScreening(
      detection.id,
      perEye,
      ownerId,
    );
    await this.access.grant('job', job.jobId, ownerId);

    detection.phase2Status = job.status;
    detection.phase2JobId = job.jobId;
    detection.phase2Error = null;
    const saved = await this.detectionRepository.save(detection);

    await this.audit.record({
      actorId: ownerId,
      action: 'severity.started',
      subjectType: 'screening',
      subjectId: saved.id,
      subjectLabel: this.label(saved),
      detail: 'Started the severity analysis',
    });
    return saved;
  }

  /**
   * Measures an upload that has not been saved yet.
   *
   * The doctor commits a screening once, when they are satisfied with all of it,
   * so the severity analysis has to be available before there is a record to
   * attach it to. Nothing is written to the database here; the job id is what
   * the create request later carries so the assessment can be attached.
   */
  async startSeverityPreview(
    files: EyeFiles,
    selection: EyeSelection,
    ownerId: string,
  ): Promise<SeverityJob> {
    const byEye = this.filesPerEye(files, eyesFor(selection));
    const uploads: Partial<Record<Eye, UploadedImage[]>> = {};

    for (const eye of eyesFor(selection)) {
      const images = byEye[eye];
      if (images?.length) {
        uploads[eye] = images.map((file) => ({
          buffer: file.buffer,
          originalname: file.originalname,
        }));
      }
    }

    if (!Object.keys(uploads).length) {
      throw new BadRequestException('No photographs were attached');
    }

    const job = await this.severityQueue.enqueuePreview(
      uploads,
      'preview',
      ownerId,
    );
    // The job is the only handle on this analysis until it is saved, so it
    // gets an owner the moment it exists. Everything that later reads it —
    // progress, assessment, evidence packets, renders — checks this grant.
    await this.access.grant('job', job.jobId, ownerId);
    return job;
  }

  /**
   * A preview job's progress, and its assessment once it is done.
   *
   * The worker keeps a finished preview's assessment and renders in storage, so
   * this only reads: nothing here waits on, or even talks to, the analyser.
   */
  async severityJob(jobId: string, ownerId: string) {
    await this.access.require('job', jobId, ownerId);

    const job = await this.severityQueue.describe(jobId);
    if (!job) {
      throw new NotFoundException(
        'This analysis is no longer available. Run it again.',
      );
    }
    if (job.status !== 'done') return { job, summary: null };
    return { job, summary: await this.severityQueue.summary(jobId) };
  }

  /** One photograph's evidence packet from a preview job, for the viewer. */
  async severityJobPacket(jobId: string, key: string, ownerId: string) {
    await this.access.require('job', jobId, ownerId);
    const evidence = await this.severityQueue.evidence(jobId);
    return this.pickPacket(evidence, key);
  }

  /** One photograph's evidence packet from a saved screening. */
  async severityPacket(id: string, ownerId: string, key: string) {
    return this.pickPacket(await this.severityEvidence(id, ownerId), key);
  }

  /** The viewer draws one photograph at a time; the whole set is megabytes. */
  private pickPacket(evidence: unknown, key: string) {
    const packets =
      (evidence as { packets?: Record<string, unknown> })?.packets ?? {};
    const packet = packets[key];
    if (!packet) throw new NotFoundException('No such evidence packet');
    return packet;
  }

  /**
   * Where a saved screening's analysis has got to, and the assessment once it
   * is finished.
   *
   * The worker writes the result into the screening the moment the analysis
   * ends, so this only reads. One case is handled here: a screening still
   * marked as waiting whose job the queue no longer knows — the queue was
   * emptied, or the job predates it. That analysis can never finish, so the
   * screening says so instead of waiting forever.
   */
  async severityStatus(
    id: string,
    ownerId: string,
  ): Promise<{ detection: Detection; job: SeverityJob | null }> {
    const detection = await this.require(id, ownerId);

    const pending =
      detection.phase2Status === 'queued' ||
      detection.phase2Status === 'running';
    if (!pending || !detection.phase2JobId) {
      return { detection, job: null };
    }

    const job = await this.severityQueue.describe(detection.phase2JobId);
    if (!job) {
      detection.phase2Status = 'failed';
      detection.phase2Error =
        'The analysis was interrupted and can no longer be followed. Run it again.';
      detection.phase2At = new Date();
      return { detection: await this.detectionRepository.save(detection), job };
    }
    return { detection, job };
  }

  /**
   * Attaches a finished preview to the screening being saved: the assessment
   * the doctor already looked at, not a second run.
   *
   * The renders are already in storage under the job's name and already
   * granted to this doctor. The packets are copied to the screening's own key,
   * so the nightly cleanup can clear the job's files without touching the record.
   */
  private async attachPreview(
    detection: Detection,
    jobId: string,
  ): Promise<Detection> {
    const job = await this.severityQueue.describe(jobId);
    if (job?.status !== 'done') {
      throw new Error(`job ${jobId} is ${job?.status ?? 'unknown'}, not done`);
    }

    const summary = await this.severityQueue.summary(jobId);
    const patient = (summary.patient ?? {}) as {
      severity?: Severity;
      urgent?: boolean;
    };

    detection.phase2EvidenceKey = null;
    try {
      const packets = await this.severityQueue.evidenceBytes(jobId);
      const key = evidenceKey(detection.id);
      await this.storage.put(key, packets, 'application/json');
      detection.phase2EvidenceKey = key;
    } catch (error) {
      // The packets only drive the overlay viewer; the grading still stands.
      this.logger.warn(`no packets for preview ${jobId}: ${String(error)}`);
    }

    detection.phase2Summary = summary;
    detection.phase2Evidence = null;
    detection.severity = patient.severity ?? 'unknown';
    detection.severityUrgent = Boolean(patient.urgent);
    detection.phase2Status = 'done';
    detection.phase2Error = null;
    detection.phase2At = new Date();
    detection.phase2Version =
      typeof summary.pipeline_version === 'string'
        ? summary.pipeline_version
        : null;

    return this.detectionRepository.save(detection);
  }

  /** The per-photograph packets, fetched only when the evidence viewer opens.
   *
   * From storage. A screening analysed before the packets moved there may still
   * hold them in the old column, which is `select: false` and so is asked for
   * by name here: no other query carries it. */
  async severityEvidence(id: string, ownerId: string) {
    const row = await this.detectionRepository.findOne({
      where: { id, ownerId },
      select: { id: true, phase2EvidenceKey: true, phase2Evidence: true },
    });
    if (!row) throw new NotFoundException('Detection not found');
    if (row.phase2EvidenceKey) {
      const bytes = await this.storage.read(row.phase2EvidenceKey);
      return JSON.parse(bytes.toString('utf8')) as Record<string, unknown>;
    }
    return row.phase2Evidence ?? { packets: {} };
  }

  /**
   * The stages the examiner recorded before saving, checked before they are kept.
   *
   * They arrive as a JSON string because the create request is multipart, so
   * nothing about the shape can be assumed. Anything that is not a stage for an
   * eye in this screening is dropped rather than stored.
   */
  private parseStages(raw: string | undefined, screened: Eye[]): IcropStages {
    if (!raw) return {};

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new BadRequestException('icropStages is not valid JSON');
    }
    if (!parsed || typeof parsed !== 'object') return {};

    const stages: IcropStages = {};
    for (const [eye, value] of Object.entries(
      parsed as Record<string, unknown>,
    )) {
      if (!screened.includes(eye as Eye)) continue;
      const stage = Number(value);
      if (ICROP_STAGES.includes(stage as IcropStage)) {
        stages[eye as Eye] = stage as IcropStage;
      }
    }
    return stages;
  }

  /**
   * Zone and plus recorded before the screening was saved.
   *
   * Same contract as the stages: a JSON string, checked rather than trusted,
   * and anything that is not a known value for an eye in this screening is
   * dropped instead of stored.
   */
  private parseFindings(
    raw: string | undefined,
    screened: Eye[],
  ): ExaminerFindings {
    if (!raw) return {};

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new BadRequestException('examinerFindings is not valid JSON');
    }
    if (!parsed || typeof parsed !== 'object') return {};

    const findings: ExaminerFindings = {};
    for (const [eye, value] of Object.entries(
      parsed as Record<string, unknown>,
    )) {
      if (
        !screened.includes(eye as Eye) ||
        !value ||
        typeof value !== 'object'
      ) {
        continue;
      }
      const { zone, plus } = value as { zone?: unknown; plus?: unknown };
      const entry: ExaminerFinding = {};
      if (ZONES.includes(zone as Zone)) entry.zone = zone as Zone;
      if (PLUS_GRADES.includes(plus as PlusGrade))
        entry.plus = plus as PlusGrade;
      if (Object.keys(entry).length > 0) findings[eye as Eye] = entry;
    }
    return findings;
  }

  /**
   * Records what the examining clinician found in one eye.
   *
   * Stage, zone and plus, each optional and each stored apart from anything the
   * analyser wrote. Only the axes present in the request are touched, so a
   * screen that edits one field does not silently clear the other two.
   *
   * `null` clears an axis. For stage that is not the same as 0: 0 means the
   * doctor looked and found no ROP staging, null means nobody has recorded one.
   */
  async setExaminerRecord(
    id: string,
    ownerId: string,
    dto: ExaminerRecordDto,
  ): Promise<Detection> {
    const detection = await this.require(id, ownerId);

    if (!eyesFor(detection.eye).includes(dto.eye)) {
      throw new BadRequestException(
        `The ${dto.eye.toLowerCase()} eye is not part of this screening`,
      );
    }

    if (dto.stage !== undefined) {
      const stages = { ...(detection.icropStages ?? {}) };
      if (dto.stage === null) {
        delete stages[dto.eye];
      } else {
        if (!ICROP_STAGES.includes(dto.stage)) {
          throw new BadRequestException(
            `Stage must be one of ${ICROP_STAGES.join(', ')}`,
          );
        }
        stages[dto.eye] = dto.stage;
      }
      detection.icropStages = stages;
    }

    if (dto.zone !== undefined || dto.plus !== undefined) {
      const findings = { ...(detection.examinerFindings ?? {}) };
      const current = { ...(findings[dto.eye] ?? {}) };

      if (dto.zone !== undefined) {
        if (dto.zone === null) delete current.zone;
        else current.zone = dto.zone;
      }
      if (dto.plus !== undefined) {
        if (dto.plus === null) delete current.plus;
        else current.plus = dto.plus;
      }

      if (Object.keys(current).length === 0) delete findings[dto.eye];
      else findings[dto.eye] = current;
      detection.examinerFindings = findings;
    }

    const saved = await this.detectionRepository.save(detection);
    await this.audit.record({
      actorId: ownerId,
      action: 'examiner.recorded',
      subjectType: 'screening',
      subjectId: saved.id,
      subjectLabel: this.label(saved),
      detail: `Your findings for the ${dto.eye.toLowerCase()} eye: ${this.describeFindings(dto)}`,
    });
    return saved;
  }

  /**
   * The examiner's own findings, written out for the activity log.
   *
   * Cleared axes are spelled out rather than left silent. "Cleared the stage"
   * and "recorded stage 0" are different acts, and a log that shows only the
   * second cannot be used to explain the first.
   */
  private describeFindings(dto: ExaminerRecordDto): string {
    const parts: string[] = [];
    if (dto.stage !== undefined) {
      parts.push(dto.stage === null ? 'stage cleared' : `stage ${dto.stage}`);
    }
    if (dto.zone !== undefined) {
      parts.push(dto.zone === null ? 'zone cleared' : `zone ${dto.zone}`);
    }
    if (dto.plus !== undefined) {
      parts.push(dto.plus === null ? 'plus cleared' : `plus ${dto.plus}`);
    }
    return parts.length ? parts.join(', ') : 'no change';
  }

  async update(
    id: string,
    dto: UpdateDetectionDto,
    ownerId: string,
  ): Promise<Detection | null> {
    const detection = await this.findOne(id, ownerId);
    if (!detection) return null;

    const previous = detection.doctorDecision;
    const decided = Boolean(
      dto.doctorDecision && dto.doctorDecision !== previous,
    );

    if (decided) {
      detection.decidedAt =
        dto.doctorDecision === 'Pending' ? null : new Date();
    }

    // Moving a screening to another patient: that patient must exist and be
    // this doctor's. The foreign key would refuse a missing one anyway, but
    // with a database error instead of a sentence.
    const moved = dto.patientId && dto.patientId !== detection.patientId;
    if (moved) {
      const patient = await this.patientRepository.findOneBy({
        id: dto.patientId,
        ownerId,
      });
      if (!patient) throw new BadRequestException('Unknown patient');
      detection.patientName = `${patient.firstName} ${patient.lastName}`.trim();
    }

    applyChanges(detection, dto);
    const saved = await this.detectionRepository.save(detection);

    // The conclusion is the doctor's own clinical act, so it is logged as
    // that and not as "a screening was edited". Anything else changing on the
    // same request is a second line — one row, one thing that happened.
    if (decided) {
      await this.audit.record({
        actorId: ownerId,
        action: 'conclusion.recorded',
        subjectType: 'screening',
        subjectId: saved.id,
        subjectLabel: this.label(saved),
        detail:
          previous === 'Pending'
            ? `Concluded: ${saved.doctorDecision}`
            : `Changed your conclusion from ${previous} to ${saved.doctorDecision}`,
      });
    }

    const edited = Object.keys(dto).filter((key) => key !== 'doctorDecision');
    if (edited.length) {
      await this.audit.record({
        actorId: ownerId,
        action: 'screening.updated',
        subjectType: 'screening',
        subjectId: saved.id,
        subjectLabel: this.label(saved),
        detail: `Edited ${edited.join(', ')}`,
      });
    }

    return saved;
  }

  /**
   * The screening as an HL7 FHIR bundle, for a hospital record system.
   *
   * Exporting is a disclosure — the record leaves this system and lands
   * somewhere this system cannot see — so it is written to the activity log
   * like any other act on the record, and the log line says which screening
   * left.
   */
  async fhirBundle(
    id: string,
    user: { id: string; name: string },
  ): Promise<FhirBundle> {
    const detection = await this.require(id, user.id);
    const patient = await this.patientRepository.findOneBy({
      id: detection.patientId,
      ownerId: user.id,
    });

    const bundle = buildFhirBundle(detection, patient, user);

    await this.audit.record({
      actorId: user.id,
      action: 'report.exported',
      subjectType: 'screening',
      subjectId: detection.id,
      subjectLabel: this.label(detection),
      detail: `Exported the report in the FHIR hospital format (${bundle.entry.length} resources)`,
    });

    return bundle;
  }

  async remove(id: string, ownerId: string): Promise<boolean> {
    const detection = await this.findOne(id, ownerId);
    if (!detection) return false;

    const urls = storedImageUrls(detection);
    const keys = storedObjectKeys(detection);
    const label = this.label(detection);
    const detectionId = detection.id;

    await this.detectionRepository.remove(detection);
    await this.storage.remove(keys);
    // Files are gone, so their grants must go too. A grant left behind is a
    // row saying someone may read something that no longer exists, and the
    // next upload could be given the same name.
    await this.access.revoke('file', urls);

    await this.audit.record({
      actorId: ownerId,
      action: 'screening.deleted',
      subjectType: 'screening',
      subjectId: detectionId,
      subjectLabel: label,
      detail: 'Deleted the screening and its photographs',
    });
    return true;
  }

  async removeByPatient(patientId: string, ownerId: string): Promise<number> {
    const [detections] = await this.findByPatient(patientId, ownerId);
    if (detections.length === 0) return 0;

    const urls = detections.flatMap(storedImageUrls);
    const keys = detections.flatMap(storedObjectKeys);
    await this.detectionRepository.remove(detections);
    await this.storage.remove(keys);
    await this.access.revoke('file', urls);
    // Not logged per screening: these are removed because the patient was,
    // and the patient's own line already says how many went with them.
    return detections.length;
  }
}
