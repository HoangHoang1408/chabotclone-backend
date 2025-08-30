# PostgreSQL Saver Implementation in LangGraph

This guide covers the implementation and usage of PostgreSQL as a checkpoint saver and store backend for LangGraph applications. PostgreSQL provides robust, production-ready persistence for LangGraph workflows, enabling durable state management and cross-thread memory sharing.

## Table of Contents

1. [Overview](#overview)
2. [Installation](#installation)
3. [Basic Setup](#basic-setup)
4. [Synchronous Usage](#synchronous-usage)
5. [Asynchronous Usage](#asynchronous-usage)
6. [Advanced Features](#advanced-features)
7. [Best Practices](#best-practices)
8. [Examples](#examples)
9. [Troubleshooting](#troubleshooting)

## Overview

LangGraph PostgreSQL integration provides two main components:

- **PostgresSaver**: For checkpointing workflow state (thread-level persistence)
- **PostgresStore**: For cross-thread memory and data sharing

This implementation offers:
- ACID compliance and data durability
- Scalability for production workloads
- Support for both sync and async operations
- Automatic table creation and schema management
- Integration with LangGraph's persistence framework

## Installation

### Python Dependencies

```bash
# Core LangGraph with PostgreSQL support
pip install -U "psycopg[binary,pool]" langgraph langgraph-checkpoint-postgres

# For encrypted checkpoints (optional)
pip install pycryptodome
```

### JavaScript/TypeScript Dependencies

```bash
npm install @langchain/langgraph-checkpoint-postgres
```

## Basic Setup

### Database Connection

```python
from langgraph.checkpoint.postgres import PostgresSaver
from langgraph.store.postgres import PostgresStore

# Connection string format
DB_URI = "postgresql://username:password@localhost:5432/database_name?sslmode=disable"

# Initialize saver and store
checkpointer = PostgresSaver.from_conn_string(DB_URI)
store = PostgresStore.from_conn_string(DB_URI)

# Setup database tables (required on first use)
checkpointer.setup()
store.setup()
```

### Environment Variables

```bash
# For encrypted checkpoints
export LANGGRAPH_AES_KEY="your_aes_key_here"

# For custom PostgreSQL instances (self-hosted)
export POSTGRES_URI_CUSTOM="postgres://user:pass@/db?host=hostname"
```

## Synchronous Usage

### Basic Checkpoint Operations

```python
from langgraph.checkpoint.postgres import PostgresSaver

# Configuration for thread management
write_config = {"configurable": {"thread_id": "1", "checkpoint_ns": ""}}
read_config = {"configurable": {"thread_id": "1"}}

DB_URI = "postgresql://postgres:postgres@localhost:5432/postgres?sslmode=disable"

with PostgresSaver.from_conn_string(DB_URI) as checkpointer:
    # Initialize database tables
    checkpointer.setup()
    
    # Sample checkpoint data
    checkpoint = {
        "v": 4,
        "ts": "2024-07-31T20:14:19.804150+00:00",
        "id": "1ef4f797-8335-6428-8001-8a1503f9b875",
        "channel_values": {
            "my_key": "meow",
            "node": "node"
        },
        "channel_versions": {
            "__start__": 2,
            "my_key": 3,
            "start:node": 3,
            "node": 3
        },
        "versions_seen": {
            "__input__": {},
            "__start__": {"__start__": 1},
            "node": {"start:node": 2}
        },
        "pending_sends": []
    }

    # Store checkpoint
    checkpointer.put(write_config, checkpoint, {}, {})

    # Retrieve checkpoint
    loaded_checkpoint = checkpointer.get(read_config)

    # List all checkpoints
    checkpoints = list(checkpointer.list(read_config))
```

### Integration with LangGraph

```python
from langgraph.graph import StateGraph, MessagesState, START
from langgraph.checkpoint.postgres import PostgresSaver

# Setup checkpointer
DB_URI = "postgresql://postgres:postgres@localhost:5432/postgres?sslmode=disable"
checkpointer = PostgresSaver.from_conn_string(DB_URI)
checkpointer.setup()

# Define graph
builder = StateGraph(MessagesState)
builder.add_node("call_model", call_model)
builder.add_edge(START, "call_model")

# Compile with PostgreSQL checkpointer
graph = builder.compile(checkpointer=checkpointer)

# Execute with thread configuration
config = {"configurable": {"thread_id": "user_session_123"}}
result = graph.invoke({"messages": [{"role": "user", "content": "Hello"}]}, config=config)
```

## Asynchronous Usage

### Async Checkpoint Operations

```python
from langgraph.checkpoint.postgres.aio import AsyncPostgresSaver

async def main():
    write_config = {"configurable": {"thread_id": "1", "checkpoint_ns": ""}}
    read_config = {"configurable": {"thread_id": "1"}}
    
    DB_URI = "postgresql://postgres:postgres@localhost:5432/postgres?sslmode=disable"
    
    async with AsyncPostgresSaver.from_conn_string(DB_URI) as checkpointer:
        # Initialize database tables
        await checkpointer.asetup()
        
        checkpoint = {
            "v": 4,
            "ts": "2024-07-31T20:14:19.804150+00:00",
            "id": "1ef4f797-8335-6428-8001-8a1503f9b875",
            "channel_values": {"my_key": "meow", "node": "node"},
            "channel_versions": {"__start__": 2, "my_key": 3, "start:node": 3, "node": 3},
            "versions_seen": {"__input__": {}, "__start__": {"__start__": 1}, "node": {"start:node": 2}},
            "pending_sends": []
        }

        # Store checkpoint
        await checkpointer.aput(write_config, checkpoint, {}, {})

        # Retrieve checkpoint
        loaded_checkpoint = await checkpointer.aget(read_config)

        # List all checkpoints
        checkpoints = [c async for c in checkpointer.alist(read_config)]

# Run async function
import asyncio
asyncio.run(main())
```

### Async Graph Integration

```python
from langgraph.graph import StateGraph, MessagesState, START
from langgraph.checkpoint.postgres.aio import AsyncPostgresSaver

async def setup_async_graph():
    # Setup async checkpointer
    DB_URI = "postgresql://postgres:postgres@localhost:5432/postgres?sslmode=disable"
    checkpointer = AsyncPostgresSaver.from_conn_string(DB_URI)
    await checkpointer.asetup()
    
    # Define graph
    builder = StateGraph(MessagesState)
    builder.add_node("call_model", call_model)
    builder.add_edge(START, "call_model")
    
    # Compile with async checkpointer
    graph = builder.compile(checkpointer=checkpointer)
    
    # Execute asynchronously
    config = {"configurable": {"thread_id": "async_session_123"}}
    result = await graph.ainvoke(
        {"messages": [{"role": "user", "content": "Hello"}]}, 
        config=config
    )
    return result
```

## Advanced Features

### Encrypted Checkpoints

```python
from langgraph.checkpoint.serde.encrypted import EncryptedSerializer
from langgraph.checkpoint.postgres import PostgresSaver

# Setup encrypted serializer
serde = EncryptedSerializer.from_pycryptodome_aes()  # reads LANGGRAPH_AES_KEY

# Initialize encrypted checkpointer
checkpointer = PostgresSaver.from_conn_string(DB_URI, serde=serde)
checkpointer.setup()
```

### TTL Configuration

```python
# Configure TTL for checkpoint expiration
ttl_config = {
    "default_ttl": 60,        # Default TTL in minutes
    "refresh_on_read": True    # Refresh TTL when checkpoint is read
}

# Use with PostgreSQL checkpointer
with PostgresSaver.from_conn_string(DB_URI, ttl=ttl_config) as checkpointer:
    checkpointer.setup()
    # Use the checkpointer...
```

### Custom Connection Management

```python
import psycopg

# For manual connection management
DB_URI = "postgresql://postgres:postgres@localhost:5432/postgres?sslmode=disable"

# ✅ Correct setup with required parameters
with psycopg.connect(DB_URI, autocommit=True, row_factory=dict_row) as conn:
    checkpointer = PostgresSaver(conn)
    checkpointer.setup()
    # Use the checkpointer...

# ❌ This will fail - missing required parameters
with psycopg.connect(DB_URI) as conn:  # Missing autocommit=True and row_factory=dict_row
    checkpointer = PostgresSaver(conn)
    checkpointer.setup()  # May not persist tables properly
```

## Best Practices

### 1. Connection Management

- Use connection pooling for production applications
- Always call `.setup()` on first use
- Use context managers (`with` statements) for automatic cleanup
- Set appropriate connection timeouts and retry policies

### 2. Thread Management

- Use meaningful `thread_id` values (e.g., user IDs, session IDs)
- Implement proper thread cleanup for expired sessions
- Consider TTL policies for automatic cleanup

### 3. Error Handling

```python
try:
    with PostgresSaver.from_conn_string(DB_URI) as checkpointer:
        checkpointer.setup()
        # Use checkpointer...
except psycopg.Error as e:
    logger.error(f"Database connection error: {e}")
    # Implement fallback or retry logic
except Exception as e:
    logger.error(f"Unexpected error: {e}")
    # Handle other errors
```

### 4. Performance Optimization

- Use appropriate database indexes
- Implement connection pooling
- Consider read replicas for read-heavy workloads
- Monitor query performance and optimize slow queries

### 5. Security

- Use encrypted connections (SSL/TLS)
- Implement proper authentication and authorization
- Use encrypted serializers for sensitive data
- Regularly rotate database credentials

## Examples

### Complete Chatbot with PostgreSQL Persistence

```python
import uuid
from langchain_anthropic import ChatAnthropic
from langchain_core.runnables import RunnableConfig
from langchain_core.messages import BaseMessage
from langgraph.func import entrypoint, task
from langgraph.graph import add_messages
from langgraph.checkpoint.postgres import PostgresSaver
from langgraph.store.postgres import PostgresStore

# Initialize model
model = ChatAnthropic(model="claude-3-5-sonnet-latest")

@task
def call_model(messages: list[BaseMessage], memory_store: PostgresStore, user_id: str):
    namespace = ("memories", user_id)
    last_message = messages[-1]
    
    # Search for relevant memories
    memories = memory_store.search(namespace, query=str(last_message.content))
    info = "\n".join([d.value["data"] for d in memories])
    system_msg = f"You are a helpful assistant talking to the user. User info: {info}"

    # Store new memories if requested
    if "remember" in last_message.content.lower():
        memory = "User name is Bob"
        memory_store.put(namespace, str(uuid.uuid4()), {"data": memory})

    response = model.invoke([{"role": "system", "content": system_msg}] + messages)
    return response

# Setup PostgreSQL connections
DB_URI = "postgresql://postgres:postgres@localhost:5432/postgres?sslmode=disable"

checkpointer = PostgresSaver.from_conn_string(DB_URI)
checkpointer.setup()

store = PostgresStore.from_conn_string(DB_URI)
store.setup()

# Define workflow with persistence
@entrypoint(checkpointer=checkpointer, store=store)
def workflow(
    inputs: list[BaseMessage],
    *,
    previous: list[BaseMessage],
    config: RunnableConfig,
    store: PostgresStore,
):
    user_id = config["configurable"]["user_id"]
    previous = previous or []
    inputs = add_messages(previous, inputs)
    response = call_model(inputs, store, user_id).result()
    return entrypoint.final(value=response, save=add_messages(inputs, response))

# Execute workflow
config = {"configurable": {"thread_id": "1", "user_id": "1"}}
result = workflow.invoke(
    [{"role": "user", "content": "Hi! Remember: my name is Bob"}], 
    config=config
)
```

### Multi-Agent System with Shared Memory

```python
from langgraph.graph import StateGraph, MessagesState, START
from langgraph.checkpoint.postgres import PostgresSaver
from langgraph.store.postgres import PostgresStore

class RouterState(MessagesState):
    route: Literal["weather", "general"]

def router_node(state: RouterState):
    # Route logic implementation
    pass

def weather_agent(state: RouterState):
    # Weather-specific logic
    pass

def general_agent(state: RouterState):
    # General conversation logic
    pass

# Setup PostgreSQL
DB_URI = "postgresql://postgres:postgres@localhost:5432/postgres?sslmode=disable"
checkpointer = PostgresSaver.from_conn_string(DB_URI)
checkpointer.setup()

store = PostgresStore.from_conn_string(DB_URI)
store.setup()

# Build graph
graph = StateGraph(RouterState)
graph.add_node("router", router_node)
graph.add_node("weather", weather_agent)
graph.add_node("general", general_agent)
graph.add_edge(START, "router")
graph.add_conditional_edges("router", route_after_prediction)
graph.add_edge("weather", END)
graph.add_edge("general", END)

# Compile with persistence
compiled_graph = graph.compile(checkpointer=checkpointer, store=store)
```

## Troubleshooting

### Common Issues

1. **Connection Errors**
   - Verify database credentials and connection string
   - Check network connectivity and firewall settings
   - Ensure database is running and accessible

2. **Table Creation Failures**
   - Ensure user has CREATE TABLE permissions
   - Check for existing tables with conflicting names
   - Verify database schema compatibility

3. **Performance Issues**
   - Monitor database query performance
   - Check for missing indexes
   - Consider connection pooling for high concurrency

4. **Memory Issues**
   - Monitor checkpoint size and growth
   - Implement TTL policies for automatic cleanup
   - Consider archiving old checkpoints

### Debugging Tips

```python
# Enable detailed logging
import logging
logging.basicConfig(level=logging.DEBUG)

# Check checkpoint state
config = {"configurable": {"thread_id": "debug_thread"}}
checkpoints = list(checkpointer.list(config))
print(f"Found {len(checkpoints)} checkpoints")

# Verify database tables
import psycopg
with psycopg.connect(DB_URI) as conn:
    with conn.cursor() as cur:
        cur.execute("SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'")
        tables = cur.fetchall()
        print(f"Available tables: {tables}")
```

### Monitoring and Metrics

- Monitor database connection pool usage
- Track checkpoint creation and retrieval rates
- Monitor database performance metrics
- Set up alerts for connection failures or performance degradation

## Conclusion

PostgreSQL integration with LangGraph provides a robust, scalable foundation for production applications requiring persistent state management. By following the patterns and best practices outlined in this guide, developers can build reliable, performant LangGraph applications with enterprise-grade persistence capabilities.

For additional information, refer to:
- [LangGraph PostgreSQL Documentation](https://github.com/langchain-ai/langgraph/tree/main/libs/checkpoint-postgres)
- [LangGraph Persistence Concepts](https://langchain-ai.github.io/langgraph/docs/concepts/persistence/)
- [PostgreSQL Official Documentation](https://www.postgresql.org/docs/)
