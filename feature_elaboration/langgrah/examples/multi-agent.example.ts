/**
 * Multi-Agent System Implementation Example
 * 
 * This example demonstrates how to implement a multi-agent system using LangGraphJS
 * with supervisor patterns and agent handoffs, integrated with your NestJS codebase.
 */

import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
    StateGraph,
    MessagesAnnotation,
    Command,
    createReactAgent
} from '@langchain/langgraph';
import { ChatOpenAI } from '@langchain/openai';
import { MemorySaver } from '@langchain/langgraph-checkpoint';
import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { UserService } from '../../../src/user/user.service';
import { AuthService } from '../../../src/iam/auth/auth.service';

// Define specialized tools for different agents
const createUserManagementTools = (userService: UserService, authService: AuthService) => {
    const getUserProfile = tool(
        async (input: { userId: string }) => {
            const user = await userService.findById(input.userId);
            return JSON.stringify({
                id: user.id,
                name: user.name,
                email: user.email,
                createdAt: user.createdAt,
                status: 'active'
            });
        },
        {
            name: 'getUserProfile',
            description: 'Get detailed user profile information',
            schema: z.object({
                userId: z.string().describe('User ID to fetch profile for'),
            }),
        }
    );

    const updateUserProfile = tool(
        async (input: { userId: string; updates: Record<string, any> }) => {
            // Mock update - implement actual user update logic
            return `User profile updated successfully for user ${input.userId}`;
        },
        {
            name: 'updateUserProfile',
            description: 'Update user profile information',
            schema: z.object({
                userId: z.string(),
                updates: z.record(z.any()).describe('Fields to update'),
            }),
        }
    );

    return [getUserProfile, updateUserProfile];
};

const createSupportTools = () => {
    const createTicket = tool(
        async (input: { userId: string; issue: string; priority: 'low' | 'medium' | 'high' }) => {
            const ticketId = `TICKET-${Date.now()}`;
            return JSON.stringify({
                ticketId,
                userId: input.userId,
                issue: input.issue,
                priority: input.priority,
                status: 'open',
                createdAt: new Date().toISOString()
            });
        },
        {
            name: 'createSupportTicket',
            description: 'Create a support ticket for user issues',
            schema: z.object({
                userId: z.string(),
                issue: z.string().describe('Description of the issue'),
                priority: z.enum(['low', 'medium', 'high']).describe('Priority level'),
            }),
        }
    );

    const searchKnowledgeBase = tool(
        async (input: { query: string }) => {
            // Mock knowledge base search
            const mockArticles = [
                'How to reset your password',
                'Understanding user permissions',
                'Troubleshooting login issues',
                'Managing your account settings'
            ];

            const relevantArticles = mockArticles.filter(article =>
                article.toLowerCase().includes(input.query.toLowerCase())
            );

            return relevantArticles.length > 0
                ? `Found articles: ${relevantArticles.join(', ')}`
                : 'No relevant articles found';
        },
        {
            name: 'searchKnowledgeBase',
            description: 'Search the knowledge base for help articles',
            schema: z.object({
                query: z.string().describe('Search query for knowledge base'),
            }),
        }
    );

    return [createTicket, searchKnowledgeBase];
};

const createAnalyticsTools = () => {
    const getUserAnalytics = tool(
        async (input: { userId: string; timeframe: 'day' | 'week' | 'month' }) => {
            // Mock analytics data
            const mockData = {
                day: { sessions: 5, messages: 23, avgResponseTime: '1.2s' },
                week: { sessions: 28, messages: 145, avgResponseTime: '1.1s' },
                month: { sessions: 120, messages: 687, avgResponseTime: '1.3s' }
            };

            return JSON.stringify(mockData[input.timeframe]);
        },
        {
            name: 'getUserAnalytics',
            description: 'Get user engagement analytics',
            schema: z.object({
                userId: z.string(),
                timeframe: z.enum(['day', 'week', 'month']),
            }),
        }
    );

    const getSystemMetrics = tool(
        async () => {
            return JSON.stringify({
                activeUsers: 1247,
                totalSessions: 3421,
                avgResponseTime: '1.1s',
                systemLoad: '23%',
                timestamp: new Date().toISOString()
            });
        },
        {
            name: 'getSystemMetrics',
            description: 'Get current system performance metrics',
            schema: z.object({}),
        }
    );

    return [getUserAnalytics, getSystemMetrics];
};

