/**
 * Complete NestJS Integration Example
 * 
 * This example shows how to fully integrate LangGraphJS agents into your existing
 * NestJS chatbot backend, following all established patterns and conventions.
 */

import {
    Controller,
    Post,
    Get,
    Body,
    Param,
    UseGuards,
    UseInterceptors,
    HttpException,
    HttpStatus,
    Logger,
    Module,
    Injectable,
    NestMiddleware,
    CanActivate,
    ExecutionContext
} from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { Request, Response, NextFunction } from 'express';
import { InjectRedis } from '@nestjs-modules/ioredis';
import Redis from 'ioredis';
import { Reflector } from '@nestjs/core';

// Import your existing modules and services
import { AuthGuard } from '../../../src/iam/auth/guards/auth.guard';
import { CurrentUser } from '../../../src/iam/auth/decorators/current-user.decorator';
import { User } from '../../../src/user/entities/user.entity';
import { UserService } from '../../../src/user/user.service';
import { AuthService } from '../../../src/iam/auth/auth.service';

// LangGraphJS imports
import { createReactAgent } from '@langchain/langgraph/prebuilt';
import { ChatOpenAI } from '@langchain/openai';
import { MemorySaver } from '@langchain/langgraph-checkpoint';
import { tool } from '@langchain/core/tools';
import { z } from 'zod';

// =====================
// DTOs and Interfaces
// =====================

export class ChatMessageDto {
    message: string;
    sessionId?: string;
    agentType?: 'basic' | 'multi_agent' | 'supervisor' | 'network';
    context?: Record<string, any>;
}

export class StreamChatDto {
    message: string;
    sessionId: string;
    enableStreaming: boolean = true;
}

export class ChatResponseDto {
    success: boolean;
    response: string;
    sessionId: string;
    metadata: {
        userId: string;
        agentType: string;
        processingTime: number;
        toolsUsed: string[];
        timestamp: string;
    };
    error?: string;
}

export interface AgentMetrics {
    totalInvocations: number;
    averageResponseTime: number;
    successRate: number;
    toolUsageStats: Record<string, number>;
}

// =====================
// Custom Decorators
// =====================

export const AgentRateLimit = (limit: number = 10) => {
    return (target: any, propertyName: string, descriptor: PropertyDescriptor) => {
        // This would be implemented with a custom decorator
        // that works with the AgentRateLimitGuard
    };
};

// =====================
// Guards and Middleware
// =====================

@Injectable()
export class AgentRateLimitGuard implements CanActivate {
    private readonly logger = new Logger(AgentRateLimitGuard.name);

    constructor(
        private reflector: Reflector,
        @InjectRedis() private readonly redis: Redis,
    ) { }

    async canActivate(context: ExecutionContext): Promise<boolean> {
        const request = context.switchToHttp().getRequest();
        const userId = request.user?.id;

        if (!userId) {
            return false;
        }

        const key = `agent_rate_limit:${userId}`;
        const limit = 20; // 20 requests per minute for agents
        const ttl = 60;

        try {
            const current = await this.redis.incr(key);

            if (current === 1) {
                await this.redis.expire(key, ttl);
            }

            if (current > limit) {
                this.logger.warn(`Rate limit exceeded for user ${userId}: ${current}/${limit}`);
                return false;
            }

            return true;
        } catch (error) {
            this.logger.error(`Redis error in rate limit check: ${error.message}`);
            return true; // Fail open for Redis issues
        }
    }
}

@Injectable()
export class AgentLoggingMiddleware implements NestMiddleware {
    private readonly logger = new Logger(AgentLoggingMiddleware.name);

