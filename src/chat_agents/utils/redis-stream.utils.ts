import { Redis } from 'ioredis';
import { SUPPORTED_MODELS } from '../constants/models.constant';
import { StreamInfo, StreamValidationResult, STREAM_CONFIG } from '../types/stream.types';
import { StreamError, StreamErrorHandler } from './stream-error.handler';

/**
 * Utility class for Redis stream operations
 */
export class RedisStreamUtils {
    /**
     * Generate a unique job ID
     * @returns Unique job identifier
     */
    static generateJobId(): string {
        return `job_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
    }

    /**
     * Generate a Redis stream key
     * @param conversationId Conversation ID
     * @param model Model being used
     * @param jobId Job ID
     * @returns Redis stream key
     */
    static generateStreamKey(conversationId: number, model: SUPPORTED_MODELS, jobId: string): string {
        return `llm:stream:${conversationId}:${model}:${jobId}`;
    }

    /**
     * Parse Redis stream fields into an object
     * @param fields Redis stream fields array
     * @returns Parsed data object
     */
    static parseRedisFields(fields: string[]): Record<string, string> {
        const data: Record<string, string> = {};
        for (let i = 0; i < fields.length; i += 2) {
            data[fields[i]] = fields[i + 1];
        }
        return data;
    }

    /**
     * Safely parse JSON data with fallback
     * @param data Data to parse
     * @param logger Optional logger for warnings
     * @returns Parsed data or original data if parsing fails
     */
    static safeJsonParse(data: any, logger?: { warn: (message: string) => void }): any {
        try {
            return data['data'] ? JSON.parse(data['data']) : data;
        } catch (error) {
            if (logger) {
                logger.warn(`Failed to parse JSON data: ${error.message}`);
            }
            return data;
        }
    }

    /**
     * Check if a Redis stream exists and has data
     * @param redis Redis instance
     * @param streamKey Stream key to check
     * @returns Stream validation result
     */
    static async checkStreamExists(redis: Redis, streamKey: string): Promise<StreamValidationResult> {
        try {
            const length = await redis.xlen(streamKey);

            if (length === 0) {
                return {
                    exists: true,
                    messageCount: 0,
                    error: 'Stream exists but has no messages'
                };
            }

            return {
                exists: true,
                messageCount: length
            };
        } catch (error) {
            const streamError = StreamErrorHandler.createFromRedisError(error, streamKey);
            return {
                exists: false,
                messageCount: 0,
                error: streamError.message
            };
        }
    }

    /**
     * Get detailed information about a Redis stream
     * @param redis Redis instance
     * @param streamKey Stream key to get info for
     * @param logger Optional logger for warnings
     * @returns Stream information
     */
    static async getStreamInfo(
        redis: Redis,
        streamKey: string,
        logger?: { warn: (message: string) => void }
    ): Promise<StreamInfo> {
        try {
            const [length, ttl, lastMessage] = await Promise.all([
                redis.xlen(streamKey),
                redis.ttl(streamKey),
                redis.xrevrange(streamKey, '+', '-', 'COUNT', 1)
            ]);

            let lastMessageId: string | undefined;
            let lastMessageData: any | undefined;

            if (lastMessage && lastMessage.length > 0) {
                const [messageId, fields] = lastMessage[0];
                lastMessageId = messageId;

                // Parse the last message data using utility method
                const data = this.parseRedisFields(fields);
                lastMessageData = this.safeJsonParse(data, logger);
            }

            return {
                exists: true,
                messageCount: length,
                ttl: ttl > 0 ? ttl : -1, // -1 means no TTL set
                lastMessageId,
                lastMessageData
            };
        } catch (error) {
            const streamError = StreamErrorHandler.createFromRedisError(error, streamKey);
            return {
                exists: false,
                messageCount: 0,
                ttl: -1,
                error: streamError.message
            };
        }
    }

    /**
     * Set TTL for a Redis stream
     * @param redis Redis instance
     * @param streamKey Stream key
     * @param ttl TTL in seconds
     */
    static async setStreamTTL(redis: Redis, streamKey: string, ttl: number): Promise<void> {
        await redis.expire(streamKey, ttl);
    }

    /**
     * Add data to Redis stream
     * @param redis Redis instance
     * @param streamKey Stream key
     * @param data Data to add
     */
    static async addToStream(redis: Redis, streamKey: string, data: any): Promise<void> {
        await redis.xadd(
            streamKey,
            '*',
            'data', JSON.stringify(data)
        );
    }

    /**
     * Read messages from Redis stream
     * @param redis Redis instance
     * @param streamKey Stream key
     * @param lastId Last message ID
     * @param blockTime Block time in milliseconds
     * @returns Array of messages or null
     */
    static async readFromStream(
        redis: Redis,
        streamKey: string,
        lastId: string,
        blockTime: number = STREAM_CONFIG.BLOCK_TIME
    ): Promise<any[] | null> {
        const result = await redis.xread(
            'BLOCK', blockTime,
            'STREAMS', streamKey, lastId
        );

        if (result && result.length > 0) {
            const [, messages] = result[0];
            return messages;
        }

        return null;
    }
}