// Agent handoff tools
const createHandoffTools = () => {
    const transferToSupport = tool(
        async () => {
            return 'Successfully transferred to support agent';
        },
        {
            name: 'transferToSupport',
            description: 'Transfer conversation to support specialist',
            schema: z.object({}),
            returnDirect: true,
        }
    );

    const transferToUserManagement = tool(
        async () => {
            return 'Successfully transferred to user management agent';
        },
        {
            name: 'transferToUserManagement',
            description: 'Transfer to user management specialist',
            schema: z.object({}),
            returnDirect: true,
        }
    );

    const transferToAnalytics = tool(
        async () => {
            return 'Successfully transferred to analytics agent';
        },
        {
            name: 'transferToAnalytics',
            description: 'Transfer to analytics specialist',
            schema: z.object({}),
            returnDirect: true,
        }
    );

    return [transferToSupport, transferToUserManagement, transferToAnalytics];
};

@Injectable()
export class MultiAgentService {
    private readonly logger = new Logger(MultiAgentService.name);
    private readonly llm: ChatOpenAI;
    private readonly checkpointer: MemorySaver;
    private supervisorGraph: any;
    private networkGraph: any;

    constructor(
        private readonly configService: ConfigService,
        private readonly userService: UserService,
        private readonly authService: AuthService,
    ) {
        this.llm = new ChatOpenAI({
            apiKey: this.configService.get('OPENAI_API_KEY'),
            model: 'gpt-4o',
            temperature: 0.1,
        });

        this.checkpointer = new MemorySaver();
        this.initializeMultiAgentSystems();
    }

    private async initializeMultiAgentSystems() {
        try {
            // Initialize both supervisor and network patterns
            this.supervisorGraph = await this.createSupervisorPattern();
            this.networkGraph = await this.createNetworkPattern();

            this.logger.log('Multi-agent systems initialized successfully');
        } catch (error) {
            this.logger.error('Failed to initialize multi-agent systems', error.stack);
            throw error;
        }
    }

    /**
     * Supervisor Pattern Implementation
     * A central supervisor decides which specialist agent to use
     */
    private async createSupervisorPattern() {
        // Create specialized agents
        const userManagementAgent = createReactAgent({
            llm: this.llm,
            tools: [
                ...createUserManagementTools(this.userService, this.authService),
                ...createHandoffTools().filter(tool => tool.name !== 'transferToUserManagement')
            ],
            prompt: `You are a user management specialist. You help with:
        - User profile management
        - Account settings and updates  
        - User authentication issues
        
        If the user needs support tickets or knowledge base help, transfer to support.
        If they need analytics or metrics, transfer to analytics.
        Always provide helpful and accurate information about user accounts.`,
        });

        const supportAgent = createReactAgent({
            llm: this.llm,
            tools: [
                ...createSupportTools(),
                ...createHandoffTools().filter(tool => tool.name !== 'transferToSupport')
            ],
            prompt: `You are a customer support specialist. You help with:
        - Creating and managing support tickets
        - Searching knowledge base for solutions
        - Troubleshooting common issues
        
        If the user needs account management, transfer to user management.
        If they need analytics, transfer to analytics.
        Always be empathetic and solution-focused.`,
        });

        const analyticsAgent = createReactAgent({
            llm: this.llm,
            tools: [
                ...createAnalyticsTools(),
                ...createHandoffTools().filter(tool => tool.name !== 'transferToAnalytics')
            ],
            prompt: `You are an analytics specialist. You help with:
        - User engagement metrics and analytics
        - System performance metrics
        - Data insights and reporting
        
        If the user needs account help, transfer to user management.
        If they need support, transfer to support.
        Always provide clear, data-driven insights.`,
        });

        // Create supervisor node
        const supervisor = async (state: typeof MessagesAnnotation.State) => {
            const responseSchema = z.object({
                next_agent: z.enum(['user_management', 'support', 'analytics', '__end__'])
                    .describe('Which specialist agent should handle this request'),
                reasoning: z.string().describe('Why this agent was chosen'),
                response: z.string().describe('Brief response to acknowledge the request'),
            });

            const systemPrompt = `You are a supervisor managing three specialist agents:
        
        1. user_management: For user accounts, profiles, authentication, settings
        2. support: For help tickets, troubleshooting, knowledge base searches  
        3. analytics: For metrics, reporting, system performance data
        
        Analyze the user's request and decide which specialist can best help them.
        If the request is a simple greeting or doesn't need specialist help, you can end with '__end__'.`;

            const messages = [
                { role: 'system', content: systemPrompt },
                ...state.messages,
            ];

            const response = await this.llm.withStructuredOutput(responseSchema, {
                name: 'supervisor_router',
            }).invoke(messages);

            this.logger.log(`Supervisor routing to: ${response.next_agent}, reason: ${response.reasoning}`);

            return new Command({
                goto: response.next_agent,
                update: {
                    messages: [{
                        role: 'assistant',
                        content: response.response,
                        name: 'supervisor'
                    }],
                    context: {
                        supervisorReasoning: response.reasoning,
                        routedTo: response.next_agent
                    }
                }
            });
        };

        // Create agent wrapper nodes
        const createAgentNode = (agent: any, name: string) => {
            return async (state: typeof MessagesAnnotation.State) => {
                const result = await agent.invoke({ messages: state.messages });

                return new Command({
                    goto: 'supervisor', // Always return to supervisor after agent execution
                    update: {
                        messages: result.messages,
                        context: { lastAgent: name }
                    }
                });
            };
        };

        // Build the supervisor graph
        return new StateGraph(MessagesAnnotation)
            .addNode('supervisor', supervisor, {
                ends: ['user_management', 'support', 'analytics', '__end__']
            })
            .addNode('user_management', createAgentNode(userManagementAgent, 'user_management'), {
                ends: ['supervisor']
            })
            .addNode('support', createAgentNode(supportAgent, 'support'), {
                ends: ['supervisor']
            })
            .addNode('analytics', createAgentNode(analyticsAgent, 'analytics'), {
                ends: ['supervisor']
            })
            .addEdge('__start__', 'supervisor')
            .compile({ checkpointer: this.checkpointer });
    }

