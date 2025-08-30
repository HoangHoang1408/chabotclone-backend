// /**
//  * Basic Agent Implementation Example
//  * 
//  * This example demonstrates how to implement a simple LangGraphJS agent
//  * that integrates with your existing NestJS codebase patterns.
//  */

// import { Injectable, Logger } from '@nestjs/common';
// import { ConfigService } from '@nestjs/config';
// import { createReactAgent } from '@langchain/langgraph/prebuilt';
// import { ChatOpenAI } from '@langchain/openai';
// import { MemorySaver } from '@langchain/langgraph-checkpoint';
// import { tool } from '@langchain/core/tools';
// import { z } from 'zod';
// import { UserService } from '../../../src/user/user.service';

// // Define tools that integrate with your existing services
// const createUserProfileTool = (userService: UserService) => {
//     return tool(
//         async (input: { userId: string }) => {
//             try {
//                 const user = await userService.findById(input.userId);
//                 return JSON.stringify({
//                     id: user.id,
//                     name: user.name || 'Unknown',
//                     joinedAt: user.createdAt,
//                     status: 'active'
//                 });
//             } catch (error) {
//                 return `Error fetching user profile: ${error.message}`;
//             }
//         },
//         {
//             name: 'getUserProfile',
//             description: 'Get user profile information by user ID',
//             schema: z.object({
//                 userId: z.string().describe('The user ID to fetch profile for'),
//             }),
//         }
//     );
// };

// const createWeatherTool = () => {
//     return tool(
//         async (input: { location: string }) => {
//             // Mock weather API call - replace with real weather service
//             const weather = {
//                 'san francisco': 'Sunny, 72°F',
//                 'new york': 'Cloudy, 68°F',
//                 'london': 'Rainy, 60°F',
//             };

//             const location = input.location.toLowerCase();
//             return weather[location] || `Weather data not available for ${input.location}`;
//         },
//         {
//             name: 'getWeather',
//             description: 'Get current weather for a specific location',
//             schema: z.object({
//                 location: z.string().describe('The city or location to get weather for'),
//             }),
//         }
//     );
// };

// @Injectable()
// export class BasicAgentService {
//     private readonly logger = new Logger(BasicAgentService.name);
//     private readonly llm: ChatOpenAI;
//     private readonly checkpointer: MemorySaver;
//     private agent: any;

//     constructor(
//         private readonly configService: ConfigService,
//         private readonly userService: UserService,
//     ) {
//         // Initialize the language model
//         this.llm = new ChatOpenAI({
//             apiKey: this.configService.get('OPENAI_API_KEY'),
//             model: 'gpt-4o-mini',
//             temperature: 0.1,
//         });

//         // Initialize memory for conversation persistence
//         this.checkpointer = new MemorySaver();

//         // Create the agent
//         this.initializeAgent();
//     }

//     private initializeAgent() {
//         try {
//             // Define available tools
//             const tools = [
//                 createUserProfileTool(this.userService),
//                 createWeatherTool(),
//             ];

//             // Create the ReAct agent
//             this.agent = createReactAgent({
//                 llm: this.llm,
//                 tools,
//                 checkpointer: this.checkpointer,
//                 prompt: `You are a helpful AI assistant integrated with a chatbot backend.
        
//         You have access to:
//         - User profile information
//         - Weather data
        
//         Guidelines:
//         - Always be helpful and professional
//         - Use the available tools when relevant to the user's query
//         - If you need user profile information, use the getUserProfile tool
//         - For weather questions, use the getWeather tool
//         - Provide clear and concise responses
        
//         Remember: You're part of a larger system, so maintain context and be consistent.`,
//             });

//             this.logger.log('Basic agent initialized successfully');
//         } catch (error) {
//             this.logger.error('Failed to initialize basic agent', error.stack);
//             throw error;
//         }
//     }

