# BullMQ in NestJS - Practical Examples

## Email Processing System

### Email Service
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

@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);

  constructor(
    @InjectQueue('email') private readonly emailQueue: Queue,
  ) {}

  async sendEmail(data: EmailJobData): Promise<string> {
    try {
      const job = await this.emailQueue.add(
        'send-email',
        data,
        {
          attempts: 3,
          backoff: { type: 'exponential', delay: 2000 },
          removeOnComplete: 100,
          removeOnFail: 50,
        },
      );

      this.logger.log(`Email job added: ${job.id}`);
      return job.id;
    } catch (error) {
      this.logger.error('Failed to add email job:', error);
      throw error;
    }
  }
}
```

### Email Processor
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
      await job.updateProgress(25);
      await this.processEmail(job.data);
      await job.updateProgress(75);
      
      const result = await this.finalizeEmail(job.data);
      await job.updateProgress(100);
      
      return result;
    } catch (error) {
      this.logger.error(`Email job ${job.id} failed:`, error);
      throw error;
    }
  }

  private async processEmail(data: EmailJobData): Promise<void> {
    await new Promise(resolve => setTimeout(resolve, 1000));
    this.logger.log(`Processing email to ${data.to}`);
  }

  private async finalizeEmail(data: EmailJobData): Promise<any> {
    await new Promise(resolve => setTimeout(resolve, 500));
    return {
      messageId: `msg_${Date.now()}`,
      sentAt: new Date().toISOString(),
      recipient: data.to,
    };
  }

  @OnWorkerEvent('completed')
  onCompleted(job: Job) {
    this.logger.log(`Email job ${job.id} completed`);
  }

  @OnWorkerEvent('failed')
  onFailed(job: Job, err: Error) {
    this.logger.error(`Email job ${job.id} failed:`, err);
  }
}
```

## File Processing Pipeline

### File Processing Service
```typescript
// src/queues/file-processing/file-processing.service.ts
import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';

export interface FileProcessingJobData {
  fileId: string;
  fileName: string;
  filePath: string;
  fileType: 'image' | 'document' | 'video';
  operations: string[];
}

@Injectable()
export class FileProcessingService {
  private readonly logger = new Logger(FileProcessingService.name);

  constructor(
    @InjectQueue('file-processing') private readonly fileQueue: Queue,
  ) {}

  async processFile(data: FileProcessingJobData): Promise<string> {
    try {
      const job = await this.fileQueue.add(
        'process-file',
        data,
        {
          priority: this.getPriority(data.fileType),
          attempts: 2,
          backoff: { type: 'exponential', delay: 5000 },
          removeOnComplete: 50,
          removeOnFail: 25,
        },
      );

      this.logger.log(`File processing job added: ${job.id}`);
      return job.id;
    } catch (error) {
      this.logger.error('Failed to add file processing job:', error);
      throw error;
    }
  }

  private getPriority(fileType: string): number {
    const priorities = { 'image': 1, 'document': 3, 'video': 5 };
    return priorities[fileType] || 5;
  }
}
```

## Testing Examples

### Unit Test
```typescript
// src/queues/email/email.service.spec.ts
import { Test, TestingModule } from '@nestjs/testing';
import { getQueueToken } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { EmailService, EmailJobData } from './email.service';

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

  it('should add email job to queue', async () => {
    const emailData: EmailJobData = {
      to: 'test@example.com',
      subject: 'Test Email',
      template: 'welcome',
      context: { name: 'Test User' },
    };

    const mockJob = { id: 'job-123' };
    mockQueue.add.mockResolvedValue(mockJob as any);

    const result = await service.sendEmail(emailData);

    expect(mockQueue.add).toHaveBeenCalledWith(
      'send-email',
      emailData,
      expect.objectContaining({
        attempts: 3,
        backoff: { type: 'exponential', delay: 2000 },
      }),
    );

    expect(result).toBe('job-123');
  });
});
```

## Usage Examples

### Basic Email Sending
```typescript
@Injectable()
export class UserService {
  constructor(private readonly emailService: EmailService) {}

  async sendWelcomeEmail(user: User) {
    const emailData: EmailJobData = {
      to: user.email,
      subject: 'Welcome!',
      template: 'welcome',
      context: { name: user.name },
    };

    const jobId = await this.emailService.sendEmail(emailData);
    return { jobId, message: 'Welcome email queued' };
  }
}
```

### File Processing
```typescript
@Injectable()
export class FileUploadService {
  constructor(private readonly fileProcessingService: FileProcessingService) {}

  async processUploadedFile(file: UploadedFile) {
    const processingJob = {
      fileId: file.id,
      fileName: file.name,
      filePath: file.path,
      fileType: this.detectFileType(file.name),
      operations: ['compress', 'optimize'],
    };

    const jobId = await this.fileProcessingService.processFile(processingJob);
    return { jobId, message: 'File queued for processing' };
  }

  private detectFileType(fileName: string): 'image' | 'document' | 'video' {
    const ext = fileName.split('.').pop()?.toLowerCase();
    if (['jpg', 'png', 'gif'].includes(ext)) return 'image';
    if (['pdf', 'doc'].includes(ext)) return 'document';
    if (['mp4', 'avi'].includes(ext)) return 'video';
    return 'document';
  }
}
```

## Conclusion

These practical examples demonstrate key BullMQ implementation patterns in NestJS:

- **Service Layer**: Queue injection and job management
- **Processor Layer**: Job execution and progress tracking
- **Testing**: Mocking and unit testing approaches
- **Real-world Usage**: Integration with business logic

For complete implementations and advanced features, refer to the main implementation guide.