    /**
     * Network Pattern Implementation  
     * Agents can directly communicate with each other
     */
    private async createNetworkPattern() {
        const makeNetworkAgentNode = (params: {
            name: string;
            destinations: string[];
            systemPrompt: string;
            tools: any[];
        }) => {
            return async (state: typeof MessagesAnnotation.State) => {
                const possibleDestinations = ['__end__', ...params.destinations] as const;

                const responseSchema = z.object({
                    response: z.string().describe('Response to the user'),
                    goto: z.enum(possibleDestinations).describe('Next agent to call or __end__'),
                    confidence: z.number().min(0).max(1).describe('Confidence in handling this request'),
                });

                const messages = [
                    { role: 'system', content: params.systemPrompt },
                    ...state.messages,
                ];

                // Use agent with tools
                const agent = createReactAgent({
                    llm: this.llm,
                    tools: params.tools,
                    prompt: params.systemPrompt,
                });

                const agentResult = await agent.invoke({ messages: state.messages });
                const lastMessage = agentResult.messages[agentResult.messages.length - 1];

                // Determine if we should route to another agent
                const routingResponse = await this.llm.withStructuredOutput(responseSchema, {
                    name: 'network_router',
                }).invoke([
                    {
                        role: 'system',
                        content: `Based on the conversation and your response, determine if another agent should handle follow-up questions or if this conversation is complete.`
                    },
                    ...state.messages,
                    lastMessage
                ]);

                return new Command({
                    goto: routingResponse.goto,
                    update: {
                        messages: [{
                            role: 'assistant',
                            content: routingResponse.response,
                            name: params.name
                        }],
                        context: {
                            lastAgent: params.name,
                            confidence: routingResponse.confidence
                        }
                    }
                });
            };
        };

        // Create network agents
        const userAgent = makeNetworkAgentNode({
            name: 'user_specialist',
            destinations: ['support_specialist', 'data_specialist'],
            systemPrompt: `You are a user account specialist in a network of agents. You handle:
        - User profile management and updates
        - Account authentication and security
        - User preferences and settings
        
        Route to 'support_specialist' for help tickets or troubleshooting.
        Route to 'data_specialist' for analytics or reporting needs.
        If you fully resolve the user's request, return '__end__'.`,
            tools: createUserManagementTools(this.userService, this.authService),
        });

        const supportAgent = makeNetworkAgentNode({
            name: 'support_specialist',
            destinations: ['user_specialist', 'data_specialist'],
            systemPrompt: `You are a support specialist in a network of agents. You handle:
        - Support ticket creation and management
        - Knowledge base searches and troubleshooting
        - Customer service issues
        
        Route to 'user_specialist' for account-related issues.
        Route to 'data_specialist' for metrics or analytics needs.
        If you fully resolve the user's request, return '__end__'.`,
            tools: createSupportTools(),
        });

        const dataAgent = makeNetworkAgentNode({
            name: 'data_specialist',
            destinations: ['user_specialist', 'support_specialist'],
            systemPrompt: `You are a data and analytics specialist in a network of agents. You handle:
        - User analytics and engagement metrics
        - System performance monitoring  
        - Data insights and reporting
        
        Route to 'user_specialist' for account management needs.
        Route to 'support_specialist' for customer service issues.
        If you fully resolve the user's request, return '__end__'.`,
            tools: createAnalyticsTools(),
        });

        // Build the network graph
        return new StateGraph(MessagesAnnotation)
            .addNode('user_specialist', userAgent, {
                ends: ['support_specialist', 'data_specialist', '__end__']
            })
            .addNode('support_specialist', supportAgent, {
                ends: ['user_specialist', 'data_specialist', '__end__']
            })
            .addNode('data_specialist', dataAgent, {
                ends: ['user_specialist', 'support_specialist', '__end__']
            })
            .addEdge('__start__', 'user_specialist') // Start with user specialist
            .compile({ checkpointer: this.checkpointer });
    }