    use(req: Request, res: Response, next: NextFunction) {
        if (!req.originalUrl.includes('/agent/')) {
            return next();
        }

        const startTime = Date.now();
        const originalJson = res.json.bind(res);

        res.json = function (body: any) {
            const duration = Date.now() - startTime;
            const { method, originalUrl } = req;
            const { statusCode } = res;
            const userId = (req as any).user?.id || 'anonymous';

            // Log structured data for agent requests
            const logData = {
                method,
                url: originalUrl,
                statusCode,
                duration,
                userId,
                agentType: body?.metadata?.agentType,
                success: body?.success,
                timestamp: new Date().toISOString(),
            };

            if (statusCode >= 400) {
                this.logger.error(`Agent API Error: ${JSON.stringify(logData)}`);
            } else {
                this.logger.log(`Agent API: ${method} ${originalUrl} ${statusCode} - ${duration}ms (User: ${userId})`);
            }

            return originalJson(body);
        };

        next();
    }
}

// =====================
// Enhanced Agent Service
// =====================

@Injectable()
export class EnhancedAgentService {
    private readonly logger = new Logger(EnhancedAgentService.name);
    private readonly llm: ChatOpenAI;
    private readonly checkpointer: MemorySaver;
    private agents: Map<string, any> = new Map();
    private metricsService: AgentMetricsService;

    constructor(
        private readonly configService: ConfigService,
        private readonly userService: UserService,
        private readonly authService: AuthService,
        @InjectRedis() private readonly redis: Redis,
    ) {
        this.llm = new ChatOpenAI({
            apiKey: this.configService.get('OPENAI_API_KEY'),
            model: this.configService.get('OPENAI_MODEL', 'gpt-4o-mini'),
            temperature: this.configService.get('OPENAI_TEMPERATURE', 0.1),
        });

        this.checkpointer = new MemorySaver();
        this.metricsService = new AgentMetricsService(this.redis);
        this.initializeAgents();
    }

    private async initializeAgents() {
        try {
            // Enhanced chatbot agent with user context
            this.agents.set('chatbot', await this.createChatbotAgent());

            // Customer support agent
            this.agents.set('support', await this.createSupportAgent());

            // Analytics and insights agent  
            this.agents.set('analytics', await this.createAnalyticsAgent());

            this.logger.log(`Initialized ${this.agents.size} agents successfully`);
        } catch (error) {
            this.logger.error('Failed to initialize agents', error.stack);
            throw error;
        }
    }

    private async createChatbotAgent() {
        const tools = [
            this.createUserProfileTool(),
            this.createUserPreferencesTool(),
            this.createConversationHistoryTool(),
            this.createWeatherTool(),
        ];

        return createReactAgent({
            llm: this.llm,
            tools,
            checkpointer: this.checkpointer,
            prompt: `You are an advanced AI assistant for a chatbot platform. You have access to user profiles and conversation history.

      Core Capabilities:
      - Personalized conversations based on user profile
      - Context-aware responses using conversation history
      - Weather information and general assistance
      - Professional and friendly communication

      Guidelines:
      - Always use the user's name when you know it
      - Reference past conversations when relevant
      - Provide helpful and accurate information
      - Maintain conversation context across sessions
      - Be concise but thorough in your responses

      Remember: You're representing a professional chatbot service, so maintain high quality in all interactions.`,
        });
    }

    private async createSupportAgent() {
        const tools = [
            this.createTicketCreationTool(),
            this.createKnowledgeBaseTool(),
            this.createUserIssueAnalysisTool(),
        ];

        return createReactAgent({
            llm: this.llm,
            tools,
            checkpointer: this.checkpointer,
            prompt: `You are a specialized customer support agent. Your role is to help users with technical issues, account problems, and general inquiries.

      Support Capabilities:
      - Create and track support tickets
      - Search knowledge base for solutions
      - Analyze user issues and provide diagnostics
      - Escalate complex problems when needed

      Support Guidelines:
      - Always be empathetic and patient
      - Gather all necessary information before creating tickets
      - Provide step-by-step troubleshooting when possible
      - Set appropriate expectations for resolution times
      - Follow up on ticket status when relevant`,
        });
    }

