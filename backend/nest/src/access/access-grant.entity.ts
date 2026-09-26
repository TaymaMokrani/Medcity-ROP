import {
  Entity,
  Column,
  CreateDateColumn,
  PrimaryColumn,
  Index,
  JoinColumn,
  ManyToOne,
} from 'typeorm';
import { User } from '../users/user.entity';

/** What a grant is for. A stored file, or an analysis job in flight. */
export type GrantKind = 'file' | 'job';

/**
 * Who is allowed to read one thing.
 *
 * Every record in this app is scoped to the doctor who owns it, and the
 * routes that read records enforce that. Two things were not records and so
 * were not scoped: the stored files, and the severity jobs the analyser
 * holds in memory. A photograph had no owner anywhere, so the only way to
 * decide whether a request for it was allowed was to already know which
 * screening it belonged to — which the file route does not.
 *
 * A grant gives the file an owner of its own. The file route then answers
 * with one indexed lookup and needs to know nothing about screenings, and a
 * file with no grant is served to nobody, including its author. That is the
 * safe direction to fail in.
 *
 * `key` is the storage key for a file (`detections/<uuid>.jpg`)
 * and the job id for a job. Both are already unique.
 */
@Entity('access_grants')
export class AccessGrant {
  @PrimaryColumn('varchar')
  kind: GrantKind;

  @PrimaryColumn('text')
  key: string;

  @Index('IDX_access_grants_owner')
  @Column('uuid')
  ownerId: string;

  @ManyToOne(() => User, { onDelete: 'RESTRICT' })
  @JoinColumn({
    name: 'ownerId',
    foreignKeyConstraintName: 'FK_access_grants_owner',
  })
  owner?: User;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;
}
