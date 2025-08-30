import { ChatOpenAI } from '@langchain/openai';
import { Injectable } from '@nestjs/common';
import { MemorySaver } from '@langchain/langgraph-checkpoint';

@Injectable()
export class SimpleChatAgentService {
    getHello(): string {
        const llm = new ChatOpenAI({ model: 'gpt-4o-mini' });
        const checkpointer = new MemorySaver();
        
        return 'Hello World!';
    }
}