    private async createAnalyticsAgent() {
        const tools = [
            this.createUserAnalyticsTool(),
            this.createSystemMetricsTool(),
            this.createUsageReportTool(),
        ];

        return createReactAgent({
            llm: this.llm,
            tools,
            checkpointer: this.checkpointer,
            prompt: `You are a data analytics specialist. You help users understand their usage patterns, system performance, and provide insights.

      Analytics Capabilities:
      - User engagement and usage metrics
      - System performance monitoring
      - Usage trend analysis and reporting
      - Data-driven recommendations

      Analytics Guidelines:
      - Present data in clear, understandable terms
      - Provide context and insights, not just raw numbers
      - Suggest actionable improvements based on data
      - Respect privacy and only show authorized data
      - Use visualizations and comparisons when helpful`,
        });
    }

    // Tool creation methods
    private createUserProfileTool() {
        return tool(
            async (input: { userId: string }) => {
                try {
                    const user = await this.userService.findById(input.userId);
                    return JSON.stringify({
                        id: user.id,
                        name: user.name || 'User',
                        email: user.email,
                        joinedAt: user.createdAt,
                        status: 'active',
                        preferences: user.preferences || {},
                    });
                } catch (error) {
                    return `Unable to fetch user profile: ${error.message}`;
                }
            },
            {
                name: 'getUserProfile',
                description: 'Get comprehensive user profile information',
                schema: z.object({
                    userId: z.string().describe('User ID to fetch profile for'),
                }),
            }
        );
    }

    private createUserPreferencesTool() {
        return tool(
            async (input: { userId: string; preferences?: Record<string, any> }) => {
                try {
                    if (input.preferences) {
                        // Update preferences (mock implementation)
                        await this.redis.hset(
                            `user_preferences:${input.userId}`,
                            Object.entries(input.preferences).flat()
                        );
                        return `Preferences updated successfully`;
                    } else {
                        // Get preferences
                        const prefs = await this.redis.hgetall(`user_preferences:${input.userId}`);
                        return JSON.stringify(prefs);
                    }
                } catch (error) {
                    return `Error managing preferences: ${error.message}`;
                }
            },
            {
                name: 'manageUserPreferences',
                description: 'Get or update user preferences',
                schema: z.object({
                    userId: z.string(),
                    preferences: z.record(z.any()).optional().describe('Preferences to update'),
                }),
            }
        );
    }

    private createConversationHistoryTool() {
        return tool(
            async (input: { userId: string; sessionId: string; limit?: number }) => {
                try {
                    const key = `conversation:${input.userId}:${input.sessionId}`;
                    const messages = await this.redis.lrange(key, 0, input.limit || 10);
                    return JSON.stringify(messages.map(msg => JSON.parse(msg)));
                } catch (error) {
                    return `Unable to fetch conversation history: ${error.message}`;
                }
            },
            {
                name: 'getConversationHistory',
                description: 'Get recent conversation history for context',
                schema: z.object({
                    userId: z.string(),
                    sessionId: z.string(),
                    limit: z.number().optional().describe('Number of messages to retrieve'),
                }),
            }
        );
    }

    private createWeatherTool() {
        return tool(
            async (input: { location: string }) => {
                // Enhanced weather tool with caching
                const cacheKey = `weather:${input.location.toLowerCase()}`;

                try {
                    const cached = await this.redis.get(cacheKey);
                    if (cached) {
                        return cached;
                    }

                    // Mock weather API call
                    const weatherData = {
                        'san francisco': 'Sunny, 72°F (22°C), Clear skies',
                        'new york': 'Partly cloudy, 68°F (20°C), Light breeze',
                        'london': 'Rainy, 60°F (15°C), Heavy rain expected',
                        'tokyo': 'Cloudy, 75°F (24°C), Humidity 65%',
                    };

                    const location = input.location.toLowerCase();
                    const weather = weatherData[location] || `Weather data not available for ${input.location}`;

                    // Cache for 30 minutes
                    await this.redis.setex(cacheKey, 1800, weather);

                    return weather;
                } catch (error) {
                    return `Unable to fetch weather: ${error.message}`;
                }
            },
            {
                name: 'getWeather',
                description: 'Get current weather information for any location',
                schema: z.object({
                    location: z.string().describe('City or location name'),
                }),
            }
        );
    }