//     /**
//      * Process a message through the agent
//      */
//     async processMessage(
//         message: string,
//         userId: string,
//         sessionId?: string
//     ): Promise<{
//         response: string;
//         metadata: {
//             userId: string;
//             sessionId: string;
//             timestamp: string;
//             toolsUsed: string[];
//         }
//     }> {
//         try {
//             const threadId = sessionId || `session-${userId}-${Date.now()}`;

//             const config = {
//                 configurable: {
//                     thread_id: threadId,
//                     user_id: userId,
//                 },
//                 recursionLimit: this.configService.get('AGENT_MAX_ITERATIONS', 10),
//             };

//             this.logger.log(`Processing message for user ${userId}, session ${threadId}`);

//             const startTime = Date.now();
//             const result = await this.agent.invoke({
//                 messages: [{ role: 'user', content: message }]
//             }, config);

//             const processingTime = Date.now() - startTime;
//             const response = result.messages[result.messages.length - 1];

//             // Extract tools used (if any)
//             const toolsUsed = result.messages
//                 .filter(msg => msg.tool_calls && msg.tool_calls.length > 0)
//                 .flatMap(msg => msg.tool_calls.map(call => call.name));

//             this.logger.log(
//                 `Message processed in ${processingTime}ms, tools used: ${toolsUsed.join(', ') || 'none'}`
//             );

//             return {
//                 response: response.content,
//                 metadata: {
//                     userId,
//                     sessionId: threadId,
//                     timestamp: new Date().toISOString(),
//                     toolsUsed,
//                 }
//             };
//         } catch (error) {
//             this.logger.error(`Error processing message: ${error.message}`, error.stack);
//             throw new Error(`Agent processing failed: ${error.message}`);
//         }
//     }

//     /**
//      * Stream responses for real-time interaction
//      */
//     async *streamResponse(
//         message: string,
//         userId: string,
//         sessionId?: string
//     ): AsyncGenerator<{
//         type: 'token' | 'tool_call' | 'complete';
//         content: string;
//         metadata?: any;
//     }> {
//         try {
//             const threadId = sessionId || `stream-${userId}-${Date.now()}`;

//             const config = {
//                 configurable: {
//                     thread_id: threadId,
//                     user_id: userId,
//                 },
//             };

//             // Stream the agent's execution
//             const stream = await this.agent.stream({
//                 messages: [{ role: 'user', content: message }]
//             }, config);

//             for await (const chunk of stream) {
//                 if (chunk.agent) {
//                     const message = chunk.agent.messages[0];

//                     if (message.tool_calls && message.tool_calls.length > 0) {
//                         for (const toolCall of message.tool_calls) {
//                             yield {
//                                 type: 'tool_call',
//                                 content: `Using tool: ${toolCall.name}`,
//                                 metadata: { toolCall }
//                             };
//                         }
//                     } else if (message.content) {
//                         yield {
//                             type: 'token',
//                             content: message.content,
//                         };
//                     }
//                 }
//             }

//             yield {
//                 type: 'complete',
//                 content: 'Stream completed',
//                 metadata: { userId, sessionId: threadId }
//             };

//         } catch (error) {
//             this.logger.error(`Error streaming response: ${error.message}`, error.stack);
//             yield {
//                 type: 'complete',
//                 content: `Error: ${error.message}`,
//             };
//         }
//     }

//     /**
//      * Get conversation history for a session
//      */
//     async getConversationHistory(
//         userId: string,
//         sessionId: string
//     ): Promise<Array<{ role: string; content: string; timestamp?: string }>> {
//         try {
//             // Access the stored conversation state
//             const config = {
//                 configurable: {
//                     thread_id: sessionId,
//                     user_id: userId,
//                 },
//             };

//             // Get the current state
//             const state = await this.agent.getState(config);

//             return state.values.messages.map(msg => ({
//                 role: msg.role || msg.type,
//                 content: msg.content,
//                 timestamp: msg.timestamp || new Date().toISOString(),
//             }));
//         } catch (error) {
//             this.logger.error(`Error fetching conversation history: ${error.message}`);
//             return [];
//         }
//     }

