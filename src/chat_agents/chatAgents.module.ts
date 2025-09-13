import { Module } from '@nestjs/common';
import { ChatAgentsController } from './chatAgents.controller';
import { SimpleChatAgentService, SimpleChatAgentProcessor } from './simpleChatAgent.service';
import { BullModule } from '@nestjs/bullmq';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Conversation } from 'src/chat_agents/entities/conversation.entity';
import { UserModule } from 'src/user/user.module';
import { ConversationService } from './coversation.service';

@Module({
  imports: [
    BullModule.registerQueue({
      name: 'chat_agents',
      defaultJobOptions: {
        removeOnComplete: true,
        removeOnFail: true,
      },
    }),
    TypeOrmModule.forFeature([Conversation]),
    UserModule,
  ],
  controllers: [ChatAgentsController],
  providers: [
    SimpleChatAgentService,
    SimpleChatAgentProcessor,
    ConversationService,
  ],
  exports: [
    SimpleChatAgentService,
    ConversationService,
  ],
})
export class ChatAgentsModule { }
