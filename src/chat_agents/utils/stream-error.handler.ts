import { BadRequestException, InternalServerErrorException } from '@nestjs/common';
import { StreamErrorType } from '../types/stream.types';

/**
 * Custom error class for stream-related errors
 */
export class StreamError extends Error {
    constructor(
        public readonly type: StreamErrorType,
        message: string,
        public readonly streamKey?: string
    ) {
        super(message);
        this.name = 'StreamError';
    }
}

/**
 * Utility class for handling stream errors
 */
export class StreamErrorHandler {
    /**
     * Create appropriate error based on Redis error message
     * @param error Original error from Redis
     * @param streamKey Stream key that caused the error
     * @returns Appropriate StreamError
     */
    static createFromRedisError(error: Error, streamKey: string): StreamError {
        if (error.message.includes('WRONGTYPE')) {
            return new StreamError(
                StreamErrorType.INVALID_TYPE,
                'Key exists but is not a valid Redis stream',
                streamKey
            );
        }

        if (error.message.includes('Connection') || error.message.includes('ECONNREFUSED')) {
            return new StreamError(
                StreamErrorType.CONNECTION_ERROR,
                'Redis connection error',
                streamKey
            );
        }

        return new StreamError(
            StreamErrorType.NOT_FOUND,
            'Stream not found',
            streamKey
        );
    }

    /**
     * Convert StreamError to appropriate HTTP exception
     * @param error StreamError to convert
     * @returns HTTP exception
     */
    static toHttpException(error: StreamError): BadRequestException | InternalServerErrorException {
        switch (error.type) {
            case StreamErrorType.NOT_FOUND:
            case StreamErrorType.EMPTY:
            case StreamErrorType.INVALID_TYPE:
                return new BadRequestException(error.message);

            case StreamErrorType.CONNECTION_ERROR:
            case StreamErrorType.TIMEOUT:
                return new InternalServerErrorException(error.message);

            default:
                return new InternalServerErrorException('Unknown stream error');
        }
    }

    /**
     * Check if error is retryable
     * @param error StreamError to check
     * @returns true if error is retryable
     */
    static isRetryable(error: StreamError): boolean {
        return error.type === StreamErrorType.CONNECTION_ERROR;
    }

    /**
     * Get error details for logging
     * @param error StreamError
     * @returns Object with error details
     */
    static getErrorDetails(error: StreamError): {
        type: StreamErrorType;
        message: string;
        streamKey?: string;
        retryable: boolean;
    } {
        return {
            type: error.type,
            message: error.message,
            streamKey: error.streamKey,
            retryable: this.isRetryable(error),
        };
    }
}

/**
 * Utility functions for stream validation
 */
export class StreamValidator {
    /**
     * Validate stream key format
     * @param streamKey Stream key to validate
     * @throws StreamError if invalid
     */
    static validateStreamKey(streamKey: string): void {
        if (!streamKey) {
            throw new StreamError(
                StreamErrorType.INVALID_TYPE,
                'Stream key is required'
            );
        }

        // Check if stream key follows expected format: llm:stream:conversationId:model:jobId
        const keyPattern = /^llm:stream:\d+:[a-zA-Z0-9\-_.]+:[a-zA-Z0-9_]+$/;
        if (!keyPattern.test(streamKey)) {
            throw new StreamError(
                StreamErrorType.INVALID_TYPE,
                'Invalid stream key format',
                streamKey
            );
        }
    }

    /**
     * Validate stream exists and has data
     * @param exists Whether stream exists
     * @param messageCount Number of messages in stream
     * @param streamKey Stream key
     * @throws StreamError if invalid
     */
    static validateStreamData(exists: boolean, messageCount: number, streamKey: string): void {
        if (!exists) {
            throw new StreamError(
                StreamErrorType.NOT_FOUND,
                'Stream not found',
                streamKey
            );
        }

        if (messageCount === 0) {
            throw new StreamError(
                StreamErrorType.EMPTY,
                'Stream exists but has no data',
                streamKey
            );
        }
    }
}
