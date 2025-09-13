# SSE Client-Side Implementation Example

## React/TypeScript Client Example

```typescript
import { useEffect, useState, useRef } from 'react';

interface StreamMessage {
  id: string;
  data: any;
  timestamp: number;
}

interface StreamResponse {
  jobId: string;
  streamKey: string;
}

export const useChatStream = () => {
  const [messages, setMessages] = useState<StreamMessage[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const eventSourceRef = useRef<EventSource | null>(null);

  const startStream = async (input: {
    conversationId: number;
    message: string;
    model: string;
  }) => {
    try {
      setIsStreaming(true);
      setError(null);
      setMessages([]);

      // Start the agent job
      const response = await fetch('/api/chat-agents/create-simple-agent-job', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${getAuthToken()}`, // Your auth token
        },
        body: JSON.stringify(input),
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const { jobId, streamKey }: StreamResponse = await response.json();

      // Set up SSE connection
      const eventSource = new EventSource(
        `/api/chat-agents/stream?streamKey=${encodeURIComponent(streamKey)}`,
        {
          withCredentials: true, // Include auth cookies
        }
      );

      eventSourceRef.current = eventSource;

      eventSource.onopen = () => {
        console.log('SSE connection opened');
      };

      eventSource.onmessage = (event) => {
        try {
          const message: StreamMessage = JSON.parse(event.data);
          
          setMessages(prev => [...prev, message]);

          // Check for completion
          if (message.data?.metadata?.isComplete) {
            console.log('Stream completed:', message.data);
            setIsStreaming(false);
            eventSource.close();
            
            if (message.data.metadata.error) {
              setError(message.data.message || 'An error occurred during processing');
            }
          }
        } catch (parseError) {
          console.error('Failed to parse message:', parseError);
        }
      };

      eventSource.onerror = (event) => {
        console.error('SSE error:', event);
        setError('Connection error occurred');
        setIsStreaming(false);
        eventSource.close();
      };

      // Cleanup timeout (backup mechanism)
      setTimeout(() => {
        if (eventSource.readyState !== EventSource.CLOSED) {
          console.warn('Force closing SSE connection due to timeout');
          eventSource.close();
          setIsStreaming(false);
        }
      }, 300000); // 5 minutes timeout

    } catch (error) {
      console.error('Failed to start stream:', error);
      setError(error instanceof Error ? error.message : 'Unknown error');
      setIsStreaming(false);
    }
  };

  const stopStream = () => {
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }
    setIsStreaming(false);
  };

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      stopStream();
    };
  }, []);

  return {
    messages,
    isStreaming,
    error,
    startStream,
    stopStream,
  };
};

// Helper function to get auth token
function getAuthToken(): string {
  // Implement your auth token retrieval logic
  return localStorage.getItem('authToken') || '';
}
```

## Vanilla JavaScript Example

```javascript
class ChatStreamClient {
  constructor(baseUrl, authToken) {
    this.baseUrl = baseUrl;
    this.authToken = authToken;
    this.eventSource = null;
    this.onMessage = null;
    this.onError = null;
    this.onComplete = null;
  }

  async startStream(input) {
    try {
      // Start the agent job
      const response = await fetch(`${this.baseUrl}/chat-agents/create-simple-agent-job`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.authToken}`,
        },
        body: JSON.stringify(input),
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const { jobId, streamKey } = await response.json();

      // Set up SSE connection
      this.eventSource = new EventSource(
        `${this.baseUrl}/chat-agents/stream?streamKey=${encodeURIComponent(streamKey)}`,
        {
          withCredentials: true,
        }
      );

      this.eventSource.onopen = () => {
        console.log('SSE connection opened');
      };

      this.eventSource.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data);
          
          if (this.onMessage) {
            this.onMessage(message);
          }

          // Check for completion
          if (message.data?.metadata?.isComplete) {
            console.log('Stream completed:', message.data);
            this.close();
            
            if (this.onComplete) {
              this.onComplete(message.data);
            }
          }
        } catch (parseError) {
          console.error('Failed to parse message:', parseError);
        }
      };

      this.eventSource.onerror = (event) => {
        console.error('SSE error:', event);
        this.close();
        
        if (this.onError) {
          this.onError(new Error('Connection error occurred'));
        }
      };

      return { jobId, streamKey };
    } catch (error) {
      if (this.onError) {
        this.onError(error);
      }
      throw error;
    }
  }

  close() {
    if (this.eventSource) {
      this.eventSource.close();
      this.eventSource = null;
    }
  }
}

// Usage example
const client = new ChatStreamClient('http://localhost:3000/api', 'your-auth-token');

client.onMessage = (message) => {
  console.log('Received:', message);
  // Update your UI
};

client.onComplete = (completionData) => {
  console.log('Stream completed:', completionData);
  // Handle completion
};

client.onError = (error) => {
  console.error('Stream error:', error);
  // Handle error
};

// Start streaming
client.startStream({
  conversationId: 1,
  message: "Hello, how are you?",
  model: "gpt-3.5-turbo"
});
```

## Key Points for Proper SSE Termination

1. **Server-Side Completion Signal**: Always send `metadata.isComplete: true` when the job finishes
2. **Client-Side Completion Detection**: Listen for the completion signal and close the connection
3. **Error Handling**: Send completion signals even for errors
4. **Timeout Protection**: Implement client-side timeouts as backup
5. **Resource Cleanup**: Properly close EventSource connections
6. **Stream Cleanup**: Clean up Redis streams after a reasonable delay

## Connection States

- **CONNECTING (0)**: The connection is not yet open
- **OPEN (1)**: The connection is open and ready to communicate
- **CLOSED (2)**: The connection is closed

Always check `eventSource.readyState` before performing operations.
