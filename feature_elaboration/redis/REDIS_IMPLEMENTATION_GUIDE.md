# Redis Implementation Guide for NestJS Backend

## Table of Contents
1. [Overview](#overview)
2. [Current Setup](#current-setup)
3. [Redis Use Cases](#redis-use-cases)
4. [Implementation Examples](#implementation-examples)
5. [Best Practices](#best-practices)
6. [Performance Optimization](#performance-optimization)
7. [Monitoring and Debugging](#monitoring-and-debugging)
8. [Testing](#testing)

## Overview

Redis is an in-memory data structure store that can be used as a database, cache, and message broker. In our NestJS backend, Redis is configured for:
- Session storage
- Caching frequently accessed data
- Rate limiting
- Real-time features
- Job queues

## Current Setup

### Dependencies
Our project already includes the necessary Redis packages:
```json
{
  "@nestjs-modules/ioredis": "^2.0.2",
  "@nestjs/cache-manager": "^3.0.1",
  "cache-manager": "^7.1.1",
  "cache-manager-redis-store": "^3.0.1",
  "ioredis": "^5.7.0",
  "redis": "^5.8.2"
}
```

### Configuration
Redis is configured in `src/app.module.ts` using `@nestjs-modules/ioredis`:

```typescript
RedisModule.forRootAsync({
  inject: [ConfigService],
  useFactory: (configService: ConfigService) => ({
    type: 'single',
    config: {
      host: configService.get('redis.host'),
      port: configService.get('redis.port'),
      password: configService.get('redis.password'),
      db: configService.get('redis.db'),
    },
  }),
}),
```

### Environment Variables
Required Redis environment variables:
```env
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASSWORD=redis
REDIS_DB=0
```

### Docker Setup
Redis is configured in `docker-compose.yml`:
```yaml
redis:
  container_name: redis_cache
  image: redis:8.2.1-alpine
  restart: always
  environment:
    - REDIS_PASSWORD=redis
  ports:
    - "6379:6379"
  volumes:
    - redis_data:/data
```

## Redis Use Cases

### 1. Caching
- **Database Query Results**: Cache expensive database queries
- **API Responses**: Cache external API responses
- **User Sessions**: Store user session data
- **Configuration**: Cache application configuration

### 2. Session Management
- **JWT Token Storage**: Store refresh tokens
- **User Sessions**: Track user login status
- **Rate Limiting**: Track API usage per user

### 3. Real-time Features
- **WebSocket State**: Store connection state
- **Chat Messages**: Temporary message storage
- **Notifications**: User notification queues

### 4. Job Queues
- **Background Tasks**: Process heavy operations
- **Email Sending**: Queue email notifications
- **File Processing**: Queue file upload processing

## Implementation Examples

### 1. Basic Redis Service

Create `src/common/services/redis.service.ts`:

```typescript
import { Injectable } from '@nestjs/common';
import { InjectRedis } from '@nestjs-modules/ioredis';
import Redis from 'ioredis';

@Injectable()
export class RedisService {
  constructor(@InjectRedis() private readonly redis: Redis) {}

  // String operations
  async set(key: string, value: string, ttl?: number): Promise<'OK'> {
    if (ttl) {
      return this.redis.setex(key, ttl, value);
    }
    return this.redis.set(key, value);
  }

  async get(key: string): Promise<string | null> {
    return this.redis.get(key);
  }

  async del(key: string): Promise<number> {
    return this.redis.del(key);
  }

  // Hash operations
  async hset(key: string, field: string, value: string): Promise<number> {
    return this.redis.hset(key, field, value);
  }

  async hget(key: string, field: string): Promise<string | null> {
    return this.redis.hget(key, field);
  }

  async hgetall(key: string): Promise<Record<string, string>> {
    return this.redis.hgetall(key);
  }

  // List operations
  async lpush(key: string, ...values: string[]): Promise<number> {
    return this.redis.lpush(key, ...values);
  }

  async rpop(key: string): Promise<string | null> {
    return this.redis.rpop(key);
  }

  async lrange(key: string, start: number, stop: number): Promise<string[]> {
    return this.redis.lrange(key, start, stop);
  }

  // Set operations
  async sadd(key: string, ...members: string[]): Promise<number> {
    return this.redis.sadd(key, ...members);
  }

  async smembers(key: string): Promise<string[]> {
    return this.redis.smembers(key);
  }

  async sismember(key: string, member: string): Promise<boolean> {
    return this.redis.sismember(key, member);
  }

  // Key management
  async exists(key: string): Promise<number> {
    return this.redis.exists(key);
  }

  async expire(key: string, seconds: number): Promise<number> {
    return this.redis.expire(key, seconds);
  }

  async ttl(key: string): Promise<number> {
    return this.redis.ttl(key);
  }

  // Pattern matching
  async keys(pattern: string): Promise<string[]> {
    return this.redis.keys(pattern);
  }

  // Pipeline for multiple operations
  async pipeline(operations: Array<[string, ...any[]]>): Promise<any[]> {
    const pipeline = this.redis.pipeline();
    operations.forEach(([command, ...args]) => {
      pipeline[command](...args);
    });
    return pipeline.exec();
  }
}
```

### 2. Cache Manager Service

Create `src/common/services/cache.service.ts`:

```typescript
import { Injectable, Inject } from '@nestjs/common';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Cache } from 'cache-manager';

@Injectable()
export class CacheService {
  constructor(@Inject(CACHE_MANAGER) private cacheManager: Cache) {}

  async get<T>(key: string): Promise<T | undefined> {
    return this.cacheManager.get<T>(key);
  }

  async set(key: string, value: any, ttl?: number): Promise<void> {
    return this.cacheManager.set(key, value, ttl);
  }

  async del(key: string): Promise<void> {
    return this.cacheManager.del(key);
  }

  async reset(): Promise<void> {
    return this.cacheManager.reset();
  }

  async wrap<T>(
    key: string,
    fn: () => Promise<T>,
    ttl?: number
  ): Promise<T> {
    return this.cacheManager.wrap(key, fn, ttl);
  }
}
```

### 3. Rate Limiting Service

Create `src/common/services/rate-limit.service.ts`:

```typescript
import { Injectable } from '@nestjs/common';
import { RedisService } from './redis.service';

export interface RateLimitConfig {
  windowMs: number; // Time window in milliseconds
  max: number; // Max requests per window
  keyPrefix?: string; // Redis key prefix
}

@Injectable()
export class RateLimitService {
  constructor(private readonly redisService: RedisService) {}

  async checkRateLimit(
    identifier: string,
    config: RateLimitConfig
  ): Promise<{ allowed: boolean; remaining: number; resetTime: number }> {
    const key = `${config.keyPrefix || 'rate_limit'}:${identifier}`;
    const now = Date.now();
    const windowStart = now - config.windowMs;

    // Remove expired entries
    await this.redisService.zremrangebyscore(key, 0, windowStart);

    // Count current requests in window
    const currentCount = await this.redisService.zcard(key);

    if (currentCount >= config.max) {
      // Get the oldest request time to calculate reset time
      const oldestRequest = await this.redisService.zrange(key, 0, 0, 'WITHSCORES');
      const resetTime = oldestRequest[0] ? parseInt(oldestRequest[1]) + config.windowMs : now + config.windowMs;
      
      return {
        allowed: false,
        remaining: 0,
        resetTime,
      };
    }

    // Add current request
    await this.redisService.zadd(key, now, now.toString());
    await this.redisService.expire(key, Math.ceil(config.windowMs / 1000));

    return {
      allowed: true,
      remaining: config.max - currentCount - 1,
      resetTime: now + config.windowMs,
    };
  }

  async getRateLimitInfo(
    identifier: string,
    config: RateLimitConfig
  ): Promise<{ current: number; remaining: number; resetTime: number }> {
    const key = `${config.keyPrefix || 'rate_limit'}:${identifier}`;
    const now = Date.now();
    const windowStart = now - config.windowMs;

    // Remove expired entries
    await this.redisService.zremrangebyscore(key, 0, windowStart);

    // Count current requests
    const current = await this.redisService.zcard(key);
    const remaining = Math.max(0, config.max - current);

    // Calculate reset time
    const oldestRequest = await this.redisService.zrange(key, 0, 0, 'WITHSCORES');
    const resetTime = oldestRequest[0] ? parseInt(oldestRequest[1]) + config.windowMs : now + config.windowMs;

    return { current, remaining, resetTime };
  }
}
```

### 4. Session Management Service

Create `src/common/services/session.service.ts`:

```typescript
import { Injectable } from '@nestjs/common';
import { RedisService } from './redis.service';

export interface SessionData {
  userId: string;
  email: string;
  permissions: string[];
  lastActivity: number;
  userAgent?: string;
  ipAddress?: string;
}

@Injectable()
export class SessionService {
  constructor(private readonly redisService: RedisService) {}

  private getSessionKey(sessionId: string): string {
    return `session:${sessionId}`;
  }

  private getUserSessionsKey(userId: string): string {
    return `user_sessions:${userId}`;
  }

  async createSession(
    sessionId: string,
    sessionData: SessionData,
    ttl: number = 3600
  ): Promise<void> {
    const sessionKey = this.getSessionKey(sessionId);
    const userSessionsKey = this.getUserSessionsKey(sessionData.userId);

    // Store session data
    await this.redisService.set(
      sessionKey,
      JSON.stringify(sessionData),
      ttl
    );

    // Add session to user's active sessions
    await this.redisService.sadd(userSessionsKey, sessionId);
    await this.redisService.expire(userSessionsKey, ttl);
  }

  async getSession(sessionId: string): Promise<SessionData | null> {
    const sessionKey = this.getSessionKey(sessionId);
    const sessionData = await this.redisService.get(sessionKey);
    
    if (!sessionData) return null;

    const session = JSON.parse(sessionData) as SessionData;
    
    // Update last activity
    session.lastActivity = Date.now();
    await this.redisService.set(sessionKey, JSON.stringify(session));

    return session;
  }

  async updateSession(
    sessionId: string,
    updates: Partial<SessionData>
  ): Promise<void> {
    const session = await this.getSession(sessionId);
    if (!session) return;

    const updatedSession = { ...session, ...updates };
    const sessionKey = this.getSessionKey(sessionId);
    
    await this.redisService.set(sessionKey, JSON.stringify(updatedSession));
  }

  async deleteSession(sessionId: string): Promise<void> {
    const session = await this.getSession(sessionId);
    if (!session) return;

    const sessionKey = this.getSessionKey(sessionId);
    const userSessionsKey = this.getUserSessionsKey(session.userId);

    // Remove session data
    await this.redisService.del(sessionKey);
    
    // Remove from user's active sessions
    await this.redisService.srem(userSessionsKey, sessionId);
  }

  async getUserSessions(userId: string): Promise<string[]> {
    const userSessionsKey = this.getUserSessionsKey(userId);
    return this.redisService.smembers(userSessionsKey);
  }

  async deleteAllUserSessions(userId: string): Promise<void> {
    const sessionIds = await this.getUserSessions(userId);
    const userSessionsKey = this.getUserSessionsKey(userId);

    // Delete all session data
    const pipeline = sessionIds.map(sessionId => 
      this.redisService.del(this.getSessionKey(sessionId))
    );
    await Promise.all(pipeline);

    // Delete user sessions set
    await this.redisService.del(userSessionsKey);
  }

  async cleanupExpiredSessions(): Promise<void> {
    // This would typically be handled by Redis TTL
    // But you can implement additional cleanup logic here
  }
}
```

### 5. Job Queue Service

Create `src/common/services/job-queue.service.ts`:

```typescript
import { Injectable, Logger } from '@nestjs/common';
import { RedisService } from './redis.service';

export interface Job<T = any> {
  id: string;
  type: string;
  data: T;
  priority: number;
  createdAt: number;
  attempts: number;
  maxAttempts: number;
}

export interface JobProcessor<T = any> {
  process(job: Job<T>): Promise<void>;
  onFailed?(job: Job<T>, error: Error): Promise<void>;
}

@Injectable()
export class JobQueueService {
  private readonly logger = new Logger(JobQueueService.name);
  private readonly processors = new Map<string, JobProcessor>();

  constructor(private readonly redisService: RedisService) {}

  registerProcessor<T>(jobType: string, processor: JobProcessor<T>): void {
    this.processors.set(jobType, processor);
  }

  async enqueue<T>(
    jobType: string,
    data: T,
    priority: number = 0,
    delay: number = 0
  ): Promise<string> {
    const jobId = this.generateJobId();
    const job: Job<T> = {
      id: jobId,
      type: jobType,
      data,
      priority,
      createdAt: Date.now(),
      attempts: 0,
      maxAttempts: 3,
    };

    if (delay > 0) {
      // Delayed job - use sorted set
      const executeAt = Date.now() + delay;
      await this.redisService.zadd('delayed_jobs', executeAt, jobId);
      await this.redisService.set(`job:${jobId}`, JSON.stringify(job));
    } else {
      // Immediate job - use priority queue
      await this.redisService.zadd('job_queue', priority, jobId);
      await this.redisService.set(`job:${jobId}`, JSON.stringify(job));
    }

    this.logger.log(`Job ${jobId} of type ${jobType} enqueued`);
    return jobId;
  }

  async dequeue(): Promise<Job | null> {
    // Check for delayed jobs that are ready
    const now = Date.now();
    const readyJobs = await this.redisService.zrangebyscore('delayed_jobs', 0, now);
    
    if (readyJobs.length > 0) {
      // Move ready delayed jobs to main queue
      for (const jobId of readyJobs) {
        const jobData = await this.redisService.get(`job:${jobId}`);
        if (jobData) {
          const job: Job = JSON.parse(jobData);
          await this.redisService.zadd('job_queue', job.priority, jobId);
          await this.redisService.zrem('delayed_jobs', jobId);
        }
      }
    }

    // Get highest priority job
    const jobIds = await this.redisService.zrevrange('job_queue', 0, 0);
    if (jobIds.length === 0) return null;

    const jobId = jobIds[0];
    const jobData = await this.redisService.get(`job:${jobId}`);
    
    if (!jobData) {
      await this.redisService.zrem('job_queue', jobId);
      return null;
    }

    const job: Job = JSON.parse(jobData);
    
    // Remove from queue temporarily
    await this.redisService.zrem('job_queue', jobId);
    
    return job;
  }

  async processJob(job: Job): Promise<void> {
    const processor = this.processors.get(job.type);
    if (!processor) {
      throw new Error(`No processor registered for job type: ${job.type}`);
    }

    try {
      await processor.process(job);
      this.logger.log(`Job ${job.id} processed successfully`);
      
      // Clean up job data
      await this.redisService.del(`job:${job.id}`);
    } catch (error) {
      this.logger.error(`Job ${job.id} failed: ${error.message}`);
      
      job.attempts++;
      
      if (job.attempts >= job.maxAttempts) {
        // Job failed permanently
        if (processor.onFailed) {
          await processor.onFailed(job, error);
        }
        await this.redisService.del(`job:${job.id}`);
        this.logger.error(`Job ${job.id} failed permanently after ${job.attempts} attempts`);
      } else {
        // Retry job
        await this.redisService.zadd('job_queue', job.priority, job.id);
        await this.redisService.set(`job:${job.id}`, JSON.stringify(job));
        this.logger.log(`Job ${job.id} scheduled for retry (attempt ${job.attempts + 1})`);
      }
    }
  }

  async startWorker(interval: number = 1000): Promise<void> {
    this.logger.log('Starting job worker...');
    
    setInterval(async () => {
      try {
        const job = await this.dequeue();
        if (job) {
          await this.processJob(job);
        }
      } catch (error) {
        this.logger.error(`Error processing job: ${error.message}`);
      }
    }, interval);
  }

  private generateJobId(): string {
    return `job_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  async getQueueStats(): Promise<{
    pending: number;
    delayed: number;
    processing: number;
  }> {
    const pending = await this.redisService.zcard('job_queue');
    const delayed = await this.redisService.zcard('delayed_jobs');
    
    return { pending, delayed, processing: 0 };
  }
}
```

## Best Practices

### 1. Key Naming Conventions
```typescript
// Use descriptive prefixes and separators
const keys = {
  user: 'user:{id}',
  session: 'session:{sessionId}',
  cache: 'cache:{resource}:{id}',
  rateLimit: 'rate_limit:{identifier}',
  job: 'job:{jobId}',
  lock: 'lock:{resource}:{id}',
};
```

### 2. TTL Management
```typescript
// Always set TTL for temporary data
await this.redisService.set('temp:key', 'value', 3600); // 1 hour

// Use different TTLs for different data types
const ttls = {
  session: 86400,        // 24 hours
  cache: 3600,           // 1 hour
  rateLimit: 60,         // 1 minute
  temporary: 300,        // 5 minutes
};
```

### 3. Error Handling
```typescript
try {
  const result = await this.redisService.get(key);
  return result;
} catch (error) {
  this.logger.error(`Redis operation failed: ${error.message}`);
  // Fallback to database or return default value
  return null;
}
```

### 4. Connection Management
```typescript
// Handle Redis connection events
this.redis.on('connect', () => {
  this.logger.log('Connected to Redis');
});

this.redis.on('error', (error) => {
  this.logger.error(`Redis error: ${error.message}`);
});

this.redis.on('close', () => {
  this.logger.warn('Redis connection closed');
});
```

## Performance Optimization

### 1. Pipeline Operations
```typescript
// Use pipelines for multiple operations
async function batchGetUserData(userIds: string[]): Promise<UserData[]> {
  const pipeline = this.redisService.pipeline(
    userIds.map(id => ['get', `user:${id}`])
  );
  
  const results = await pipeline;
  return results.map(([err, result]) => 
    err ? null : JSON.parse(result)
  ).filter(Boolean);
}
```

### 2. Memory Optimization
```typescript
// Use appropriate data structures
// For simple key-value: SET
// For objects: HSET
// For lists: LPUSH/RPUSH
// For sets: SADD
// For sorted sets: ZADD

// Compress large values
async setCompressed(key: string, value: any, ttl?: number): Promise<void> {
  const compressed = await this.compress(JSON.stringify(value));
  return this.redisService.set(key, compressed, ttl);
}
```

### 3. Connection Pooling
```typescript
// Configure connection pool in RedisModule
RedisModule.forRootAsync({
  inject: [ConfigService],
  useFactory: (configService: ConfigService) => ({
    type: 'single',
    config: {
      host: configService.get('redis.host'),
      port: configService.get('redis.port'),
      password: configService.get('redis.password'),
      db: configService.get('redis.db'),
      maxRetriesPerRequest: 3,
      retryDelayOnFailover: 100,
      enableReadyCheck: true,
      maxLoadingTimeout: 10000,
    },
  }),
}),
```

## Monitoring and Debugging

### 1. Redis CLI Commands
```bash
# Connect to Redis
redis-cli -h localhost -p 6379 -a redis

# Monitor all commands
MONITOR

# Check memory usage
INFO memory

# Check connected clients
CLIENT LIST

# Check slow queries
SLOWLOG GET 10

# Check key statistics
INFO keyspace
```

### 2. Health Check Service
```typescript
@Injectable()
export class RedisHealthService {
  constructor(
    @InjectRedis() private readonly redis: Redis,
    private readonly logger: Logger
  ) {}

  async checkHealth(): Promise<{
    status: 'up' | 'down';
    latency: number;
    memory: any;
    info: any;
  }> {
    const start = Date.now();
    
    try {
      await this.redis.ping();
      const latency = Date.now() - start;
      
      const memory = await this.redis.info('memory');
      const info = await this.redis.info('server');
      
      return {
        status: 'up',
        latency,
        memory: this.parseInfo(memory),
        info: this.parseInfo(info),
      };
    } catch (error) {
      this.logger.error(`Redis health check failed: ${error.message}`);
      return {
        status: 'down',
        latency: -1,
        memory: null,
        info: null,
      };
    }
  }

  private parseInfo(info: string): Record<string, string> {
    const result: Record<string, string> = {};
    info.split('\r\n').forEach(line => {
      if (line.includes(':')) {
        const [key, value] = line.split(':');
        result[key] = value;
      }
    });
    return result;
  }
}
```

## Testing

### 1. Unit Tests
```typescript
// redis.service.spec.ts
describe('RedisService', () => {
  let service: RedisService;
  let mockRedis: jest.Mocked<Redis>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RedisService,
        {
          provide: 'REDIS_CLIENT',
          useValue: {
            set: jest.fn(),
            get: jest.fn(),
            del: jest.fn(),
            // ... other methods
          },
        },
      ],
    }).compile();

    service = module.get<RedisService>(RedisService);
    mockRedis = module.get('REDIS_CLIENT');
  });

  it('should set and get a value', async () => {
    const key = 'test:key';
    const value = 'test:value';
    
    mockRedis.set.mockResolvedValue('OK');
    mockRedis.get.mockResolvedValue(value);

    await service.set(key, value);
    const result = await service.get(key);

    expect(mockRedis.set).toHaveBeenCalledWith(key, value);
    expect(mockRedis.get).toHaveBeenCalledWith(key);
    expect(result).toBe(value);
  });
});
```

### 2. Integration Tests
```typescript
// redis.integration.spec.ts
describe('Redis Integration', () => {
  let app: INestApplication;
  let redisService: RedisService;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [
        RedisModule.forRoot({
          type: 'single',
          config: {
            host: 'localhost',
            port: 6379,
            password: 'redis',
            db: 1, // Use different DB for testing
          },
        }),
      ],
      providers: [RedisService],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();

    redisService = moduleFixture.get<RedisService>(RedisService);
  });

  afterAll(async () => {
    await app.close();
  });

  afterEach(async () => {
    // Clean up test data
    const keys = await redisService.keys('test:*');
    if (keys.length > 0) {
      await Promise.all(keys.map(key => redisService.del(key)));
    }
  });

  it('should handle complex operations', async () => {
    // Test complex Redis operations
    const sessionData = {
      userId: '123',
      email: 'test@example.com',
      permissions: ['read', 'write'],
    };

    await redisService.set('test:session:123', JSON.stringify(sessionData), 3600);
    const retrieved = await redisService.get('test:session:123');
    
    expect(JSON.parse(retrieved!)).toEqual(sessionData);
  });
});
```

## Conclusion

This Redis implementation guide provides a comprehensive foundation for using Redis in your NestJS backend. The examples cover common use cases like caching, session management, rate limiting, and job queues.

Key takeaways:
1. **Use appropriate data structures** for different use cases
2. **Always set TTL** for temporary data
3. **Implement proper error handling** and fallbacks
4. **Use pipelines** for batch operations
5. **Monitor performance** and memory usage
6. **Test thoroughly** with both unit and integration tests

Remember to adjust the implementation based on your specific requirements and scale. Redis is powerful but requires careful consideration of memory usage and data persistence strategies.
