# Redis Streams LLM Bridge - Implementation Guide (Part 3)

## Health Monitor

### Stream Health Monitoring
```typescript
@Injectable()
export class StreamHealthMonitor {
  private readonly healthChecks = new Map<string, HealthCheck>();
  private readonly logger = new Logger(StreamHealthMonitor.name);
  private readonly metrics = new StreamMetrics();

  constructor(
    private readonly redisService: RedisService,
    private readonly consumerService: StreamConsumerService,
    private readonly connectionManager: ConnectionManager,
  ) {
    this.initializeHealthChecks();
  }

  private initializeHealthChecks(): void {
    // Redis connection health
    this.healthChecks.set('redis', new RedisHealthCheck(this.redisService));
    
    // Stream consumer health
    this.healthChecks.set('consumers', new ConsumerHealthCheck(this.consumerService));
    
    // Connection manager health
    this.healthChecks.set('connections', new ConnectionHealthCheck(this.connectionManager));
    
    // Stream performance health
    this.healthChecks.set('performance', new PerformanceHealthCheck(this.metrics));
  }

  async performHealthCheck(): Promise<HealthStatus> {
    const results = new Map<string, HealthCheckResult>();
    const overallStatus: HealthStatus = {
      status: 'healthy',
      timestamp: new Date(),
      checks: results,
      summary: {
        total: this.healthChecks.size,
        healthy: 0,
        unhealthy: 0,
        degraded: 0,
      },
    };

    for (const [name, check] of this.healthChecks) {
      try {
        const result = await check.check();
        results.set(name, result);
        
        switch (result.status) {
          case 'healthy':
            overallStatus.summary.healthy++;
            break;
          case 'degraded':
            overallStatus.summary.degraded++;
            overallStatus.status = overallStatus.status === 'healthy' ? 'degraded' : overallStatus.status;
            break;
          case 'unhealthy':
            overallStatus.summary.unhealthy++;
            overallStatus.status = 'unhealthy';
            break;
        }
      } catch (error) {
        this.logger.error(`Health check ${name} failed:`, error);
        results.set(name, {
          status: 'unhealthy',
          message: error.message,
          timestamp: new Date(),
        });
        overallStatus.summary.unhealthy++;
        overallStatus.status = 'unhealthy';
      }
    }

    return overallStatus;
  }

  async getMetrics(): Promise<StreamMetrics> {
    return this.metrics.getMetrics();
  }
}

class StreamMetrics {
  private messageCount = 0;
  private errorCount = 0;
  private latencySum = 0;
  private latencyCount = 0;

  recordMessage(latency: number): void {
    this.messageCount++;
    this.latencySum += latency;
    this.latencyCount++;
  }

  recordError(): void {
    this.errorCount++;
  }

  getMetrics(): StreamMetricsData {
    return {
      messageCount: this.messageCount,
      errorCount: this.errorCount,
      errorRate: this.messageCount > 0 ? this.errorCount / this.messageCount : 0,
      averageLatency: this.latencyCount > 0 ? this.latencySum / this.latencyCount : 0,
      timestamp: new Date(),
    };
  }
}

interface HealthCheck {
  check(): Promise<HealthCheckResult>;
}

class RedisHealthCheck implements HealthCheck {
  constructor(private readonly redisService: RedisService) {}

  async check(): Promise<HealthCheckResult> {
    try {
      const start = Date.now();
      await this.redisService.ping();
      const latency = Date.now() - start;

      return {
        status: 'healthy',
        message: 'Redis connection is healthy',
        timestamp: new Date(),
        details: { latency },
      };
    } catch (error) {
      return {
        status: 'unhealthy',
        message: `Redis connection failed: ${error.message}`,
        timestamp: new Date(),
        details: { error: error.message },
      };
    }
  }
}

class ConsumerHealthCheck implements HealthCheck {
  constructor(private readonly consumerService: StreamConsumerService) {}

  async check(): Promise<HealthCheckResult> {
    try {
      const statuses = await this.consumerService.getConsumerStatus();
      const runningConsumers = statuses.filter(s => s.isRunning).length;
      const totalConsumers = statuses.length;

      if (totalConsumers === 0) {
        return {
          status: 'degraded',
          message: 'No consumers configured',
          timestamp: new Date(),
          details: { runningConsumers, totalConsumers },
        };
      }

      if (runningConsumers === totalConsumers) {
        return {
          status: 'healthy',
          message: 'All consumers are running',
          timestamp: new Date(),
          details: { runningConsumers, totalConsumers },
        };
      }

      return {
        status: 'degraded',
        message: `Some consumers are not running (${runningConsumers}/${totalConsumers})`,
        timestamp: new Date(),
        details: { runningConsumers, totalConsumers },
      };
    } catch (error) {
      return {
        status: 'unhealthy',
        message: `Consumer health check failed: ${error.message}`,
        timestamp: new Date(),
        details: { error: error.message },
      };
    }
  }
}
```

