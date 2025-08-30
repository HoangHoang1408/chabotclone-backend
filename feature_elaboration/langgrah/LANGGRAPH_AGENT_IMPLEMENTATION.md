# LangGraphJS Agent Implementation Guide for NestJS

## Overview

This guide provides comprehensive documentation for implementing AI agents using LangGraphJS in your existing NestJS chatbot backend. LangGraphJS is a TypeScript framework for building stateful, multi-agent applications with LLMs, providing powerful orchestration capabilities for complex agent workflows.

## Table of Contents

1. [Prerequisites and Dependencies](#prerequisites-and-dependencies)
2. [Core Concepts](#core-concepts)
3. [Architecture Integration](#architecture-integration)
4. [Basic Agent Implementation](#basic-agent-implementation)
5. [Multi-Agent Systems](#multi-agent-systems)
6. [Advanced Patterns](#advanced-patterns)
7. [NestJS Integration Examples](#nestjs-integration-examples)
8. [Best Practices](#best-practices)
9. [Error Handling and Monitoring](#error-handling-and-monitoring)
10. [Deployment Considerations](#deployment-considerations)

## Prerequisites and Dependencies

### Required Packages

Add these dependencies to your `package.json`:

```json
{
  "dependencies": {
    "@langchain/langgraph": "^0.6.0",
    "@langchain/core": "^0.3.0",
    "@langchain/openai": "^0.3.0",
    "@langchain/anthropic": "^0.3.0",
    "@langchain/community": "^0.3.0",
    "zod": "^3.22.0"
  }
}
```

### Environment Variables

Add to your `.env.dev` file:

```env
# AI Model Configuration
OPENAI_API_KEY=sk-...
ANTHROPIC_API_KEY=anthropic-...

# Agent Configuration
AGENT_MAX_ITERATIONS=10
AGENT_TIMEOUT=30000
AGENT_MEMORY_TTL=3600
```

## Core Concepts

### 1. State Management

LangGraphJS uses annotations to define state structure:

```typescript
import { Annotation } from "@langchain/langgraph";
import { BaseMessage } from "@langchain/core/messages";

// Define the agent state schema
export const AgentState = Annotation.Root({
  messages: Annotation<BaseMessage[]>({
    reducer: (x, y) => x.concat(y),
  }),
  userId: Annotation<string>({
    reducer: (x, y) => y ?? x,
  }),
  sessionId: Annotation<string>({
    reducer: (x, y) => y ?? x,
  }),
  context: Annotation<Record<string, any>>({
    reducer: (x, y) => ({ ...x, ...y }),
    default: () => ({}),
  }),
});
```

### 2. Agent Nodes

Agents are defined as async functions that process state and return updates:

```typescript
import { RunnableConfig } from "@langchain/core/runnables";

async function agentNode(
  state: typeof AgentState.State,
  config?: RunnableConfig
): Promise<Partial<typeof AgentState.State>> {
  const { messages, userId, context } = state;
  
  // Process the state and generate response
  const response = await llm.invoke(messages, config);
  
  return {
    messages: [response],
    context: { lastProcessedAt: new Date().toISOString() }
  };
}
```

### 3. Tools

Tools extend agent capabilities:

```typescript
import { tool } from "@langchain/core/tools";
import { z } from "zod";

export const getUserProfileTool = tool(
  async (input: { userId: string }) => {
    // Integration with your existing UserService
    const userService = new UserService();
    const user = await userService.findById(input.userId);
    return JSON.stringify(user);
  },
  {
    name: "getUserProfile",
    description: "Get user profile information",
    schema: z.object({
      userId: z.string().describe("The user ID to fetch profile for"),
    }),
  }
);
```

## Architecture Integration

### NestJS Module Structure

```typescript
// src/agent/agent.module.ts
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AgentService } from './agent.service';
import { AgentController } from './agent.controller';
import { UserModule } from '../user/user.module';

@Module({
  imports: [ConfigModule, UserModule],
  providers: [AgentService],
  controllers: [AgentController],
  exports: [AgentService],
})
export class AgentModule {}
```

### Agent Service Implementation

```typescript
// src/agent/agent.service.ts
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { StateGraph, MessagesAnnotation } from '@langchain/langgraph';
import { MemorySaver } from '@langchain/langgraph-checkpoint';
import { ChatOpenAI } from '@langchain/openai';
import { createReactAgent } from '@langchain/langgraph/prebuilt';
import { UserService } from '../user/user.service';

@Injectable()
export class AgentService {
  private readonly logger = new Logger(AgentService.name);
  private readonly llm: ChatOpenAI;
  private readonly checkpointer: MemorySaver;
  private agents: Map<string, any> = new Map();

  constructor(
    private readonly configService: ConfigService,
    private readonly userService: UserService,
  ) {
    this.llm = new ChatOpenAI({
      apiKey: this.configService.get('OPENAI_API_KEY'),
      model: 'gpt-4o-mini',
      temperature: 0.1,
    });
    
    this.checkpointer = new MemorySaver();
    this.initializeAgents();
  }

  private async initializeAgents() {
    // Initialize different agent types
    this.agents.set('chatbot', await this.createChatbotAgent());
    this.agents.set('support', await this.createSupportAgent());
    this.agents.set('analytics', await this.createAnalyticsAgent());
  }

  private async createChatbotAgent() {
    const tools = [
      this.createUserProfileTool(),
      this.createMessageHistoryTool(),
    ];

    return createReactAgent({
      llm: this.llm,
      tools,
      checkpointer: this.checkpointer,
      prompt: `You are a helpful chatbot assistant. 
               Use the available tools to provide personalized responses.
               Always maintain a friendly and professional tone.`,
    });
  }

  async processMessage(
    message: string,
    userId: string,
    sessionId: string,
    agentType: string = 'chatbot'
  ) {
    try {
      const agent = this.agents.get(agentType);
      if (!agent) {
        throw new Error(`Agent type '${agentType}' not found`);
      }

      const config = {
        configurable: { 
          thread_id: `${userId}-${sessionId}`,
          user_id: userId,
        },
        recursionLimit: this.configService.get('AGENT_MAX_ITERATIONS', 10),
      };

      const response = await agent.invoke({
        messages: [{ role: 'user', content: message }]
      }, config);

      return {
        response: response.messages[response.messages.length - 1].content,
        metadata: {
          sessionId,
          userId,
          agentType,
          timestamp: new Date().toISOString(),
        }
      };
    } catch (error) {
      this.logger.error(`Agent processing error: ${error.message}`, error.stack);
      throw error;
    }
  }
}
```

## Basic Agent Implementation

### 1. Simple ReAct Agent

```typescript
// src/agent/agents/react-agent.ts
import { createReactAgent } from '@langchain/langgraph/prebuilt';
import { ChatOpenAI } from '@langchain/openai';
import { MemorySaver } from '@langchain/langgraph-checkpoint';

export class ReactAgentBuilder {
  static create(tools: any[], prompt?: string) {
    const llm = new ChatOpenAI({
      model: 'gpt-4o-mini',
      temperature: 0,
    });

    const checkpointer = new MemorySaver();

    return createReactAgent({
      llm,
      tools,
      checkpointer,
      prompt: prompt || 'You are a helpful assistant.',
    });
  }
}
```

### 2. Custom Agent with State Management

```typescript
// src/agent/agents/custom-agent.ts
import { StateGraph, MessagesAnnotation } from '@langchain/langgraph';
import { ToolNode } from '@langchain/langgraph/prebuilt';
import { AIMessage } from '@langchain/core/messages';

export class CustomAgentBuilder {
  static create(llm: any, tools: any[]) {
    const toolNode = new ToolNode(tools);

    // Define routing logic
    function shouldContinue({ messages }: typeof MessagesAnnotation.State) {
      const lastMessage = messages[messages.length - 1] as AIMessage;
      
      if (lastMessage.tool_calls?.length) {
        return 'tools';
      }
      return '__end__';
    }

    // Define model calling function
    async function callModel(state: typeof MessagesAnnotation.State) {
      const response = await llm.invoke(state.messages);
      return { messages: [response] };
    }

    // Build the graph
    const workflow = new StateGraph(MessagesAnnotation)
      .addNode('agent', callModel)
      .addNode('tools', toolNode)
      .addEdge('__start__', 'agent')
      .addConditionalEdges('agent', shouldContinue)
      .addEdge('tools', 'agent');

    return workflow.compile();
  }
}
```

## Multi-Agent Systems

### 1. Agent Network Pattern

```typescript
// src/agent/multi-agent/agent-network.ts
import { StateGraph, MessagesAnnotation, Command } from '@langchain/langgraph';
import { z } from 'zod';

export class MultiAgentNetwork {
  private agents: Map<string, any> = new Map();

  constructor(private llm: any) {
    this.initializeAgents();
  }

  private initializeAgents() {
    // Travel advisor agent
    this.agents.set('travel_advisor', this.createTravelAdvisor());
    
    // Hotel advisor agent  
    this.agents.set('hotel_advisor', this.createHotelAdvisor());
    
    // Support agent
    this.agents.set('support_agent', this.createSupportAgent());
  }

  private createTravelAdvisor() {
    return async (state: typeof MessagesAnnotation.State) => {
      const responseSchema = z.object({
        response: z.string().describe("Response to the user"),
        goto: z.enum(['hotel_advisor', 'support_agent', '__end__'])
          .describe("Next agent to call or __end__ to finish"),
      });

      const systemPrompt = `You are a travel expert. 
        If you need hotel recommendations, route to 'hotel_advisor'.
        If the user needs general support, route to 'support_agent'.
        If you can fully answer, return '__end__'.`;

      const messages = [
        { role: 'system', content: systemPrompt },
        ...state.messages,
      ];

      const response = await this.llm.withStructuredOutput(responseSchema)
        .invoke(messages);

      return new Command({
        goto: response.goto,
        update: { 
          messages: [{
            role: 'assistant',
            content: response.response,
            name: 'travel_advisor'
          }]
        }
      });
    };
  }

  createGraph() {
    return new StateGraph(MessagesAnnotation)
      .addNode('travel_advisor', this.agents.get('travel_advisor'), {
        ends: ['hotel_advisor', 'support_agent', '__end__']
      })
      .addNode('hotel_advisor', this.agents.get('hotel_advisor'), {
        ends: ['travel_advisor', 'support_agent', '__end__']
      })
      .addNode('support_agent', this.agents.get('support_agent'), {
        ends: ['travel_advisor', 'hotel_advisor', '__end__']
      })
      .addEdge('__start__', 'travel_advisor')
      .compile();
  }
}
```

### 2. Supervisor Pattern

```typescript
// src/agent/multi-agent/supervisor-pattern.ts
import { StateGraph, MessagesAnnotation, Command } from '@langchain/langgraph';

export class SupervisorPattern {
  constructor(private llm: any, private agents: Map<string, any>) {}

  createSupervisor() {
    return async (state: typeof MessagesAnnotation.State) => {
      const responseSchema = z.object({
        next_agent: z.enum(['research_agent', 'writing_agent', '__end__'])
          .describe("Which agent to call next"),
        reasoning: z.string().describe("Why this agent was chosen"),
      });

      const systemPrompt = `You are a supervisor managing specialized agents:
        - research_agent: For gathering information and data
        - writing_agent: For creating and editing content
        Decide which agent should handle the current task.`;

      const messages = [
        { role: 'system', content: systemPrompt },
        ...state.messages,
      ];

      const response = await this.llm.withStructuredOutput(responseSchema)
        .invoke(messages);

      return new Command({
        goto: response.next_agent,
        update: { 
          context: { supervisorReasoning: response.reasoning }
        }
      });
    };
  }

  createGraph() {
    const supervisor = this.createSupervisor();

    return new StateGraph(MessagesAnnotation)
      .addNode('supervisor', supervisor, {
        ends: ['research_agent', 'writing_agent', '__end__']
      })
      .addNode('research_agent', this.agents.get('research'), {
        ends: ['supervisor']
      })
      .addNode('writing_agent', this.agents.get('writing'), {
        ends: ['supervisor']
      })
      .addEdge('__start__', 'supervisor')
      .compile();
  }
}
```

## Advanced Patterns

### 1. Human-in-the-Loop Integration

```typescript
// src/agent/patterns/human-in-loop.ts
import { interrupt } from '@langchain/langgraph';
import { Command } from '@langchain/langgraph';

export class HumanInLoopAgent {
  static createHumanNode() {
    return (state: any): Command => {
      // This will pause execution and wait for human input
      const userInput: string = interrupt({
        message: "Agent needs human assistance. Please provide guidance:",
        context: state.context,
      });

      return new Command({
        update: {
          messages: [{
            role: 'human',
            content: userInput,
          }],
          context: { humanAssistanceRequested: true }
        },
        goto: 'agent'
      });
    };
  }

  static shouldRequestHumanHelp(state: any): boolean {
    // Logic to determine when human assistance is needed
    const lastMessage = state.messages[state.messages.length - 1];
    return lastMessage.content.includes('I need human assistance') ||
           state.context.uncertaintyLevel > 0.8;
  }
}
```

### 2. Memory and Context Management

```typescript
// src/agent/patterns/memory-management.ts
import { BaseStore } from '@langchain/langgraph/store';

export class AgentMemoryManager {
  constructor(private store: BaseStore) {}

  async saveConversationContext(
    userId: string, 
    sessionId: string, 
    context: any
  ) {
    const namespace = ['conversations', userId];
    await this.store.put(namespace, sessionId, {
      context,
      timestamp: new Date().toISOString(),
    });
  }

  async getConversationContext(userId: string, sessionId: string) {
    const namespace = ['conversations', userId];
    const result = await this.store.get(namespace, sessionId);
    return result?.[0]?.value || {};
  }

  async updateAgentInstructions(agentId: string, instructions: string) {
    const namespace = ['agent_instructions'];
    await this.store.put(namespace, agentId, {
      instructions,
      updatedAt: new Date().toISOString(),
    });
  }

  // Dynamic instruction updating based on conversation
  async createDynamicInstructionNode(agentId: string) {
    return async (state: any, store: BaseStore) => {
      const currentInstructions = await this.getAgentInstructions(agentId);
      const conversationHistory = state.messages;

      // Use LLM to refine instructions based on conversation
      const refinedInstructions = await this.refineInstructions(
        currentInstructions,
        conversationHistory
      );

      await this.updateAgentInstructions(agentId, refinedInstructions);

      return { 
        context: { instructionsUpdated: true }
      };
    };
  }
}
```

## NestJS Integration Examples

### 1. Agent Controller

```typescript
// src/agent/agent.controller.ts
import { 
  Controller, 
  Post, 
  Body, 
  UseGuards, 
  Request,
  HttpException,
  HttpStatus 
} from '@nestjs/common';
import { AuthGuard } from '../iam/auth/guards/auth.guard';
import { AgentService } from './agent.service';
import { CurrentUser } from '../iam/auth/decorators/current-user.decorator';
import { User } from '../user/entities/user.entity';

@Controller('agent')
@UseGuards(AuthGuard)
export class AgentController {
  constructor(private readonly agentService: AgentService) {}

  @Post('chat')
  async chat(
    @Body() body: { message: string; sessionId?: string; agentType?: string },
    @CurrentUser() user: User,
  ) {
    try {
      const sessionId = body.sessionId || `session-${Date.now()}`;
      
      const response = await this.agentService.processMessage(
        body.message,
        user.id,
        sessionId,
        body.agentType || 'chatbot'
      );

      return {
        success: true,
        data: response,
      };
    } catch (error) {
      throw new HttpException(
        `Agent processing failed: ${error.message}`,
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }

  @Post('multi-agent')
  async multiAgentChat(
    @Body() body: { 
      message: string; 
      sessionId?: string;
      preferredFlow?: string;
    },
    @CurrentUser() user: User,
  ) {
    try {
      const response = await this.agentService.processMultiAgentMessage(
        body.message,
        user.id,
        body.sessionId || `ma-session-${Date.now()}`,
        body.preferredFlow
      );

      return {
        success: true,
        data: response,
      };
    } catch (error) {
      throw new HttpException(
        `Multi-agent processing failed: ${error.message}`,
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }

  @Post('stream')
  async streamResponse(
    @Body() body: { message: string; sessionId: string },
    @CurrentUser() user: User,
  ) {
    // Implement streaming response for real-time agent interaction
    return this.agentService.streamAgentResponse(
      body.message,
      user.id,
      body.sessionId
    );
  }
}
```

### 2. Agent Guard Integration

```typescript
// src/agent/guards/agent-rate-limit.guard.ts
import { Injectable, CanActivate, ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { InjectRedis } from '@nestjs-modules/ioredis';
import Redis from 'ioredis';

@Injectable()
export class AgentRateLimitGuard implements CanActivate {
  constructor(
    private reflector: Reflector,
    @InjectRedis() private readonly redis: Redis,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const userId = request.user?.id;

    if (!userId) {
      return false;
    }

    const key = `agent_rate_limit:${userId}`;
    const limit = 10; // 10 requests per minute
    const ttl = 60; // 1 minute

    const current = await this.redis.incr(key);
    
    if (current === 1) {
      await this.redis.expire(key, ttl);
    }

    return current <= limit;
  }
}
```

### 3. Agent Middleware for Logging

```typescript
// src/agent/middleware/agent-logging.middleware.ts
import { Injectable, NestMiddleware, Logger } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';

@Injectable()
export class AgentLoggingMiddleware implements NestMiddleware {
  private readonly logger = new Logger(AgentLoggingMiddleware.name);

  use(req: Request, res: Response, next: NextFunction) {
    const startTime = Date.now();
    
    res.on('finish', () => {
      const duration = Date.now() - startTime;
      const { method, originalUrl } = req;
      const { statusCode } = res;
      
      if (originalUrl.includes('/agent/')) {
        this.logger.log(
          `Agent API: ${method} ${originalUrl} ${statusCode} - ${duration}ms`
        );
      }
    });

    next();
  }
}
```

## Best Practices

### 1. Error Handling

```typescript
// src/agent/exceptions/agent.exceptions.ts
export class AgentProcessingException extends Error {
  constructor(
    message: string,
    public readonly agentType: string,
    public readonly userId: string,
    public readonly sessionId: string,
    public readonly originalError?: Error
  ) {
    super(message);
    this.name = 'AgentProcessingException';
  }
}

export class AgentTimeoutException extends AgentProcessingException {
  constructor(agentType: string, userId: string, sessionId: string) {
    super(
      `Agent ${agentType} timed out for user ${userId}`,
      agentType,
      userId,
      sessionId
    );
    this.name = 'AgentTimeoutException';
  }
}
```

### 2. Configuration Management

```typescript
// src/agent/config/agent.config.ts
import { registerAs } from '@nestjs/config';

export default registerAs('agent', () => ({
  maxIterations: parseInt(process.env.AGENT_MAX_ITERATIONS, 10) || 10,
  timeout: parseInt(process.env.AGENT_TIMEOUT, 10) || 30000,
  memoryTtl: parseInt(process.env.AGENT_MEMORY_TTL, 10) || 3600,
  models: {
    openai: {
      apiKey: process.env.OPENAI_API_KEY,
      model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
      temperature: parseFloat(process.env.OPENAI_TEMPERATURE) || 0.1,
    },
    anthropic: {
      apiKey: process.env.ANTHROPIC_API_KEY,
      model: process.env.ANTHROPIC_MODEL || 'claude-3-5-sonnet-latest',
    },
  },
  features: {
    enableMultiAgent: process.env.ENABLE_MULTI_AGENT === 'true',
    enableHumanInLoop: process.env.ENABLE_HUMAN_IN_LOOP === 'true',
    enableStreaming: process.env.ENABLE_AGENT_STREAMING === 'true',
  },
}));
```

### 3. Testing Strategies

```typescript
// src/agent/agent.service.spec.ts
import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { AgentService } from './agent.service';
import { UserService } from '../user/user.service';

describe('AgentService', () => {
  let service: AgentService;
  let userService: UserService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AgentService,
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string) => {
              const config = {
                'OPENAI_API_KEY': 'test-key',
                'AGENT_MAX_ITERATIONS': 5,
              };
              return config[key];
            }),
          },
        },
        {
          provide: UserService,
          useValue: {
            findById: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get<AgentService>(AgentService);
    userService = module.get<UserService>(UserService);
  });

  it('should process a simple message', async () => {
    const mockUser = { id: '1', name: 'Test User' };
    jest.spyOn(userService, 'findById').mockResolvedValue(mockUser);

    const result = await service.processMessage(
      'Hello, how are you?',
      '1',
      'test-session'
    );

    expect(result).toBeDefined();
    expect(result.response).toBeTruthy();
    expect(result.metadata.userId).toBe('1');
  });

  it('should handle agent errors gracefully', async () => {
    jest.spyOn(userService, 'findById').mockRejectedValue(
      new Error('User not found')
    );

    await expect(
      service.processMessage('Hello', 'invalid-user', 'test-session')
    ).rejects.toThrow();
  });
});
```

## Error Handling and Monitoring

### 1. Comprehensive Error Handling

```typescript
// src/agent/interceptors/agent-error.interceptor.ts
import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Observable, throwError } from 'rxjs';
import { catchError } from 'rxjs/operators';
import { GraphRecursionError } from '@langchain/langgraph';

@Injectable()
export class AgentErrorInterceptor implements NestInterceptor {
  private readonly logger = new Logger(AgentErrorInterceptor.name);

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    return next.handle().pipe(
      catchError(err => {
        this.logger.error(`Agent error: ${err.message}`, err.stack);

        if (err instanceof GraphRecursionError) {
          throw new HttpException(
            'Agent reached maximum iterations limit',
            HttpStatus.TOO_MANY_REQUESTS
          );
        }

        if (err.name === 'TimeoutError') {
          throw new HttpException(
            'Agent processing timeout',
            HttpStatus.REQUEST_TIMEOUT
          );
        }

        throw new HttpException(
          'Agent processing failed',
          HttpStatus.INTERNAL_SERVER_ERROR
        );
      })
    );
  }
}
```

### 2. Performance Monitoring

```typescript
// src/agent/monitoring/agent-metrics.service.ts
import { Injectable } from '@nestjs/common';
import { InjectRedis } from '@nestjs-modules/ioredis';
import Redis from 'ioredis';

@Injectable()
export class AgentMetricsService {
  constructor(@InjectRedis() private readonly redis: Redis) {}

  async recordAgentInvocation(
    agentType: string,
    userId: string,
    duration: number,
    success: boolean
  ) {
    const date = new Date().toISOString().split('T')[0];
    const key = `agent:metrics:${date}`;
    
    await this.redis.hincrby(key, `${agentType}:invocations`, 1);
    await this.redis.hincrby(key, `${agentType}:total_duration`, duration);
    
    if (success) {
      await this.redis.hincrby(key, `${agentType}:successes`, 1);
    } else {
      await this.redis.hincrby(key, `${agentType}:failures`, 1);
    }

    // Set expiration for 30 days
    await this.redis.expire(key, 30 * 24 * 60 * 60);
  }

  async getAgentMetrics(date?: string) {
    const targetDate = date || new Date().toISOString().split('T')[0];
    const key = `agent:metrics:${targetDate}`;
    
    return await this.redis.hgetall(key);
  }
}
```

## Deployment Considerations

### 1. Docker Configuration

```dockerfile
# Add to your existing Dockerfile
# Install additional dependencies for LangGraph
RUN npm install @langchain/langgraph @langchain/core @langchain/openai

# Environment variables for agents
ENV AGENT_MAX_ITERATIONS=10
ENV AGENT_TIMEOUT=30000
ENV ENABLE_MULTI_AGENT=true
```

### 2. Environment-Specific Configuration

```typescript
// src/agent/config/agent-production.config.ts
export const productionAgentConfig = {
  models: {
    openai: {
      model: 'gpt-4o',  // Use more powerful model in production
      temperature: 0.0,  // More deterministic in production
      maxTokens: 4000,
    },
  },
  performance: {
    maxIterations: 15,
    timeout: 45000,  // Longer timeout for complex operations
    enableCaching: true,
    cacheExpiration: 1800,  // 30 minutes
  },
  monitoring: {
    enableMetrics: true,
    enableTracing: true,
    logLevel: 'warn',  // Reduce verbose logging
  },
};
```

### 3. Health Checks

```typescript
// src/agent/health/agent.health.ts
import { Injectable } from '@nestjs/common';
import { HealthIndicator, HealthIndicatorResult, HealthCheckError } from '@nestjs/terminus';
import { AgentService } from '../agent.service';

@Injectable()
export class AgentHealthIndicator extends HealthIndicator {
  constructor(private readonly agentService: AgentService) {
    super();
  }

  async isHealthy(key: string): Promise<HealthIndicatorResult> {
    try {
      // Test basic agent functionality
      const testResponse = await this.agentService.processMessage(
        'Health check',
        'health-check-user',
        'health-check-session'
      );

      const isHealthy = testResponse && testResponse.response;

      const result = this.getStatus(key, isHealthy, {
        lastCheck: new Date().toISOString(),
      });

      if (isHealthy) {
        return result;
      }

      throw new HealthCheckError('Agent health check failed', result);
    } catch (error) {
      throw new HealthCheckError('Agent health check failed', 
        this.getStatus(key, false, { error: error.message })
      );
    }
  }
}
```

## Conclusion

This comprehensive guide provides the foundation for implementing LangGraphJS agents in your NestJS chatbot backend. The modular approach allows you to:

1. **Start Simple**: Begin with basic ReAct agents for straightforward conversational AI
2. **Scale Gradually**: Evolve to multi-agent systems as your requirements grow
3. **Maintain Integration**: Leverage existing NestJS patterns and services
4. **Ensure Reliability**: Implement robust error handling and monitoring
5. **Enable Extensibility**: Build reusable components and patterns

Key benefits of this implementation:

- **Type Safety**: Full TypeScript support with proper typing
- **Modularity**: Clean separation of concerns following NestJS best practices
- **Scalability**: Support for simple to complex multi-agent workflows
- **Monitoring**: Built-in metrics and health checking
- **Flexibility**: Easy to extend and customize for specific use cases

Remember to start with simple implementations and gradually add complexity as needed. The LangGraphJS framework provides powerful capabilities, but the key to success is thoughtful architecture and incremental development.
