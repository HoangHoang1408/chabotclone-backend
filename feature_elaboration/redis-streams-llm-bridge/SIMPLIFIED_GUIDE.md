# Redis Streams LLM Bridge - Simplified Guide

## 🎯 What is this and why do we need it?

Imagine you have an AI service that generates text word by word (like ChatGPT), and you want to show this text to users in real-time as it's being generated. The problem is:

1. **AI service** generates tokens (words/characters) one by one
2. **Your server** needs to receive these tokens
3. **Client** (browser/app) needs to see tokens as they arrive
4. **You want to process/analyze** the stream data before sending it to clients

**Redis Streams** acts as a "middleman" that stores and manages this flow of tokens, making everything reliable and scalable.

## 🏗️ System Overview (Simple Picture)

```
AI Service → Your Server → Redis Stream → Your Server → Client
    ↓           ↓           ↓           ↓         ↓
  Generates   Receives   Stores      Reads     Displays
  tokens      tokens     tokens      tokens    tokens
```

## 🔄 **COMPLETE REQUEST FLOW: Client → Server (Step by Step)**

### **Phase 1: Client Initiates Request** 📱

#### Step 1: User Types Question
```
User types: "Tell me a story about a dragon"
```

#### Step 2: Client Sends HTTP Request
```javascript
// Client sends POST request to server
fetch('/api/chat/start', {
  method: 'POST',
  body: JSON.stringify({
    sessionId: 'user_123',
    modelId: 'gpt-4',
    prompt: 'Tell me a story about a dragon'
  })
});
```

### **Phase 2: Server Receives and Processes Request** 🖥️

#### Step 3: Request Hits NestJS Controller
```typescript
@Post('chat/start')
async startChat(@Body() body: StartChatDto) {
  // Server receives the request here
  const { sessionId, modelId, prompt } = body;
}
```

#### Step 4: Server Creates Client Connection
```typescript
// Connection Manager creates a new connection
const connection = await this.connectionManager.createConnection(
  sessionId,    // 'user_123'
  'sse'         // Server-Sent Events
);

// Connection gets unique ID like: 'sse_1703123456789_abc123'
```

#### Step 5: Server Starts Stream Consumer
```typescript
// Start a consumer for this specific session
await this.streamConsumerService.startConsumer(
  `llm:stream:${sessionId}:${modelId}`,  // 'llm:stream:user_123:gpt-4'
  'llm:consumer:sse',                     // Consumer group name
  connection.id                            // 'sse_1703123456789_abc123'
);
```

#### Step 6: Server Sends Connection Response to Client
```typescript
return {
  connectionId: connection.id,
  sessionId: sessionId,
  status: 'connected',
  streamUrl: `/api/sse/stream/${sessionId}`
};
```

### **Phase 3: Client Establishes Stream Connection** 🔌

#### Step 7: Client Connects to SSE Stream
```javascript
// Client receives connection response and connects to stream
const eventSource = new EventSource(`/api/sse/stream/user_123`);
```

#### Step 8: Server Sets Up SSE Response
```typescript
@Sse('stream/:sessionId')
async streamEvents(@Param('sessionId') sessionId: string) {
  // Set up SSE headers
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
}
```

### **Phase 4: Server Calls AI Service** 🤖

#### Step 9: Server Makes Request to AI Service
```typescript
// Server calls external AI service (OpenAI, Anthropic, etc.)
const aiResponse = await this.aiService.generateStream({
  model: modelId,
  prompt: prompt,
  sessionId: sessionId
});
```

#### Step 10: AI Service Starts Generating Tokens
```
AI Service starts generating: "Once" → "upon" → "a" → "time" → "there" → "was"...
```

### **Phase 5: Server Stores Tokens in Redis Stream** 📦

#### Step 11: Each Token Gets Stored
```typescript
// For each token from AI service
for (const token of aiResponse.tokens) {
  // Producer puts token in Redis Stream
  await this.streamProducer.produceToken(
    sessionId,    // 'user_123'
    modelId,      // 'gpt-4'
    token,        // 'Once', 'upon', 'a', etc.
    {
      timestamp: Date.now(),
      sequence: tokenNumber
    }
  );
}
```

#### Step 12: Redis Stores Token
```
Redis Stream 'llm:stream:user_123:gpt-4' now contains:
- ID: 1703123456789-1, Data: "Once"
- ID: 1703123456789-2, Data: "upon"  
- ID: 1703123456789-3, Data: "a"
- ID: 1703123456789-4, Data: "time"
```

### **Phase 6: Server Reads and Processes Tokens** 🔍

#### Step 13: Consumer Reads from Stream
```typescript
// Consumer polls Redis Stream every 100ms
const messages = await this.redisService.xreadgroup(
  'GROUP', 'llm:consumer:sse', connection.id,
  'COUNT', '10', 'BLOCK', '1000',
  'STREAMS', streamKey, '>'
);
```

