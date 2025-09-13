# BullMQ in NestJS - Detailed Implementation Guide

## Table of Contents

1. [Installation & Setup](#installation--setup)
2. [Basic Configuration](#basic-configuration)
3. [Queue Implementation](#queue-implementation)
4. [Processor Implementation](#processor-implementation)
5. [Producer Implementation](#producer-implementation)
6. [Flow Producer Implementation](#flow-producer-implementation)
7. [Event Handling](#event-handling)
8. [Advanced Features](#advanced-features)
9. [Testing Strategies](#testing-strategies)
10. [Production Deployment](#production-deployment)
11. [Monitoring & Metrics](#monitoring--metrics)
12. [Troubleshooting](#troubleshooting)

## Installation & Setup

### 1. Install Dependencies

```bash
# Install BullMQ and NestJS integration
npm install @nestjs/bullmq bullmq

# Install Redis client (if not already installed)
npm install ioredis

# Install types
npm install --save-dev @types/bullmq
```

### 2. Environment Configuration

Add the following environment variables to your `.env` file:

```env
# Redis Configuration
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASSWORD=your_redis_password
REDIS_DB=0

# BullMQ Configuration
BULLMQ_CONCURRENCY=10
BULLMQ_MAX_ATTEMPTS=3
BULLMQ_BACKOFF_DELAY=1000
```

### 3. Configuration Service

Create a configuration service for BullMQ settings:

```typescript
// src/common/config/bullmq.config.ts
import { registerAs } from '@nestjs/config';

export default registerAs('bullmq', () => ({
  redis: {
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT, 10) || 6379,
    password: process.env.REDIS_PASSWORD,
    db: parseInt(process.env.REDIS_DB, 10) || 0,
  },
  defaultJobOptions: {
    attempts: parseInt(process.env.BULLMQ_MAX_ATTEMPTS, 10) || 3,
    backoff: {
      type: 'exponential',
      delay: parseInt(process.env.BULLMQ_BACKOFF_DELAY, 10) || 1000,
    },
    removeOnComplete: 100,
    removeOnFail: 50,
  },
  concurrency: parseInt(process.env.BULLMQ_CONCURRENCY, 10) || 10,
}));
```

## Basic Configuration

### 1. App Module Configuration

Update your `app.module.ts` to include BullMQ:

```typescript
// src/app.module.ts
import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { BullModule } from '@nestjs/bullmq';
import bullmqConfig from './common/config/bullmq.config';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [bullmqConfig],
      // ... other config
    }),
    
    // Global BullMQ configuration
    BullModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: (configService: ConfigService) => ({
        connection: {
          host: configService.get('bullmq.redis.host'),
          port: configService.get('bullmq.redis.port'),
          password: configService.get('bullmq.redis.password'),
          db: configService.get('bullmq.redis.db'),
        },
        defaultJobOptions: configService.get('bullmq.defaultJobOptions'),
      }),
      inject: [ConfigService],
    }),
    
    // ... other modules
  ],
})
export class AppModule {}
```

### 2. Queue Registration

Register specific queues in your feature modules:

```typescript
// src/queues/email/email.module.ts
import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { EmailProcessor } from './email.processor';
import { EmailService } from './email.service';

@Module({
  imports: [
    BullModule.registerQueue({
      name: 'email',
      defaultJobOptions: {
        attempts: 3,
        backoff: {
          type: 'exponential',
          delay: 2000,
        },
        removeOnComplete: 100,
        removeOnFail: 50,
      },
    }),
  ],
  providers: [EmailProcessor, EmailService],
  exports: [EmailService],
})
export class EmailModule {}
```

## Queue Implementation

### 1. Queue Service (Producer)

Create a service to add jobs to the queue:

```typescript
// src/queues/email/email.service.ts
import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue, JobOptions } from 'bullmq';

export interface EmailJobData {
  to: string;
  subject: string;
  template: string;
  context: Record<string, any>;
}

export interface EmailJobOptions extends JobOptions {
  priority?: number;
  delay?: number;
}

@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);

  constructor(
    @InjectQueue('email') private readonly emailQueue: Queue,
  ) {}

  async addEmailJob(
    data: EmailJobData,
    options: EmailJobOptions = {},
  ): Promise<void> {
    try {
      const job = await this.emailQueue.add(
        'send-email',
        data,
        {
          priority: options.priority || 0,
          delay: options.delay || 0,
          attempts: options.attempts || 3,
          backoff: {
            type: 'exponential',
            delay: 2000,
          },
          removeOnComplete: 100,
          removeOnFail: 50,
          ...options,
        },
      );

      this.logger.log(`Email job added to queue: ${job.id}`);
    } catch (error) {
      this.logger.error('Failed to add email job to queue', error);
      throw error;
    }
  }

  async getQueueStatus() {
    const counts = await this.emailQueue.getJobCounts();
    return {
      waiting: counts.waiting || 0,
      active: counts.active || 0,
      completed: counts.completed || 0,
      failed: counts.failed || 0,
      delayed: counts.delayed || 0,
    };
  }
}
```

## Processor Implementation

### 1. Queue Processor

Create a processor to handle job execution:

```typescript
// src/queues/email/email.processor.ts
import { Processor, WorkerHost, OnWorkerEvent } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { EmailJobData } from './email.service';

@Processor('email')
export class EmailProcessor extends WorkerHost {
  private readonly logger = new Logger(EmailProcessor.name);

  async process(job: Job<EmailJobData>): Promise<any> {
    this.logger.log(`Processing email job ${job.id}`);
    
    try {
      // Update job progress
      await job.updateProgress(25);
      
      // Simulate email processing
      await this.processEmail(job.data);
      
      // Update progress
      await job.updateProgress(75);
      
      // Final processing
      const result = await this.finalizeEmail(job.data);
      
      await job.updateProgress(100);
      
      this.logger.log(`Email job ${job.id} completed successfully`);
      return result;
    } catch (error) {
      this.logger.error(`Email job ${job.id} failed:`, error);
      throw error;
    }
  }

  private async processEmail(data: EmailJobData): Promise<void> {
    // Simulate email processing time
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    // Add job log
    this.logger.log(`Processing email to ${data.to} with subject: ${data.subject}`);
  }

  private async finalizeEmail(data: EmailJobData): Promise<any> {
    // Simulate finalization
    await new Promise(resolve => setTimeout(resolve, 500));
    
    return {
      messageId: `msg_${Date.now()}`,
      sentAt: new Date().toISOString(),
      recipient: data.to,
    };
  }

  @OnWorkerEvent('completed')
  onCompleted(job: Job) {
    this.logger.log(`Email job ${job.id} completed successfully`);
  }

  @OnWorkerEvent('failed')
  onFailed(job: Job, err: Error) {
    this.logger.error(`Email job ${job.id} failed:`, err);
  }
}
```

## Event Handling

### 1. Queue Events Listener

```typescript
// src/queues/email/email-events.listener.ts
import {
  QueueEventsListener,
  QueueEventsHost,
  OnQueueEvent,
} from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';

@QueueEventsListener('email')
export class EmailQueueEvents extends QueueEventsHost {
  private readonly logger = new Logger(EmailQueueEvents.name);

  @OnQueueEvent('completed')
  onCompleted({ jobId, returnvalue }: { jobId: string; returnvalue: any }) {
    this.logger.log(`Email job ${jobId} completed with result:`, returnvalue);
  }

  @OnQueueEvent('failed')
  onFailed({ jobId, failedReason }: { jobId: string; failedReason: string }) {
    this.logger.error(`Email job ${jobId} failed:`, failedReason);
  }

  @OnQueueEvent('stalled')
  onStalled({ jobId }: { jobId: string }) {
    this.logger.warn(`Email job ${jobId} stalled`);
  }
}
```

## Testing Strategies

### 1. Unit Testing

```typescript
// src/queues/email/email.service.spec.ts
import { Test, TestingModule } from '@nestjs/testing';
import { getQueueToken } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { EmailService } from './email.service';

describe('EmailService', () => {
  let service: EmailService;
  let mockQueue: jest.Mocked<Queue>;

  beforeEach(async () => {
    const mockQueueToken = getQueueToken('email');
    
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EmailService,
        {
          provide: mockQueueToken,
          useValue: {
            add: jest.fn(),
            getJobCounts: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get<EmailService>(EmailService);
    mockQueue = module.get(mockQueueToken);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('addEmailJob', () => {
    it('should add email job to queue', async () => {
      const emailData = {
        to: 'test@example.com',
        subject: 'Test Email',
        template: 'welcome',
        context: { name: 'Test User' },
      };

      const mockJob = { id: 'job-123' };
      mockQueue.add.mockResolvedValue(mockJob as any);

      await service.addEmailJob(emailData);

      expect(mockQueue.add).toHaveBeenCalledWith(
        'send-email',
        emailData,
        expect.objectContaining({
          attempts: 3,
          backoff: {
            type: 'exponential',
            delay: 2000,
          },
        }),
      );
    });
  });
});
```

## Production Deployment

### 1. Docker Configuration

```dockerfile
# Dockerfile
FROM node:18-alpine

WORKDIR /app

COPY package*.json ./
RUN npm ci --only=production

COPY dist ./dist

EXPOSE 3000

CMD ["node", "dist/main"]
```

```yaml
# docker-compose.yml
version: '3.8'

services:
  app:
    build: .
    ports:
      - "3000:3000"
    environment:
      - NODE_ENV=production
      - REDIS_HOST=redis
    depends_on:
      - redis
    restart: unless-stopped

  redis:
    image: redis:7-alpine
    ports:
      - "6379:6379"
    volumes:
      - redis_data:/data
    restart: unless-stopped

volumes:
  redis_data:
```

## Conclusion

This guide provides the essential implementation patterns for integrating BullMQ with NestJS applications. The implementation includes:

- **Robust Queue Management**: Reliable job processing with retry logic
- **Event Handling**: Comprehensive event monitoring and handling
- **Testing Strategies**: Unit testing approaches
- **Production Deployment**: Docker configuration and environment setup

For additional advanced features like flow producers, rate limiting, and monitoring, refer to the complete implementation guide and the [BullMQ Official Documentation](https://docs.bullmq.io/).
