# Redis Streams LLM Bridge - Implementation Guide (Part 2)

## Stream Consumer Service

### Core Consumer Service
```typescript
@Injectable()
export class StreamConsumerService {
  private readonly consumers = new Map<string, StreamConsumer>();
  private readonly logger = new Logger(StreamConsumerService.name);

  constructor(
    private readonly redisService: RedisService,
    private readonly connectionManager: ConnectionManager,
    private readonly configService: ConfigService,
  ) {}

  async startConsumer(
    streamKey: string,
    consumerGroup: string,
    consumerName: string
  ): Promise<void> {
    const consumer = new StreamConsumer(
      streamKey,
      consumerGroup,
      consumerName,
      this.redisService,
      this.connectionManager,
      this.logger
    );

    this.consumers.set(`${streamKey}:${consumerGroup}:${consumerName}`, consumer);
    await consumer.start();
  }

  async stopConsumer(
    streamKey: string,
    consumerGroup: string,
    consumerName: string
  ): Promise<void> {
    const key = `${streamKey}:${consumerGroup}:${consumerName}`;
    const consumer = this.consumers.get(key);
    
    if (consumer) {
      await consumer.stop();
      this.consumers.delete(key);
    }
  }

  async getConsumerStatus(): Promise<ConsumerStatus[]> {
    return Array.from(this.consumers.values()).map(consumer => consumer.getStatus());
  }
}

class StreamConsumer {
  private isRunning = false;
  private pollInterval: NodeJS.Timeout;
  private readonly pollDelay = 100; // ms

  constructor(
    private readonly streamKey: string,
    private readonly consumerGroup: string,
    private readonly consumerName: string,
    private readonly redisService: RedisService,
    private readonly connectionManager: ConnectionManager,
    private readonly logger: Logger,
  ) {}

  async start(): Promise<void> {
    if (this.isRunning) return;

    try {
      await this.ensureConsumerGroup();
      this.isRunning = true;
      this.startPolling();
      this.logger.log(`Consumer ${this.consumerName} started for stream ${this.streamKey}`);
    } catch (error) {
      this.logger.error(`Failed to start consumer ${this.consumerName}:`, error);
      throw error;
    }
  }

  async stop(): Promise<void> {
    this.isRunning = false;
    if (this.pollInterval) {
      clearTimeout(this.pollInterval);
    }
    this.logger.log(`Consumer ${this.consumerName} stopped for stream ${this.streamKey}`);
  }

  private async ensureConsumerGroup(): Promise<void> {
    try {
      await this.redisService.xgroup('CREATE', this.streamKey, this.consumerGroup, '$', 'MKSTREAM');
    } catch (error) {
      if (!error.message.includes('BUSYGROUP')) {
        throw error;
      }
    }
  }

  private startPolling(): void {
    const poll = async () => {
      if (!this.isRunning) return;

      try {
        await this.processMessages();
      } catch (error) {
        this.logger.error(`Error processing messages in consumer ${this.consumerName}:`, error);
      }

      if (this.isRunning) {
        this.pollInterval = setTimeout(poll, this.pollDelay);
      }
    };

    poll();
  }

  private async processMessages(): Promise<void> {
    const messages = await this.redisService.xreadgroup(
      'GROUP',
      this.consumerGroup,
      this.consumerName,
      'COUNT',
      '10',
      'BLOCK',
      '1000',
      'STREAMS',
      this.streamKey,
      '>'
    );

    if (!messages || messages.length === 0) return;

    for (const [streamKey, streamMessages] of messages) {
      for (const [messageId, fields] of streamMessages) {
        try {
          const messageData = JSON.parse(fields.data);
          await this.deliverMessage(messageData);
          await this.acknowledgeMessage(messageId);
        } catch (error) {
          this.logger.error(`Failed to process message ${messageId}:`, error);
          // Could implement dead letter queue here
        }
      }
    }
  }

  private async deliverMessage(message: StreamMessage): Promise<void> {
    const connections = this.connectionManager.getConnectionsForSession(message.sessionId);
    
    for (const connection of connections) {
      try {
        await connection.send({
          type: 'token',
          data: message,
          timestamp: Date.now(),
        });
      } catch (error) {
        this.logger.error(`Failed to deliver message to connection ${connection.id}:`, error);
        // Mark connection as failed for cleanup
        this.connectionManager.markConnectionFailed(connection.id);
      }
    }
  }

  private async acknowledgeMessage(messageId: string): Promise<void> {
    await this.redisService.xack(this.streamKey, this.consumerGroup, messageId);
  }

  getStatus(): ConsumerStatus {
    return {
      streamKey: this.streamKey,
      consumerGroup: this.consumerGroup,
      consumerName: this.consumerName,
      isRunning: this.isRunning,
      lastActivity: new Date(),
    };
  }
}
```

## Connection Manager

