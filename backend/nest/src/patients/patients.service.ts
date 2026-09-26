import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Patient } from './patient.entity';
import { CreatePatientDto } from './dto/create-patient.dto';
import { UpdatePatientDto } from './dto/update-patient.dto';
import { generateId } from '../common/id';
import { applyChanges } from '../common/apply-changes';
import { DetectionsService } from '../detections/detections.service';
import { AuditService } from '../audit/audit.service';

@Injectable()
export class PatientsService {
  constructor(
    @InjectRepository(Patient)
    private readonly patientRepository: Repository<Patient>,
    private readonly detectionsService: DetectionsService,
    private readonly audit: AuditService,
  ) {}

  private static label(patient: Patient): string {
    return `${patient.firstName} ${patient.lastName}`.trim();
  }

  async findAll(ownerId: string): Promise<Patient[]> {
    return this.patientRepository.find({
      where: { ownerId },
      order: { createdAt: 'DESC' },
    });
  }

  async findOne(id: string, ownerId: string): Promise<Patient | null> {
    return this.patientRepository.findOneBy({ id, ownerId });
  }

  async create(dto: CreatePatientDto, ownerId: string): Promise<Patient> {
    const patient = this.patientRepository.create({
      ...dto,
      // The column has always been NOT NULL, and a baby can reach the unit
      // before the mother is identified. Blank rather than refused.
      motherName: dto.motherName ?? '',
      status: dto.status ?? 'Active',
      id: generateId('PAT'),
      ownerId,
      createdAt: new Date().toISOString().split('T')[0],
    });
    const saved = await this.patientRepository.save(patient);

    await this.audit.record({
      actorId: ownerId,
      action: 'patient.created',
      subjectType: 'patient',
      subjectId: saved.id,
      subjectLabel: PatientsService.label(saved),
      detail: `Added a patient born at ${saved.gestationalAge} weeks, ${saved.birthWeight} g`,
    });
    return saved;
  }

  async update(
    id: string,
    dto: UpdatePatientDto,
    ownerId: string,
  ): Promise<Patient | null> {
    const patient = await this.findOne(id, ownerId);
    if (!patient) return null;

    // Which fields the request actually carried, not which values differ. A
    // doctor who retypes the same number has still edited the record, and a
    // log that hides that cannot be used to explain what they were looking at.
    const edited = Object.keys(dto);
    applyChanges(patient, dto);
    const saved = await this.patientRepository.save(patient);

    if (edited.length) {
      await this.audit.record({
        actorId: ownerId,
        action: 'patient.updated',
        subjectType: 'patient',
        subjectId: saved.id,
        subjectLabel: PatientsService.label(saved),
        detail: `Edited ${edited.join(', ')}`,
      });
    }
    return saved;
  }

  async remove(id: string, ownerId: string): Promise<boolean> {
    const patient = await this.findOne(id, ownerId);
    if (!patient) return false;

    const label = PatientsService.label(patient);
    const patientId = patient.id;

    const removed = await this.detectionsService.removeByPatient(id, ownerId);
    await this.patientRepository.remove(patient);

    await this.audit.record({
      actorId: ownerId,
      action: 'patient.deleted',
      subjectType: 'patient',
      subjectId: patientId,
      subjectLabel: label,
      detail:
        removed === 0
          ? 'Deleted the patient'
          : `Deleted the patient and ${removed} screening${removed === 1 ? '' : 's'}`,
    });
    return true;
  }
}
