// NestJS imports
import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { InjectRedis } from '@nestjs-modules/ioredis';

// External dependencies
import { Observable } from 'rxjs';
import { Repository } from 'typeorm';
import { Job, Queue } from 'bullmq';
import { Redis } from 'ioredis';

// LangChain imports
import { ChatOpenAI } from '@langchain/openai';
import { createReactAgent } from '@langchain/langgraph/prebuilt';
import { BraveSearch } from '@langchain/community/tools/brave_search';
import { HumanMessage } from '@langchain/core/messages';
import { RunnableConfig } from '@langchain/core/runnables';

// Local imports
import { SimpleChatAgentInput } from './dto/simpleChatAgent.dto';
import { User } from 'src/user/entities/user.entity';
import { Conversation } from 'src/chat_agents/entities/conversation.entity';
import { SUPPORTED_MODELS } from './constants/models.constant';
import { ConversationService } from './coversation.service';
import {
    ChatAgentJob,
    StreamValidationResult,
    StreamInfo,
    StreamMessage,
    STREAM_CONFIG,
    StreamCompletionData,
} from './types/stream.types';
import { RedisStreamUtils } from './utils/redis-stream.utils';
import { StreamValidator } from './utils/stream-error.handler';



@Injectable()
export class SimpleChatAgentService {
    private readonly logger = new Logger(SimpleChatAgentService.name);

    constructor(
        @InjectQueue('chat_agents')
        private readonly chatAgentQueue: Queue,
        @InjectRepository(Conversation)
        private readonly conversationRepository: Repository<Conversation>,
        @InjectRedis() private readonly redis: Redis,
        private readonly configService: ConfigService,
    ) { }



    /**
     * Start a new chat agent job and return the job ID and stream key
     * @param input Chat agent input parameters
     * @param user Current user
     * @returns Object containing jobId and streamKey
     */
    async startAgentJob(input: SimpleChatAgentInput, user: User): Promise<{ jobId: string; streamKey: string }> {
        const { conversationId, message, model } = input;

        // Validate model support
        if (!Object.values(SUPPORTED_MODELS).includes(model)) {
            throw new BadRequestException('Model not supported');
        }

        // Validate user access to conversation
        const conversation = await this.conversationRepository.findOne({
            where: { id: conversationId, userId: user.id },
        });

        if (!conversation) {
            throw new BadRequestException('You are not allowed to access this conversation');
        }

        // Generate unique identifiers
        const jobId = RedisStreamUtils.generateJobId();
        const streamKey = RedisStreamUtils.generateStreamKey(conversationId, model, jobId);

        // Configure stream TTL
        const streamTtl = this.configService.get('stream.ttl');
        await this.redis.expire(streamKey, streamTtl);

        // Queue the job
        await this.chatAgentQueue.add('chat_agent', {
            conversationId,
            message,
            model,
            userId: user.id,
            jobId
        }, {
            jobId,
            removeOnComplete: true,
            removeOnFail: true,
        });

        this.logger.log(`Job queued: ${jobId} for conversation: ${conversationId} with TTL: ${streamTtl}s`);

        return { jobId, streamKey };
    }

    /**
     * Check if a Redis stream exists and has data
     * @param streamKey The Redis stream key to check
     * @returns Object with exists status and message count
     */
    async checkStreamExists(streamKey: string): Promise<StreamValidationResult> {
        StreamValidator.validateStreamKey(streamKey);
        return RedisStreamUtils.checkStreamExists(this.redis, streamKey);
    }

    /**
     * Get detailed information about a Redis stream
     * @param streamKey The Redis stream key to get info for
     * @returns Object with stream details
     */
    async getStreamInfo(streamKey: string): Promise<StreamInfo> {
        StreamValidator.validateStreamKey(streamKey);
        return RedisStreamUtils.getStreamInfo(this.redis, streamKey, this.logger);
    }