### Client Connection Management
```typescript
@Injectable()
export class ConnectionManager {
  private readonly connections = new Map<string, ClientConnection>();
  private readonly sessionConnections = new Map<string, Set<string>>();
  private readonly logger = new Logger(ConnectionManager.name);

  async createConnection(
    sessionId: string,
    connectionType: 'sse' | 'websocket'
  ): Promise<ClientConnection> {
    const connection = new ClientConnection(sessionId, connectionType);
    
    this.connections.set(connection.id, connection);
    
    if (!this.sessionConnections.has(sessionId)) {
      this.sessionConnections.set(sessionId, new Set());
    }
    this.sessionConnections.get(sessionId)!.add(connection.id);

    this.logger.log(`Created ${connectionType} connection ${connection.id} for session ${sessionId}`);
    return connection;
  }

  removeConnection(connectionId: string): void {
    const connection = this.connections.get(connectionId);
    if (connection) {
      const sessionId = connection.sessionId;
      this.connections.delete(connectionId);
      
      const sessionConnections = this.sessionConnections.get(sessionId);
      if (sessionConnections) {
        sessionConnections.delete(connectionId);
        if (sessionConnections.size === 0) {
          this.sessionConnections.delete(sessionId);
        }
      }

      this.logger.log(`Removed connection ${connectionId} from session ${sessionId}`);
    }
  }

  getConnectionsForSession(sessionId: string): ClientConnection[] {
    const connectionIds = this.sessionConnections.get(sessionId);
    if (!connectionIds) return [];

    return Array.from(connectionIds)
      .map(id => this.connections.get(id))
      .filter(Boolean) as ClientConnection[];
  }

  markConnectionFailed(connectionId: string): void {
    const connection = this.connections.get(connectionId);
    if (connection) {
      connection.markFailed();
      // Schedule cleanup for failed connections
      setTimeout(() => this.removeConnection(connectionId), 5000);
    }
  }

  getConnectionStats(): ConnectionStats {
    const totalConnections = this.connections.size;
    const activeConnections = Array.from(this.connections.values())
      .filter(conn => conn.isActive()).length;
    
    const sessionCount = this.sessionConnections.size;
    
    return {
      totalConnections,
      activeConnections,
      sessionCount,
      timestamp: new Date(),
    };
  }
}

class ClientConnection {
  public readonly id: string;
  public readonly sessionId: string;
  public readonly connectionType: 'sse' | 'websocket';
  private failed = false;
  private lastActivity = Date.now();

  constructor(sessionId: string, connectionType: 'sse' | 'websocket') {
    this.id = `${connectionType}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    this.sessionId = sessionId;
    this.connectionType = connectionType;
  }

  async send(data: any): Promise<void> {
    if (this.failed) {
      throw new Error('Connection is marked as failed');
    }
    
    // Implementation would depend on the actual transport mechanism
    // This is a placeholder for the actual sending logic
    this.lastActivity = Date.now();
  }

  markFailed(): void {
    this.failed = true;
  }

  isActive(): boolean {
    return !this.failed && (Date.now() - this.lastActivity) < 300000; // 5 minutes
  }
}
```

## Stream Processor

### Data Processing and Transformation
```typescript
@Injectable()
export class StreamProcessor {
  private readonly processors = new Map<string, MessageProcessor>();
  private readonly logger = new Logger(StreamProcessor.name);

  constructor(
    private readonly configService: ConfigService,
  ) {
    this.initializeProcessors();
  }

  private initializeProcessors(): void {
    // Analytics processor
    this.processors.set('analytics', new AnalyticsProcessor());
    
    // Logging processor
    this.processors.set('logging', new LoggingProcessor());
    
    // Caching processor
    this.processors.set('caching', new CachingProcessor());
    
    // Rate limiting processor
    this.processors.set('rateLimit', new RateLimitProcessor());
  }

  async processMessage(message: StreamMessage): Promise<ProcessedMessage> {
    const processedMessage: ProcessedMessage = {
      ...message,
      processedAt: Date.now(),
      processingResults: {},
    };

    // Process through all registered processors
    for (const [name, processor] of this.processors) {
      try {
        const result = await processor.process(message);
        processedMessage.processingResults[name] = result;
      } catch (error) {
        this.logger.error(`Processor ${name} failed:`, error);
        processedMessage.processingResults[name] = { error: error.message };
      }
    }

    return processedMessage;
  }

  async getProcessorStats(): Promise<ProcessorStats[]> {
    return Array.from(this.processors.entries()).map(([name, processor]) => ({
      name,
      stats: processor.getStats(),
    }));
  }
}

interface MessageProcessor {
  process(message: StreamMessage): Promise<any>;
  getStats(): any;
}

class AnalyticsProcessor implements MessageProcessor {
  private messageCount = 0;
  private totalTokens = 0;

  async process(message: StreamMessage): Promise<AnalyticsResult> {
    this.messageCount++;
    this.totalTokens += message.token.length;

    return {
      messageCount: this.messageCount,
      totalTokens: this.totalTokens,
      averageTokensPerMessage: this.totalTokens / this.messageCount,
      sessionId: message.sessionId,
      modelId: message.modelId,
    };
  }

  getStats(): AnalyticsStats {
    return {
      messageCount: this.messageCount,
      totalTokens: this.totalTokens,
      averageTokensPerMessage: this.messageCount > 0 ? this.totalTokens / this.messageCount : 0,
    };
  }
}
```