//     /**
//      * Clear conversation memory for a session
//      */
//     async clearConversation(userId: string, sessionId: string): Promise<void> {
//         try {
//             const config = {
//                 configurable: {
//                     thread_id: sessionId,
//                     user_id: userId,
//                 },
//             };

//             // Update the state to clear messages
//             await this.agent.updateState(config, { messages: [] });

//             this.logger.log(`Cleared conversation for user ${userId}, session ${sessionId}`);
//         } catch (error) {
//             this.logger.error(`Error clearing conversation: ${error.message}`);
//             throw error;
//         }
//     }

//     /**
//      * Health check for the agent
//      */
//     async healthCheck(): Promise<{ status: 'healthy' | 'unhealthy'; details: any }> {
//         try {
//             const testMessage = 'Health check test';
//             const testUserId = 'health-check-user';
//             const testSessionId = 'health-check-session';

//             const startTime = Date.now();
//             const result = await this.processMessage(testMessage, testUserId, testSessionId);
//             const responseTime = Date.now() - startTime;

//             return {
//                 status: 'healthy',
//                 details: {
//                     responseTime,
//                     agentResponded: !!result.response,
//                     timestamp: new Date().toISOString(),
//                 }
//             };
//         } catch (error) {
//             return {
//                 status: 'unhealthy',
//                 details: {
//                     error: error.message,
//                     timestamp: new Date().toISOString(),
//                 }
//             };
//         }
//     }
// }

// // Example usage and testing
// export class BasicAgentExample {
//     static async demonstrateUsage(agentService: BasicAgentService) {
//         console.log('=== Basic Agent Example ===\n');

//         try {
//             // Example 1: Simple conversation
//             console.log('1. Simple conversation:');
//             const response1 = await agentService.processMessage(
//                 'Hello! Can you tell me about yourself?',
//                 'user-123',
//                 'demo-session-1'
//             );
//             console.log('Response:', response1.response);
//             console.log('Metadata:', response1.metadata);
//             console.log('');

//             // Example 2: Using weather tool
//             console.log('2. Weather query (tool usage):');
//             const response2 = await agentService.processMessage(
//                 'What\'s the weather like in San Francisco?',
//                 'user-123',
//                 'demo-session-1'
//             );
//             console.log('Response:', response2.response);
//             console.log('Tools used:', response2.metadata.toolsUsed);
//             console.log('');

//             // Example 3: User profile query
//             console.log('3. User profile query (tool usage):');
//             const response3 = await agentService.processMessage(
//                 'Can you get my profile information?',
//                 'user-123',
//                 'demo-session-1'
//             );
//             console.log('Response:', response3.response);
//             console.log('Tools used:', response3.metadata.toolsUsed);
//             console.log('');

//             // Example 4: Conversation history
//             console.log('4. Conversation history:');
//             const history = await agentService.getConversationHistory('user-123', 'demo-session-1');
//             console.log('History:', history.slice(-3)); // Last 3 messages
//             console.log('');

//             // Example 5: Health check
//             console.log('5. Health check:');
//             const health = await agentService.healthCheck();
//             console.log('Health status:', health);

//         } catch (error) {
//             console.error('Demo error:', error.message);
//         }
//     }

//     static async demonstrateStreaming(agentService: BasicAgentService) {
//         console.log('=== Streaming Example ===\n');

//         try {
//             console.log('Streaming response for: "Tell me about the weather in New York and my profile"');
//             console.log('Stream output:');

//             const stream = agentService.streamResponse(
//                 'Tell me about the weather in New York and my profile',
//                 'user-456',
//                 'stream-session-1'
//             );

//             for await (const chunk of stream) {
//                 console.log(`[${chunk.type}]: ${chunk.content}`);
//             }

//         } catch (error) {
//             console.error('Streaming demo error:', error.message);
//         }
//     }
// }