    // Additional tool methods for support and analytics agents...
    private createTicketCreationTool() {
        return tool(
            async (input: { userId: string; issue: string; priority: 'low' | 'medium' | 'high'; category: string }) => {
                const ticketId = `TK-${Date.now()}-${Math.random().toString(36).substr(2, 5).toUpperCase()}`;

                const ticket = {
                    id: ticketId,
                    userId: input.userId,
                    issue: input.issue,
                    priority: input.priority,
                    category: input.category,
                    status: 'open',
                    createdAt: new Date().toISOString(),
                    estimatedResolution: this.getEstimatedResolution(input.priority),
                };

                await this.redis.hset(`ticket:${ticketId}`, ticket);
                await this.redis.lpush(`user_tickets:${input.userId}`, ticketId);

                return JSON.stringify({
                    success: true,
                    ticketId,
                    message: `Support ticket ${ticketId} created successfully`,
                    estimatedResolution: ticket.estimatedResolution,
                });
            },
            {
                name: 'createSupportTicket',
                description: 'Create a support ticket for user issues',
                schema: z.object({
                    userId: z.string(),
                    issue: z.string().describe('Detailed description of the issue'),
                    priority: z.enum(['low', 'medium', 'high']),
                    category: z.string().describe('Issue category (e.g., login, billing, technical)'),
                }),
            }
        );
    }

    private createKnowledgeBaseTool() {
        return tool(
            async (input: { query: string; category?: string }) => {
                // Mock knowledge base with categorized articles
                const knowledgeBase = {
                    login: [
                        'How to reset your password',
                        'Troubleshooting login issues',
                        'Two-factor authentication setup',
                    ],
                    billing: [
                        'Understanding your bill',
                        'Payment method updates',
                        'Subscription management',
                    ],
                    technical: [
                        'API documentation and usage',
                        'System requirements',
                        'Performance optimization tips',
                    ],
                    general: [
                        'Getting started guide',
                        'Feature overview',
                        'Best practices',
                    ],
                };

                const query = input.query.toLowerCase();
                let relevantArticles: string[] = [];

                if (input.category && knowledgeBase[input.category]) {
                    relevantArticles = knowledgeBase[input.category].filter(article =>
                        article.toLowerCase().includes(query)
                    );
                } else {
                    // Search across all categories
                    for (const articles of Object.values(knowledgeBase)) {
                        relevantArticles.push(...articles.filter(article =>
                            article.toLowerCase().includes(query)
                        ));
                    }
                }

                return relevantArticles.length > 0
                    ? `Found ${relevantArticles.length} relevant articles:\n${relevantArticles.join('\n')}`
                    : 'No relevant articles found. Consider creating a support ticket for personalized help.';
            },
            {
                name: 'searchKnowledgeBase',
                description: 'Search help articles and documentation',
                schema: z.object({
                    query: z.string().describe('Search terms for knowledge base'),
                    category: z.string().optional().describe('Specific category to search in'),
                }),
            }
        );
    }

