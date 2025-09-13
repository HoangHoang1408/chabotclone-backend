# Redis Streams LLM Bridge - Implementation Guide

## Table of Contents
1. [Core Interfaces and Types](#core-interfaces-and-types)
2. [Stream Producer Service](#stream-producer-service)
3. [Stream Consumer Service](#stream-consumer-service)
4. [Connection Manager](#connection-manager)
5. [Stream Processor](#stream-processor)
6. [Health Monitor](#health-monitor)
7. [Module Configuration](#module-configuration)
8. [Usage Examples](#usage-examples)

## Core Interfaces and Types

### Stream Message Structure
```typescript
interface StreamMessage {
  id: string;
  sessionId: string;
  modelId: string;
  token: string;
  metadata: {
    timestamp: number;
    sequence: number;
    isComplete: boolean;
    model: string;
    temperature?: number;
    maxTokens?: number;
  };
  payload: {
    content: string;
    role: 'assistant' | 'user' | 'system';
    finishReason?: string;
  };
}

interface StreamConfig {
  streamKey: string;
  maxLength: number;
  retentionMs: number;
  consumerGroup: string;
  consumerName: string;
}
```

### Stream Operations Interface
```typescript
interface IStreamOperations {
  // Producer operations
  addMessage(streamKey: string, message: StreamMessage): Promise<string>;
  createStream(streamKey: string, config: StreamConfig): Promise<void>;
  
  // Consumer operations
  readMessages(streamKey: string, consumerGroup: string, count?: number): Promise<StreamMessage[]>;
  acknowledgeMessage(streamKey: string, consumerGroup: string, messageId: string): Promise<void>;
  createConsumerGroup(streamKey: string, groupName: string): Promise<void>;
  
  // Stream management
  getStreamInfo(streamKey: string): Promise<any>;
  trimStream(streamKey: string, maxLength: number): Promise<void>;
  deleteStream(streamKey: string): Promise<void>;
}
```

## Stream Producer Service

### Core Producer Service
```typescript
@Injectable()
export class StreamProducerService {
  constructor(
    private readonly redisService: RedisService,
    private readonly logger: Logger,
    private readonly configService: ConfigService,
  ) {}

  async produceToken(
    sessionId: string,
    modelId: string,
    token: string,
    metadata: Partial<StreamMessage['metadata']> = {}
  ): Promise<string> {
    const streamKey = this.generateStreamKey(sessionId, modelId);
    const message: StreamMessage = {
      id: this.generateMessageId(),
      sessionId,
      modelId,
      token,
      metadata: {
        timestamp: Date.now(),
        sequence: await this.getNextSequence(streamKey),
        isComplete: false,
        model: modelId,
        ...metadata,
      },
      payload: {
        content: token,
        role: 'assistant',
      },
    };

    try {
      const messageId = await this.redisService.xadd(
        streamKey,
        '*',
        'data',
        JSON.stringify(message)
      );
      
      this.logger.debug(`Produced token to stream ${streamKey}: ${messageId}`);
      return messageId;
    } catch (error) {
      this.logger.error(`Failed to produce token to stream ${streamKey}:`, error);
      throw new StreamProducerError(`Failed to produce token: ${error.message}`);
    }
  }

  async markStreamComplete(
    sessionId: string,
    modelId: string,
    finishReason: string = 'stop'
  ): Promise<void> {
    const streamKey = this.generateStreamKey(sessionId, modelId);
    const message: StreamMessage = {
      id: this.generateMessageId(),
      sessionId,
      modelId,
      token: '',
      metadata: {
        timestamp: Date.now(),
        sequence: await this.getNextSequence(streamKey),
        isComplete: true,
        model: modelId,
      },
      payload: {
        content: '',
        role: 'assistant',
        finishReason,
      },
    };

    await this.redisService.xadd(
      streamKey,
      '*',
      'data',
      JSON.stringify(message)
    );
  }

  private generateStreamKey(sessionId: string, modelId: string): string {
    return `llm:stream:${sessionId}:${modelId}`;
  }

  private generateMessageId(): string {
    return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  private async getNextSequence(streamKey: string): Promise<number> {
    const info = await this.redisService.xinfo('STREAM', streamKey);
    return (info.length || 0) + 1;
  }
}
```
