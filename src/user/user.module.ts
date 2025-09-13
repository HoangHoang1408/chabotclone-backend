import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { UserService } from './user.service';
import { User } from './entities/user.entity';
import { Conversation } from '../chat_agents/entities/conversation.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([User, Conversation])
  ],
  providers: [UserService],
  exports: [UserService]
})
export class UserModule { }