    async getStream(streamKey: string): Promise<Observable<any>> {
        return new Observable((observer) => {
            let lastId = '0';
            let isActive = true;
            let pollInterval: NodeJS.Timeout;
            let emptyPollCount = 0;

            // Get max idle time from config
            const maxIdleTime = this.configService.get('stream.maxIdleTime');
            const maxEmptyPolls = (maxIdleTime * 1000) / 100; // Convert to poll cycles

            const pollForMessages = async () => {
                try {
                    if (!isActive) return;

                    // Read new messages from the stream using XREAD with BLOCK
                    const result = await this.redis.xread(
                        'BLOCK', STREAM_CONFIG.BLOCK_TIME,
                        'STREAMS', streamKey, lastId
                    );

                    if (result && result.length > 0) {
                        const [, messages] = result[0];
                        emptyPollCount = 0; // Reset empty poll counter

                        for (const [messageId, fields] of messages) {
                            if (!isActive) break;

                            // Parse Redis fields and data using utility methods
                            const data = RedisStreamUtils.parseRedisFields(fields);
                            const parsedData = RedisStreamUtils.safeJsonParse(data, this.logger);

                            // Emit the message
                            const streamMessage: StreamMessage = {
                                id: messageId,
                                data: parsedData,
                                timestamp: Date.now()
                            };
                            observer.next(streamMessage);

                            lastId = messageId;

                            // Check if this is a completion message
                            if (parsedData.metadata?.isComplete) {
                                this.logger.debug(`Stream ${streamKey} marked as complete`);
                                observer.complete();
                                return;
                            }
                        }
                    } else {
                        // Increment empty poll counter
                        emptyPollCount++;

                        // Check for timeout
                        if (emptyPollCount >= maxEmptyPolls) {
                            this.logger.warn(`Stream ${streamKey} timed out after ${maxIdleTime} seconds`);
                            observer.error(new Error(`Stream timeout: No data received for ${maxIdleTime} seconds`));
                            return;
                        }
                    }

                    // Continue polling
                    if (isActive) {
                        pollInterval = setTimeout(pollForMessages, STREAM_CONFIG.POLL_INTERVAL);
                    }
                } catch (error) {
                    this.logger.error(`Error reading from stream ${streamKey}:`, error);

                    // If Redis is unavailable, retry with exponential backoff
                    if (error.message.includes('Connection is closed') ||
                        error.message.includes('ECONNREFUSED')) {
                        if (isActive) {
                            pollInterval = setTimeout(pollForMessages, STREAM_CONFIG.REDIS_RETRY_DELAY);
                        }
                    } else {
                        observer.error(error);
                    }
                }
            };

            const checkStreamExists = async () => {
                try {
                    // Check if stream exists and get its length
                    const length = await this.redis.xlen(streamKey);
                    this.logger.debug(`Stream ${streamKey} exists with ${length} messages`);

                    // Start polling for new messages
                    pollForMessages();
                } catch (error) {
                    this.logger.error(`Stream ${streamKey} does not exist or error occurred:`, error);
                    observer.error(new Error(`Stream ${streamKey} not found or inaccessible`));
                }
            };

            // Start the polling process
            checkStreamExists();

            // Cleanup function
            return () => {
                this.logger.debug(`Cleaning up stream subscription for ${streamKey}`);
                isActive = false;
                if (pollInterval) {
                    clearTimeout(pollInterval);
                }
            };
        });
    }
}

@Injectable()
@Processor('chat_agents', {
    concurrency: 100,
})
export class SimpleChatAgentProcessor extends WorkerHost {
    private readonly logger = new Logger(SimpleChatAgentProcessor.name);
    private braveSearchTool: BraveSearch;

    constructor(
        @InjectRepository(Conversation)
        private readonly conversationRepository: Repository<Conversation>,
        @InjectRedis() private readonly redis: Redis,
        private readonly configService: ConfigService,
        private readonly conversationService: ConversationService,
    ) {
        super();
    }
    async onModuleInit() {
        // Initialize BraveSearch tool with API key
        const braveApiKey = this.configService.get('brave.apiKey');
        if (!braveApiKey) {
            throw new Error('BRAVE_SEARCH_API_KEY is required for search functionality');
        }

        this.braveSearchTool = new BraveSearch({ apiKey: braveApiKey, });
    }

    async process(job: Job<ChatAgentJob>): Promise<void> {
        const { conversationId, model, message, jobId } = job.data;
        const conversation = await this.conversationRepository.findOne({
            where: { id: conversationId },
        });
        if (!conversation) {
            throw new Error(`Conversation ${conversationId} not found`);
        }

        this.logger.log(`Processing job ${jobId} for conversation ${conversationId}`);

        // Use BraveSearch as the primary search tool
        const tools = [this.braveSearchTool];
        this.logger.debug(`Using BraveSearch for job ${jobId}`);

        const agent = createReactAgent({
            llm: new ChatOpenAI({
                apiKey: this.configService.get('OPENAI_API_KEY'),
                model,
                temperature: 0.1,
                streaming: true
            }),
            tools,
            checkpointSaver: this.conversationService.postgreSaver,
        });

        const config: RunnableConfig = {
            configurable: {
                thread_id: conversation.langGraphThreadId
            },
        };

        // Generate stream key for this job
        const streamKey = `llm:stream:${conversationId}:${model}:${jobId}`;
        const stream = await agent.stream({ messages: [new HumanMessage(message)] }, { ...config, streamMode: ["messages"] });

        try {
            // Get TTL from config
            const streamTtl = this.configService.get('stream.ttl');

            for await (const chunk of stream) {
                await this.redis.xadd(
                    streamKey,
                    '*',
                    'data', JSON.stringify(chunk)
                );

                // Refresh TTL on each message to keep active streams alive
                await this.redis.expire(streamKey, streamTtl);
            }

            // Send completion signal after streaming finishes
            const completionData: StreamCompletionData = {
                metadata: {
                    isComplete: true,
                    completedAt: new Date().toISOString(),
                    jobId: jobId
                },
                type: 'completion',
                message: 'Stream completed successfully'
            };

            await this.redis.xadd(
                streamKey,
                '*',
                'data', JSON.stringify(completionData)
            );

            this.logger.log(`Job ${jobId} completed successfully for conversation ${conversationId}`);

            // Let Redis TTL handle automatic cleanup - no need for setTimeout

        } catch (error) {
            this.logger.error(`Error processing job ${jobId}:`, error);

            // Send error completion signal
            const errorData: StreamCompletionData = {
                metadata: {
                    isComplete: true,
                    completedAt: new Date().toISOString(),
                    jobId: jobId,
                    error: true
                },
                type: 'error',
                message: error.message || 'An error occurred during processing'
            };

            await this.redis.xadd(
                streamKey,
                '*',
                'data', JSON.stringify(errorData)
            );

            // Set shorter TTL for failed streams
            const errorTtl = this.configService.get('stream.errorTtl');
            await this.redis.expire(streamKey, errorTtl);

            throw error;
        }
    }

}