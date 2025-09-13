import { SUPPORTED_MODELS } from '../constants/models.constant';

/**
 * Interface for chat agent job data
 */
export interface ChatAgentJob {
    conversationId: number;
    message: string;
    model: SUPPORTED_MODELS;
    userId: number;
    jobId: string;
}

/**
 * Result of stream validation check
 */
export interface StreamValidationResult {
    exists: boolean;
    messageCount: number;
    error?: string;
}

/**
 * Detailed information about a Redis stream
 */
export interface StreamInfo {
    exists: boolean;
    messageCount: number;
    ttl: number;
    lastMessageId?: string;
    lastMessageData?: any;
    error?: string;
}

/**
 * Individual message in a stream
 */
export interface StreamMessage {
    id: string;
    data: any;
    timestamp: number;
}

/**
 * Stream configuration constants
 */
export const STREAM_CONFIG = {
    POLL_INTERVAL: 50,
    BLOCK_TIME: 100,
    REDIS_RETRY_DELAY: 1000,
} as const;

/**
 * Error types for stream operations
 */
export enum StreamErrorType {
    NOT_FOUND = 'NOT_FOUND',
    EMPTY = 'EMPTY',
    INVALID_TYPE = 'INVALID_TYPE',
    CONNECTION_ERROR = 'CONNECTION_ERROR',
    TIMEOUT = 'TIMEOUT',
}

/**
 * Stream metadata for completion tracking
 */
export interface StreamMetadata {
    isComplete?: boolean;
    completedAt?: string;
    jobId?: string;
    error?: boolean;
}

/**
 * Stream completion data structure
 */
export interface StreamCompletionData {
    metadata: StreamMetadata;
    type: 'completion' | 'error';
    message: string;
}
