import { Entity, Column, PrimaryColumn, Index } from 'typeorm';

@Entity('patients')
export class Patient {
  @PrimaryColumn()
  id: string;

  @Index()
  @Column()
  ownerId: string;

  @Column()
  firstName: string;

  @Column()
  lastName: string;

  @Column()
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

  @Column()
  createdAt: string;
}
