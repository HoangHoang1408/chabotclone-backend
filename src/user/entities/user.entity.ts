import { IsEmail, IsString } from 'class-validator';
import { Column, CreateDateColumn, Entity, OneToMany, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';
import { Conversation } from '../../chat_agents/entities/conversation.entity';

export enum UserRole {
  ADMIN = 'admin',
  USER = 'user',
}

@Entity()
export class User {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ unique: true })
  @IsEmail()
  email: string;

  @Column({ select: false })
  @IsString()
  password: string;

  @Column({ default: UserRole.USER })
  role: UserRole;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;

  @OneToMany(() => Conversation, (conversation) => conversation.user, { cascade: true, eager: false, onDelete: 'CASCADE' })
  conversations: Conversation[];
}