    /**
     * Process message using supervisor pattern
     */
    async processSupervisorMessage(
        message: string,
        userId: string,
        sessionId?: string
    ): Promise<{
        response: string;
        metadata: {
            pattern: 'supervisor';
            finalAgent: string;
            reasoning: string;
            userId: string;
            sessionId: string;
        }
    }> {
        try {
            const threadId = sessionId || `supervisor-${userId}-${Date.now()}`;

            const config = {
                configurable: {
                    thread_id: threadId,
                    user_id: userId,
                },
                recursionLimit: 20, // Allow for multiple agent handoffs
            };

            this.logger.log(`Processing supervisor message for user ${userId}`);

            const result = await this.supervisorGraph.invoke({
                messages: [{ role: 'user', content: message }]
            }, config);

            const finalMessage = result.messages[result.messages.length - 1];
            const context = result.context || {};

            return {
                response: finalMessage.content,
                metadata: {
                    pattern: 'supervisor',
                    finalAgent: context.lastAgent || 'supervisor',
                    reasoning: context.supervisorReasoning || 'Direct response',
                    userId,
                    sessionId: threadId,
                }
            };
        } catch (error) {
            this.logger.error(`Supervisor processing error: ${error.message}`, error.stack);
            throw error;
        }
    }

    /**
     * Process message using network pattern
     */
    async processNetworkMessage(
        message: string,
        userId: string,
        sessionId?: string
    ): Promise<{
        response: string;
        metadata: {
            pattern: 'network';
            agentPath: string[];
            finalAgent: string;
            userId: string;
            sessionId: string;
        }
    }> {
        try {
            const threadId = sessionId || `network-${userId}-${Date.now()}`;

            const config = {
                configurable: {
                    thread_id: threadId,
                    user_id: userId,
                },
                recursionLimit: 15,
            };

            this.logger.log(`Processing network message for user ${userId}`);

            // Track the agent path
            const agentPath: string[] = [];

            const stream = await this.networkGraph.stream({
                messages: [{ role: 'user', content: message }]
            }, config);

            let finalResult: any;

            for await (const chunk of stream) {
                const nodeNames = Object.keys(chunk);
                agentPath.push(...nodeNames);
                finalResult = chunk;
            }

            const finalMessage = finalResult.messages?.[finalResult.messages.length - 1] ||
                Object.values(finalResult)[0]?.messages?.slice(-1)[0];

            const context = finalResult.context || Object.values(finalResult)[0]?.context || {};

            return {
                response: finalMessage?.content || 'Processing completed',
                metadata: {
                    pattern: 'network',
                    agentPath: [...new Set(agentPath)], // Remove duplicates
                    finalAgent: context.lastAgent || 'unknown',
                    userId,
                    sessionId: threadId,
                }
            };
        } catch (error) {
            this.logger.error(`Network processing error: ${error.message}`, error.stack);
            throw error;
        }
    }

    /**
     * Get available patterns and their descriptions
     */
    getAvailablePatterns() {
        return {
            supervisor: {
                description: 'Central supervisor routes requests to specialized agents',
                agents: ['user_management', 'support', 'analytics'],
                bestFor: ['complex routing decisions', 'centralized control', 'audit trails']
            },
            network: {
                description: 'Agents communicate directly with each other',
                agents: ['user_specialist', 'support_specialist', 'data_specialist'],
                bestFor: ['collaborative problem solving', 'flexible conversations', 'multi-step processes']
            }
        };
    }

