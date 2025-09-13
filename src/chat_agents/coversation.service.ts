import { Injectable } from "@nestjs/common";

import { Conversation } from "./entities/conversation.entity";

import { Repository } from "typeorm";
import { InjectRepository } from "@nestjs/typeorm";
import { ConfigService } from "@nestjs/config";
import { PostgresSaver } from "@langchain/langgraph-checkpoint-postgres";
import { User } from "src/user/entities/user.entity";
import { v4 as uuidv4 } from 'uuid';
import { CreateConversationOutput } from "./dto/conversation.dto";

@Injectable()
export class ConversationService {

    postgreSaver: PostgresSaver;

    constructor(
        @InjectRepository(Conversation)
        private readonly conversationRepository: Repository<Conversation>,
        private readonly configService: ConfigService,
    ) { }

    async onModuleInit() {
        const userName = this.configService.get('database.username');
        const password = this.configService.get('database.password');
        const host = this.configService.get('database.host');
        const port = this.configService.get('database.port');
        const database = this.configService.get('database.database');
        const connectionString = `postgresql://${userName}:${password}@${host}:${port}/${database}`;
        this.postgreSaver = PostgresSaver.fromConnString(connectionString, {
            schema: "public"
        });
        await this.postgreSaver.setup();
    }
    async createConversation(user: User): Promise<CreateConversationOutput> {
        const conversation = this.conversationRepository.create({
            user,
            userId: user.id,
            langGraphThreadId: uuidv4().toString()
        });
        await this.conversationRepository.save(conversation);
        return {
            conversationId: conversation.id,
        }
    }

}