    private createUserAnalyticsTool() {
        return tool(
            async (input: { userId: string; timeframe: 'day' | 'week' | 'month' | 'year'; metrics?: string[] }) => {
                try {
                    // Mock analytics data with realistic patterns
                    const timeframes = {
                        day: { sessions: 3, messages: 15, avgSessionTime: '4.2 minutes' },
                        week: { sessions: 18, messages: 89, avgSessionTime: '3.8 minutes' },
                        month: { sessions: 76, messages: 342, avgSessionTime: '4.1 minutes' },
                        year: { sessions: 892, messages: 4156, avgSessionTime: '3.9 minutes' },
                    };

                    const data = timeframes[input.timeframe];
                    const analytics = {
                        timeframe: input.timeframe,
                        userId: input.userId,
                        ...data,
                        engagementScore: Math.floor(Math.random() * 40) + 60, // 60-100
                        topFeatures: ['chat', 'weather queries', 'user profile'],
                        trends: {
                            sessions: input.timeframe === 'day' ? 'stable' : 'increasing',
                            engagement: 'improving',
                        },
                        generatedAt: new Date().toISOString(),
                    };

                    return JSON.stringify(analytics);
                } catch (error) {
                    return `Unable to generate analytics: ${error.message}`;
                }
            },
            {
                name: 'getUserAnalytics',
                description: 'Get user engagement and usage analytics',
                schema: z.object({
                    userId: z.string(),
                    timeframe: z.enum(['day', 'week', 'month', 'year']),
                    metrics: z.array(z.string()).optional().describe('Specific metrics to include'),
                }),
            }
        );
    }

    // Additional private methods...
    private getEstimatedResolution(priority: string): string {
        const resolutionTimes = {
            low: '3-5 business days',
            medium: '1-2 business days',
            high: '4-8 hours',
        };
        return resolutionTimes[priority] || '2-3 business days';
    }

    private createSystemMetricsTool() {
        return tool(
            async () => {
                const metrics = {
                    systemStatus: 'operational',
                    activeUsers: Math.floor(Math.random() * 1000) + 500,
                    totalSessions: Math.floor(Math.random() * 5000) + 2000,
                    averageResponseTime: `${(Math.random() * 0.5 + 0.8).toFixed(1)}s`,
                    systemLoad: `${Math.floor(Math.random() * 30) + 15}%`,
                    uptime: '99.9%',
                    lastUpdated: new Date().toISOString(),
                };
                return JSON.stringify(metrics);
            },
            {
                name: 'getSystemMetrics',
                description: 'Get current system performance metrics',
                schema: z.object({}),
            }
        );
    }

    private createUsageReportTool() {
        return tool(
            async (input: { userId: string; format: 'summary' | 'detailed' }) => {
                const report = {
                    userId: input.userId,
                    format: input.format,
                    reportPeriod: 'Last 30 days',
                    summary: {
                        totalSessions: 45,
                        totalMessages: 203,
                        averageSessionLength: '3.2 minutes',
                        mostActiveDay: 'Tuesday',
                        preferredTime: '2-4 PM',
                    },
                    detailed: input.format === 'detailed' ? {
                        dailyBreakdown: 'Daily usage data...',
                        featureUsage: 'Feature-specific metrics...',
                        performanceInsights: 'Response time and satisfaction scores...',
                    } : null,
                    generatedAt: new Date().toISOString(),
                };
                return JSON.stringify(report);
            },
            {
                name: 'generateUsageReport',
                description: 'Generate comprehensive usage reports',
                schema: z.object({
                    userId: z.string(),
                    format: z.enum(['summary', 'detailed']),
                }),
            }
        );
    }

    private createUserIssueAnalysisTool() {
        return tool(
            async (input: { userId: string; issueDescription: string }) => {
                // Analyze issue and suggest solutions
                const analysis = {
                    issueType: this.categorizeIssue(input.issueDescription),
                    severity: this.assessSeverity(input.issueDescription),
                    suggestedActions: this.getSuggestedActions(input.issueDescription),
                    escalationNeeded: this.shouldEscalate(input.issueDescription),
                    estimatedResolutionTime: '1-3 hours',
                };
                return JSON.stringify(analysis);
            },
            {
                name: 'analyzeUserIssue',
                description: 'Analyze user issues and suggest solutions',
                schema: z.object({
                    userId: z.string(),
                    issueDescription: z.string(),
                }),
            }
        );
    }