## Module Configuration

### Redis Streams Module
```typescript
@Module({
  imports: [
    RedisModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: (configService: ConfigService) => ({
        config: {
          host: configService.get('redis.host'),
          port: configService.get('redis.port'),
          password: configService.get('redis.password'),
          db: configService.get('redis.db'),
          retryDelayOnFailover: 100,
          maxRetriesPerRequest: 3,
        },
      }),
      inject: [ConfigService],
    }),
  ],
  providers: [
    StreamProducerService,
    StreamConsumerService,
    ConnectionManager,
    StreamProcessor,
    StreamHealthMonitor,
    StreamMetrics,
  ],
  exports: [
    StreamProducerService,
    StreamConsumerService,
    ConnectionManager,
    StreamProcessor,
    StreamHealthMonitor,
  ],
})
export class RedisStreamsModule {}
```

### Configuration Service Updates
```typescript
// src/common/config/globalConfig.ts
export default () => ({
  // ... existing config
  redis: {
    host: process.env.REDIS_HOST,
    port: parseInt(process.env.REDIS_PORT || '6379', 10),
    password: process.env.REDIS_PASSWORD,
    db: parseInt(process.env.REDIS_DB || '0', 10),
    streams: {
      maxLength: parseInt(process.env.REDIS_STREAM_MAX_LENGTH || '1000', 10),
      retentionMs: parseInt(process.env.REDIS_STREAM_RETENTION_MS || '86400000', 10), // 24 hours
      consumerGroup: process.env.REDIS_CONSUMER_GROUP || 'llm:consumer:default',
      pollDelay: parseInt(process.env.REDIS_POLL_DELAY || '100', 10),
    },
  },
});
```

## Usage Examples

### Basic Usage in Controller
```typescript
@Controller('streams')
export class StreamController {
  constructor(
    private readonly streamProducer: StreamProducerService,
    private readonly connectionManager: ConnectionManager,
    private readonly healthMonitor: StreamHealthMonitor,
  ) {}

  @Post('start')
  async startStream(@Body() body: StartStreamDto): Promise<StartStreamResponse> {
    const connection = await this.connectionManager.createConnection(
      body.sessionId,
      'sse'
    );

    return {
      connectionId: connection.id,
      sessionId: body.sessionId,
      status: 'connected',
    };
  }

  @Post('token')
  async streamToken(@Body() body: StreamTokenDto): Promise<void> {
    await this.streamProducer.produceToken(
      body.sessionId,
      body.modelId,
      body.token,
      body.metadata
    );
  }

  @Post('complete')
  async completeStream(@Body() body: CompleteStreamDto): Promise<void> {
    await this.streamProducer.markStreamComplete(
      body.sessionId,
      body.modelId,
      body.finishReason
    );
  }

  @Get('health')
  async getHealth(): Promise<HealthStatus> {
    return this.healthMonitor.performHealthCheck();
  }

  @Get('metrics')
  async getMetrics(): Promise<StreamMetricsData> {
    return this.healthMonitor.getMetrics();
  }
}
```

### LLM Service Integration
```typescript
@Injectable()
export class LLMService {
  constructor(
    private readonly streamProducer: StreamProducerService,
    private readonly logger: Logger,
  ) {}

  async streamResponse(
    sessionId: string,
    modelId: string,
    prompt: string
  ): Promise<void> {
    try {
      // Simulate LLM token generation
      const tokens = await this.generateTokens(prompt);
      
      for (const token of tokens) {
        await this.streamProducer.produceToken(sessionId, modelId, token);
        await this.delay(50); // Simulate streaming delay
      }
      
      await this.streamProducer.markStreamComplete(sessionId, modelId, 'stop');
    } catch (error) {
      this.logger.error(`Failed to stream response for session ${sessionId}:`, error);
      await this.streamProducer.markStreamComplete(sessionId, modelId, 'error');
    }
  }

  private async generateTokens(prompt: string): Promise<string[]> {
    // This would be your actual LLM integration
    return prompt.split(' ').map(word => word + ' ');
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
```

