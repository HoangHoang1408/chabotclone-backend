import { Column, Entity, ManyToOne, OneToMany, PrimaryGeneratedColumn, UpdateDateColumn, CreateDateColumn } from "typeorm";
import { User } from "../../user/entities/user.entity";

@Entity()
export class Conversation {
    @PrimaryGeneratedColumn()
    id: number;

    @Column({ type: 'varchar', nullable: true })
    title: string | null;

    @ManyToOne(() => User, (user) => user.conversations)
    user: User;

    @Column()
    userId: number;

    @Column()
    langGraphThreadId: string;

    @CreateDateColumn()
    createdAt: Date;

    @UpdateDateColumn()
    updatedAt: Date;
}