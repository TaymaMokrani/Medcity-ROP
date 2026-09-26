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

@Entity('patients')
export class Patient {
  @PrimaryColumn()
  id: string;

  @Index()
  @Column('uuid')
  ownerId: string;

  @ManyToOne(() => User, { onDelete: 'RESTRICT' })
  @JoinColumn({
    name: 'ownerId',
    foreignKeyConstraintName: 'FK_patients_owner',
  })
  owner?: User;

  @Column()
  firstName: string;

  @Column()
  lastName: string;

  /** `date` in Postgres, read back as "YYYY-MM-DD". */
  @Column('date')
  dateOfBirth: string;

  @Column()
  gender: string;

  @Column('float')
  gestationalAge: number;

  @Column('float')
  birthWeight: number;

  @Column()
  motherName: string;

  @Column({ nullable: true })
  phone: string;

  @Column({ nullable: true })
  email: string;

  @Column({ nullable: true })
  address: string;

  @Column({ nullable: true })
  bloodType: string;

  @Column({ nullable: true, type: 'text' })
  notes: string;

  @Column()
  status: string;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;
}