    /**
     * Stream multi-agent responses
     */
    async *streamMultiAgentResponse(
        message: string,
        userId: string,
        pattern: 'supervisor' | 'network' = 'supervisor',
        sessionId?: string
    ): AsyncGenerator<{
        type: 'agent_switch' | 'agent_response' | 'tool_call' | 'complete';
        content: string;
        agent?: string;
        metadata?: any;
    }> {
        try {
            const threadId = sessionId || `stream-${pattern}-${userId}-${Date.now()}`;
            const graph = pattern === 'supervisor' ? this.supervisorGraph : this.networkGraph;

            const config = {
                configurable: {
                    thread_id: threadId,
                    user_id: userId,
                },
            };

            const stream = await graph.stream({
                messages: [{ role: 'user', content: message }]
            }, config);

            for await (const chunk of stream) {
                const nodeNames = Object.keys(chunk);

                for (const nodeName of nodeNames) {
                    const nodeOutput = chunk[nodeName];

                    yield {
                        type: 'agent_switch',
                        content: `Activated agent: ${nodeName}`,
                        agent: nodeName,
                    };

                    if (nodeOutput.messages) {
                        for (const msg of nodeOutput.messages) {
                            if (msg.tool_calls && msg.tool_calls.length > 0) {
                                for (const toolCall of msg.tool_calls) {
                                    yield {
                                        type: 'tool_call',
                                        content: `Using tool: ${toolCall.name}`,
                                        agent: nodeName,
                                        metadata: { toolCall }
                                    };
                                }
                            }

                            if (msg.content) {
                                yield {
                                    type: 'agent_response',
                                    content: msg.content,
                                    agent: nodeName,
                                };
                            }
                        }
                    }
                }
            }

            yield {
                type: 'complete',
                content: `Multi-agent ${pattern} processing completed`,
                metadata: { userId, sessionId: threadId, pattern }
            };

        } catch (error) {
            this.logger.error(`Multi-agent streaming error: ${error.message}`, error.stack);
            yield {
                type: 'complete',
                content: `Error: ${error.message}`,
            };
        }
    }
}

// Example usage and testing
export class MultiAgentExample {
    static async demonstrateUsage(multiAgentService: MultiAgentService) {
        console.log('=== Multi-Agent System Examples ===\n');

        try {
            // Example 1: Supervisor pattern
            console.log('1. Supervisor Pattern - User Management Request:');
            const supervisorResponse1 = await multiAgentService.processSupervisorMessage(
                'I need to update my profile information and see my account details',
                'user-456',
                'supervisor-demo-1'
            );
            console.log('Response:', supervisorResponse1.response);
            console.log('Metadata:', supervisorResponse1.metadata);
            console.log('');

            // Example 2: Supervisor pattern - Support request
            console.log('2. Supervisor Pattern - Support Request:');
            const supervisorResponse2 = await multiAgentService.processSupervisorMessage(
                'I\'m having trouble logging in and need to create a support ticket',
                'user-456',
                'supervisor-demo-1'
            );
            console.log('Response:', supervisorResponse2.response);
            console.log('Final Agent:', supervisorResponse2.metadata.finalAgent);
            console.log('');

            // Example 3: Network pattern
            console.log('3. Network Pattern - Analytics Request:');
            const networkResponse = await multiAgentService.processNetworkMessage(
                'Can you show me my usage analytics and also help me update my notification settings?',
                'user-789',
                'network-demo-1'
            );
            console.log('Response:', networkResponse.response);
            console.log('Agent Path:', networkResponse.metadata.agentPath);
            console.log('');

            // Example 4: Available patterns
            console.log('4. Available Patterns:');
            const patterns = multiAgentService.getAvailablePatterns();
            console.log(JSON.stringify(patterns, null, 2));

        } catch (error) {
            console.error('Multi-agent demo error:', error.message);
        }
    }

    static async demonstrateStreaming(multiAgentService: MultiAgentService) {
        console.log('=== Multi-Agent Streaming Example ===\n');

        try {
            console.log('Streaming supervisor pattern for complex request:');
            console.log('Request: "I need help with my account, want to see analytics, and might need support"');
            console.log('Stream output:');

            const stream = multiAgentService.streamMultiAgentResponse(
                'I need help with my account, want to see analytics, and might need support',
                'user-streaming',
                'supervisor',
                'stream-demo-1'
            );

            for await (const chunk of stream) {
                console.log(`[${chunk.type}] ${chunk.agent ? `(${chunk.agent})` : ''}: ${chunk.content}`);
            }

        } catch (error) {
            console.error('Multi-agent streaming demo error:', error.message);
        }
    }
}