    private categorizeIssue(description: string): string {
        const keywords = {
            login: ['login', 'password', 'authentication', 'sign in'],
            technical: ['error', 'bug', 'crash', 'performance'],
            billing: ['payment', 'charge', 'subscription', 'billing'],
            feature: ['feature', 'how to', 'usage', 'functionality'],
        };

        for (const [category, terms] of Object.entries(keywords)) {
            if (terms.some(term => description.toLowerCase().includes(term))) {
                return category;
            }
        }
        return 'general';
    }

    private assessSeverity(description: string): 'low' | 'medium' | 'high' {
        const urgentKeywords = ['urgent', 'critical', 'emergency', 'immediately'];
        const highKeywords = ['important', 'asap', 'soon', 'blocking'];

        const desc = description.toLowerCase();

        if (urgentKeywords.some(word => desc.includes(word))) return 'high';
        if (highKeywords.some(word => desc.includes(word))) return 'medium';
        return 'low';
    }

    private getSuggestedActions(description: string): string[] {
        const actions = [
            'Check system status page',
            'Clear browser cache and cookies',
            'Try logging out and back in',
            'Contact support if issue persists',
        ];
        return actions;
    }

    private shouldEscalate(description: string): boolean {
        const escalationKeywords = ['security', 'data loss', 'payment issue', 'critical'];
        return escalationKeywords.some(keyword =>
            description.toLowerCase().includes(keyword)
        );
    }

    // Main service methods
    async processMessage(
        message: string,
        userId: string,
        sessionId: string,
        agentType: string = 'chatbot',
        context?: Record<string, any>
    ): Promise<ChatResponseDto> {
        const startTime = Date.now();

        try {
            const agent = this.agents.get(agentType);
            if (!agent) {
                throw new Error(`Agent type '${agentType}' not found`);
            }

            // Save message to conversation history
            await this.saveMessageToHistory(userId, sessionId, 'user', message);

            const config = {
                configurable: {
                    thread_id: `${userId}-${sessionId}`,
                    user_id: userId,
                    context: context || {},
                },
                recursionLimit: this.configService.get('AGENT_MAX_ITERATIONS', 10),
            };

            const result = await agent.invoke({
                messages: [{ role: 'user', content: message }]
            }, config);

            const response = result.messages[result.messages.length - 1];
            const processingTime = Date.now() - startTime;

            // Extract tools used
            const toolsUsed = result.messages
                .filter(msg => msg.tool_calls?.length > 0)
                .flatMap(msg => msg.tool_calls.map(call => call.name));

            // Save response to conversation history
            await this.saveMessageToHistory(userId, sessionId, 'assistant', response.content);

            // Record metrics
            await this.metricsService.recordInvocation(agentType, userId, processingTime, true);

            this.logger.log(
                `Agent ${agentType} processed message for user ${userId} in ${processingTime}ms`
            );

            return {
                success: true,
                response: response.content,
                sessionId,
                metadata: {
                    userId,
                    agentType,
                    processingTime,
                    toolsUsed,
                    timestamp: new Date().toISOString(),
                },
            };

        } catch (error) {
            const processingTime = Date.now() - startTime;
            await this.metricsService.recordInvocation(agentType, userId, processingTime, false);

            this.logger.error(`Agent processing error: ${error.message}`, error.stack);

            return {
                success: false,
                response: 'I apologize, but I encountered an error processing your request. Please try again.',
                sessionId,
                metadata: {
                    userId,
                    agentType,
                    processingTime,
                    toolsUsed: [],
                    timestamp: new Date().toISOString(),
                },
                error: error.message,
            };
        }
    }

    private async saveMessageToHistory(
        userId: string,
        sessionId: string,
        role: 'user' | 'assistant',
        content: string
    ) {
        try {
            const key = `conversation:${userId}:${sessionId}`;
            const message = {
                role,
                content,
                timestamp: new Date().toISOString(),
            };

            await this.redis.lpush(key, JSON.stringify(message));
            await this.redis.ltrim(key, 0, 99); // Keep last 100 messages
            await this.redis.expire(key, 7 * 24 * 60 * 60); // 7 days
        } catch (error) {
            this.logger.error(`Failed to save message to history: ${error.message}`);
        }
    }