### SSE Controller Implementation
```typescript
@Controller('sse')
export class SSEController {
  constructor(
    private readonly connectionManager: ConnectionManager,
    private readonly streamConsumerService: StreamConsumerService,
  ) {}

  @Sse('stream/:sessionId')
  async streamEvents(
    @Param('sessionId') sessionId: string,
    @Query('modelId') modelId: string,
    @Res() res: Response,
  ): Observable<MessageEvent> {
    const connection = await this.connectionManager.createConnection(sessionId, 'sse');
    
    // Start consumer for this session
    await this.streamConsumerService.startConsumer(
      `llm:stream:${sessionId}:${modelId}`,
      'llm:consumer:sse',
      connection.id
    );

    // Set up SSE response
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('Access-Control-Allow-Origin', '*');

    return new Observable(subscriber => {
      // Handle connection cleanup
      res.on('close', () => {
        this.connectionManager.removeConnection(connection.id);
        subscriber.complete();
      });

      // Send initial connection message
      subscriber.next({
        data: { type: 'connected', sessionId, connectionId: connection.id },
        type: 'message',
        id: '0',
        retry: 1000,
      } as MessageEvent);
    });
  }
}
```

### DTOs and Interfaces
```typescript
export class StartStreamDto {
  @IsString()
  sessionId: string;

  @IsString()
  modelId: string;

  @IsOptional()
  @IsString()
  connectionType?: 'sse' | 'websocket';
}

export class StreamTokenDto {
  @IsString()
  sessionId: string;

  @IsString()
  modelId: string;

  @IsString()
  token: string;

  @IsOptional()
  metadata?: Partial<StreamMessage['metadata']>;
}

export class CompleteStreamDto {
  @IsString()
  sessionId: string;

  @IsString()
  modelId: string;

  @IsOptional()
  @IsString()
  finishReason?: string;
}

export interface StartStreamResponse {
  connectionId: string;
  sessionId: string;
  status: string;
}

export interface HealthStatus {
  status: 'healthy' | 'degraded' | 'unhealthy';
  timestamp: Date;
  checks: Map<string, HealthCheckResult>;
  summary: {
    total: number;
    healthy: number;
    unhealthy: number;
    degraded: number;
  };
}

export interface HealthCheckResult {
  status: 'healthy' | 'degraded' | 'unhealthy';
  message: string;
  timestamp: Date;
  details?: any;
}

export interface ConsumerStatus {
  streamKey: string;
  consumerGroup: string;
  consumerName: string;
  isRunning: boolean;
  lastActivity: Date;
}

export interface ConnectionStats {
  totalConnections: number;
  activeConnections: number;
  sessionCount: number;
  timestamp: Date;
}

export interface StreamMetricsData {
  messageCount: number;
  errorCount: number;
  errorRate: number;
  averageLatency: number;
  timestamp: Date;
}
```

## Production Deployment Considerations

### Environment Variables
```bash
# Redis Streams Configuration
REDIS_STREAM_MAX_LENGTH=1000
REDIS_STREAM_RETENTION_MS=86400000
REDIS_CONSUMER_GROUP=llm:consumer:production
REDIS_POLL_DELAY=100

# Scaling Configuration
MAX_CONSUMERS_PER_INSTANCE=5
CONSUMER_POLL_TIMEOUT=1000
CONNECTION_CLEANUP_INTERVAL=300000
```

### Docker Compose Updates
```yaml
# docker-compose.yml additions
services:
  redis:
    # ... existing config
    command: redis-server --appendonly yes --maxmemory-policy allkeys-lru
    volumes:
      - redis_data:/data
      - ./redis.conf:/usr/local/etc/redis/redis.conf
    ports:
      - "6379:6379"
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 30s
      timeout: 10s
      retries: 3
```

### Monitoring and Alerting
```typescript
// Health check scheduling
@Injectable()
export class HealthCheckScheduler {
  constructor(
    private readonly healthMonitor: StreamHealthMonitor,
    private readonly logger: Logger,
  ) {}

  @Cron('*/30 * * * * *') // Every 30 seconds
  async performHealthCheck(): Promise<void> {
    try {
      const health = await this.healthMonitor.performHealthCheck();
      
      if (health.status === 'unhealthy') {
        this.logger.error('System health check failed', health);
        // Trigger alerting
        await this.triggerAlert(health);
      } else if (health.status === 'degraded') {
        this.logger.warn('System health check degraded', health);
      }
    } catch (error) {
      this.logger.error('Health check scheduler failed:', error);
    }
  }

  private async triggerAlert(health: HealthStatus): Promise<void> {
    // Implementation for alerting (email, Slack, PagerDuty, etc.)
  }
}
```

This comprehensive implementation provides a production-ready Redis Streams bridge for LLM token streaming with proper error handling, health monitoring, and scalability considerations.
