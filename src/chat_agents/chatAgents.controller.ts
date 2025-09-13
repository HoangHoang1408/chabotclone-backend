// NestJS imports
import { Body, Controller, Get, Post, Query, Sse, BadRequestException, Logger } from '@nestjs/common';
import { CurrentUser } from 'src/iam/auth/decorators/current-user.decorator';
import { Roles } from 'src/iam/auth/guards/auth.guard';

// External dependencies
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';

// Local imports
import { User } from 'src/user/entities/user.entity';
import { ConversationService } from './coversation.service';
import { SimpleChatAgentInput } from './dto/simpleChatAgent.dto';
import { SimpleChatAgentService } from './simpleChatAgent.service';
import { StreamValidator, StreamErrorHandler } from './utils/stream-error.handler';

@Controller('chat-agents')
export class ChatAgentsController {
    private readonly logger = new Logger(ChatAgentsController.name);

    constructor(
        private readonly conversationService: ConversationService,
        private readonly simpleChatAgentService: SimpleChatAgentService,
    ) { }

    /**
     * Validate stream key parameter
     * @param streamKey Stream key to validate
     * @throws BadRequestException if streamKey is missing or invalid
     */
    private validateStreamKey(streamKey: string): void {
        if (!streamKey) {
            throw new BadRequestException('streamKey query parameter is required');
        }

        try {
            StreamValidator.validateStreamKey(streamKey);
        } catch (error) {
            throw StreamErrorHandler.toHttpException(error);
        }
    }
    /**
     * Create a new conversation for the current user
     * @param user Current authenticated user
     * @returns Created conversation details
     */
    @Roles()
    @Post('create-conversation')
    async createConversation(@CurrentUser() user: User) {
        return this.conversationService.createConversation(user);
    }

    /**
     * Start a new simple chat agent job
     * @param body Chat agent input parameters
     * @param user Current authenticated user
     * @returns Job details including jobId and streamKey
     */
    @Roles()
    @Post('create-simple-agent-job')
    async startSimpleAgent(@Body() body: SimpleChatAgentInput, @CurrentUser() user: User) {
        return this.simpleChatAgentService.startAgentJob(body, user);
    }

    /**
     * Get detailed information about a Redis stream
     * @param streamKey Redis stream key
     * @returns Stream information including message count, TTL, etc.
     */
    @Roles()
    @Get('stream-info')
    async getStreamInfo(@Query('streamKey') streamKey: string) {
        this.validateStreamKey(streamKey);
        return this.simpleChatAgentService.getStreamInfo(streamKey);
    }

    /**
     * Stream chat agent responses via Server-Sent Events
     * @param streamKey Redis stream key for the conversation
     * @returns Observable stream of chat messages
     */
    @Roles()
    @Sse('stream')
    async streamAgent(@Query('streamKey') streamKey: string): Promise<Observable<any>> {
        this.validateStreamKey(streamKey);

        // Validate that the stream exists and has data before allowing connection
        const streamValidation = await this.simpleChatAgentService.checkStreamExists(streamKey);

        try {
            StreamValidator.validateStreamData(streamValidation.exists, streamValidation.messageCount, streamKey);
        } catch (error) {
            throw StreamErrorHandler.toHttpException(error);
        }

        this.logger.log(`Client connecting to stream ${streamKey} with ${streamValidation.messageCount} existing messages`);

        const stream = await this.simpleChatAgentService.getStream(streamKey);

        return stream.pipe(
            map((data: any) => ({
                type: 'message',
                data: JSON.stringify(data),
                id: data.id,
                retry: 3000,
            }))
        );
    }
}