    async getAgentMetrics(agentType?: string): Promise<AgentMetrics> {
        return this.metricsService.getMetrics(agentType);
    }

    async healthCheck(): Promise<{ status: string; agents: Record<string, boolean> }> {
        const agentStatuses: Record<string, boolean> = {};

        for (const [name, agent] of this.agents.entries()) {
            try {
                await agent.invoke({
                    messages: [{ role: 'user', content: 'health check' }]
                }, {
                    configurable: { thread_id: 'health-check' },
                    recursionLimit: 1
                });
                agentStatuses[name] = true;
            } catch (error) {
                agentStatuses[name] = false;
            }
        }

        const allHealthy = Object.values(agentStatuses).every(status => status);

        return {
            status: allHealthy ? 'healthy' : 'partial',
            agents: agentStatuses,
        };
    }
}

// =====================
// Metrics Service
// =====================

@Injectable()
export class AgentMetricsService {
    constructor(@InjectRedis() private readonly redis: Redis) { }

    async recordInvocation(
        agentType: string,
        userId: string,
        duration: number,
        success: boolean
    ) {
        const date = new Date().toISOString().split('T')[0];
        const key = `agent_metrics:${date}`;

        const multi = this.redis.multi();
        multi.hincrby(key, `${agentType}:invocations`, 1);
        multi.hincrby(key, `${agentType}:total_duration`, duration);
        multi.hincrby(key, `${agentType}:${success ? 'successes' : 'failures'}`, 1);
        multi.expire(key, 30 * 24 * 60 * 60); // 30 days

        await multi.exec();
    }

    async getMetrics(agentType?: string): Promise<AgentMetrics> {
        const date = new Date().toISOString().split('T')[0];
        const key = `agent_metrics:${date}`;
        const data = await this.redis.hgetall(key);

        if (agentType) {
            return this.parseAgentMetrics(data, agentType);
        }

        // Aggregate all agents
        const allAgents = new Set<string>();
        Object.keys(data).forEach(key => {
            const [agent] = key.split(':');
            allAgents.add(agent);
        });

        return this.aggregateMetrics(data, Array.from(allAgents));
    }

    private parseAgentMetrics(data: Record<string, string>, agentType: string): AgentMetrics {
        const prefix = `${agentType}:`;
        const invocations = parseInt(data[`${prefix}invocations`] || '0');
        const totalDuration = parseInt(data[`${prefix}total_duration`] || '0');
        const successes = parseInt(data[`${prefix}successes`] || '0');
        const failures = parseInt(data[`${prefix}failures`] || '0');

        return {
            totalInvocations: invocations,
            averageResponseTime: invocations > 0 ? totalDuration / invocations : 0,
            successRate: invocations > 0 ? successes / invocations : 0,
            toolUsageStats: {}, // This would require additional tracking
        };
    }

    private aggregateMetrics(data: Record<string, string>, agents: string[]): AgentMetrics {
        let totalInvocations = 0;
        let totalDuration = 0;
        let totalSuccesses = 0;

        agents.forEach(agent => {
            totalInvocations += parseInt(data[`${agent}:invocations`] || '0');
            totalDuration += parseInt(data[`${agent}:total_duration`] || '0');
            totalSuccesses += parseInt(data[`${agent}:successes`] || '0');
        });

        return {
            totalInvocations,
            averageResponseTime: totalInvocations > 0 ? totalDuration / totalInvocations : 0,
            successRate: totalInvocations > 0 ? totalSuccesses / totalInvocations : 0,
            toolUsageStats: {},
        };
    }
}

// =====================
// Controller
// =====================

@Controller('agent')
@UseGuards(AuthGuard, AgentRateLimitGuard)
export class AgentController {
    private readonly logger = new Logger(AgentController.name);

    constructor(
        private readonly agentService: EnhancedAgentService,
    ) { }