#### Step 14: Stream Processor Analyzes Token
```typescript
// Process each token (logging, analytics, rate limiting)
const processedMessage = await this.streamProcessor.processMessage(message);
// - Logs the token
// - Counts total tokens
// - Checks rate limits
// - Updates analytics
```

### **Phase 7: Server Delivers Tokens to Client** 📤

#### Step 15: Connection Manager Finds Right Client
```typescript
// Find all connections for this session
const connections = this.connectionManager.getConnectionsForSession(sessionId);
// Returns: [connection with ID 'sse_1703123456789_abc123']
```

#### Step 16: Server Sends Token via SSE
```typescript
// Send token to client
await connection.send({
  type: 'token',
  data: {
    content: 'Once',
    sequence: 1,
    timestamp: Date.now()
  }
});
```

#### Step 17: Client Receives Token
```javascript
// Client receives the token
eventSource.onmessage = (event) => {
  const token = JSON.parse(event.data);
  console.log('New token:', token.content); // "Once"
  // Display token in UI
  displayToken(token.content);
};
```

### **Phase 8: Server Acknowledges Delivery** ✅

#### Step 18: Consumer Acknowledges Message
```typescript
// Tell Redis this message was successfully delivered
await this.redisService.xack(
  streamKey,           // 'llm:stream:user_123:gpt-4'
  consumerGroup,       // 'llm:consumer:sse'
  messageId            // '1703123456789-1'
);
```

#### Step 19: Redis Removes Acknowledged Message
```
Redis now only has unacknowledged messages:
- ID: 1703123456789-2, Data: "upon"  (not delivered yet)
- ID: 1703123456789-3, Data: "a"     (not delivered yet)
- ID: 1703123456789-4, Data: "time"  (not delivered yet)
```

### **Phase 9: Process Continues Until Complete** 🔄

#### Step 20: Loop Continues for Each Token
```
This process repeats for each token:
"upon" → "a" → "time" → "there" → "was" → "a" → "dragon"...
```

#### Step 21: AI Service Finishes Generation
```
AI Service sends: "dragon." (with finish reason: "stop")
```

#### Step 22: Server Marks Stream Complete
```typescript
await this.streamProducer.markStreamComplete(
  sessionId,    // 'user_123'
  modelId,      // 'gpt-4'
  'stop'        // Finish reason
);
```

#### Step 23: Client Receives Completion Signal
```javascript
// Client receives completion message
eventSource.onmessage = (event) => {
  const message = JSON.parse(event.data);
  if (message.type === 'complete') {
    console.log('Stream completed');
    eventSource.close();
  }
};
```

## 🎯 **What Happens at Each Server Component**

### **Controller Layer** 🎮
- Receives HTTP requests
- Validates input data
- Calls appropriate services
- Returns responses

### **Connection Manager** 🔗
- Creates new client connections
- Maps session IDs to connections
- Tracks connection health
- Cleans up dead connections

### **Stream Producer** 📤
- Takes tokens from AI service
- Formats them for Redis
- Stores them in appropriate streams
- Handles errors gracefully

### **Redis Stream** 📦
- Stores tokens with unique IDs
- Maintains order and sequence
- Handles consumer groups
- Manages memory and retention

### **Stream Consumer** 📥
- Polls Redis for new messages
- Processes messages in batches
- Delivers tokens to clients
- Acknowledges successful delivery

### **Stream Processor** ⚙️
- Analyzes token data
- Logs activities
- Updates metrics
- Applies business rules

### **Health Monitor** 🏥
- Checks Redis connectivity
- Monitors consumer health
- Tracks connection status
- Alerts on issues

## 🚨 **Error Handling at Each Step**

### **Client Connection Fails**
1. Connection Manager detects failure
2. Removes connection from active list
3. Consumer stops sending to that connection
4. Client gets error and can retry

### **AI Service Fails**
1. Stream Producer catches error
2. Marks stream as failed
3. Client receives error message
4. Tokens already in Redis are safe

### **Redis Goes Down**
1. Health Monitor detects issue
2. Alerts administrators
3. All operations fail gracefully
4. System waits for Redis recovery

### **Consumer Crashes**
1. Health Monitor detects dead consumer
2. Automatically restarts consumer
3. Consumer resumes from last acknowledged position
4. No tokens are lost

## 🎉 **Summary of the Complete Flow**

1. **Client** sends chat request → **Controller** receives it
2. **Connection Manager** creates connection → **Consumer** starts listening
3. **AI Service** generates tokens → **Producer** stores them in **Redis**
4. **Consumer** reads tokens → **Processor** analyzes them
5. **Connection Manager** finds client → **SSE** delivers tokens
6. **Consumer** acknowledges → **Redis** removes delivered tokens
7. **Process repeats** until AI finishes → **Stream completes**

This creates a **reliable, scalable pipeline** where:
- ✅ No tokens are lost
- ✅ Multiple clients can connect
- ✅ System handles failures gracefully
- ✅ Data can be processed and analyzed
- ✅ Everything is monitored and observable