    @Post('chat')
    async chat(
        @Body() chatDto: ChatMessageDto,
        @CurrentUser() user: User,
    ): Promise<ChatResponseDto> {
        try {
            const sessionId = chatDto.sessionId || `session-${Date.now()}`;

            return await this.agentService.processMessage(
                chatDto.message,
                user.id,
                sessionId,
                chatDto.agentType || 'chatbot',
                chatDto.context
            );
        } catch (error) {
            this.logger.error(`Chat processing error for user ${user.id}: ${error.message}`);
            throw new HttpException(
                'Failed to process chat message',
                HttpStatus.INTERNAL_SERVER_ERROR
            );
        }
    }

    @Post('chat/stream')
    async streamChat(
        @Body() streamDto: StreamChatDto,
        @CurrentUser() user: User,
    ) {
        // Implement streaming response
        // This would typically use Server-Sent Events or WebSockets
        throw new HttpException('Streaming not implemented in this example', HttpStatus.NOT_IMPLEMENTED);
    }

    @Get('metrics')
    async getMetrics(): Promise<{ metrics: AgentMetrics }> {
        const metrics = await this.agentService.getAgentMetrics();
        return { metrics };
    }

    @Get('metrics/:agentType')
    async getAgentTypeMetrics(
        @Param('agentType') agentType: string
    ): Promise<{ metrics: AgentMetrics }> {
        const metrics = await this.agentService.getAgentMetrics(agentType);
        return { metrics };
    }

    @Get('health')
    async healthCheck() {
        return await this.agentService.healthCheck();
    }

    @Get('agents')
    async listAgents() {
        return {
            agents: [
                {
                    type: 'chatbot',
                    description: 'General conversational AI with user context',
                    capabilities: ['conversation', 'user profiles', 'weather', 'preferences']
                },
                {
                    type: 'support',
                    description: 'Customer support specialist',
                    capabilities: ['ticket creation', 'knowledge base', 'issue analysis']
                },
                {
                    type: 'analytics',
                    description: 'Data and analytics specialist',
                    capabilities: ['user analytics', 'system metrics', 'usage reports']
                }
            ]
        };
    }
}

// =====================
// Module Configuration
// =====================

@Module({
    imports: [
        ConfigModule,
        TypeOrmModule.forFeature([User]),
    ],
    providers: [
        EnhancedAgentService,
        AgentMetricsService,
        {
            provide: APP_GUARD,
            useClass: AgentRateLimitGuard,
        },
    ],
    controllers: [AgentController],
    exports: [EnhancedAgentService],
})
export class AgentModule { }

// =====================
// Example Usage
// =====================

export class NestJSIntegrationExample {
    static async demonstrateIntegration() {
        console.log('=== NestJS Integration Example ===\n');
        console.log('This example shows how to integrate LangGraphJS agents into your NestJS application.');
        console.log('');
        console.log('Key Integration Points:');
        console.log('1. Service injection and dependency management');
        console.log('2. Authentication and authorization with existing guards');
        console.log('3. Rate limiting and request monitoring');
        console.log('4. Structured error handling and logging');
        console.log('5. Metrics collection and health monitoring');
        console.log('6. RESTful API endpoints following NestJS conventions');
        console.log('');
        console.log('API Endpoints:');
        console.log('- POST /agent/chat - Main chat interface');
        console.log('- POST /agent/chat/stream - Streaming responses');
        console.log('- GET /agent/metrics - Overall metrics');
        console.log('- GET /agent/metrics/:agentType - Agent-specific metrics');
        console.log('- GET /agent/health - Health check');
        console.log('- GET /agent/agents - List available agents');
        console.log('');
        console.log('Features Demonstrated:');
        console.log('- Integration with existing user service');
        console.log('- Redis-based caching and rate limiting');
        console.log('- Comprehensive error handling');
        console.log('- Metrics and monitoring');
        console.log('- Type safety with DTOs and interfaces');
        console.log('- Professional logging and debugging');
    }
}
