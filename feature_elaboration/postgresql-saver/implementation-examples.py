"""
PostgreSQL Saver Implementation Examples for LangGraph

This file contains practical examples demonstrating how to use PostgreSQL
as a checkpoint saver and store backend for LangGraph applications.

Prerequisites:
- PostgreSQL database running
- Required packages: langgraph, langgraph-checkpoint-postgres, psycopg
- Environment variables set (see setup section)
"""

import os
import uuid
import asyncio
from typing import Literal, TypedDict
from datetime import datetime

# LangGraph imports
from langgraph.graph import StateGraph, MessagesState, START, END
from langgraph.checkpoint.postgres import PostgresSaver
from langgraph.checkpoint.postgres.aio import AsyncPostgresSaver
from langgraph.store.postgres import PostgresStore
from langgraph.checkpoint.serde.encrypted import EncryptedSerializer

# LangChain imports (for demonstration)
from langchain_core.messages import HumanMessage, AIMessage, BaseMessage
from langchain_core.runnables import RunnableConfig

# Example 1: Basic PostgreSQL Checkpointer Setup
def basic_postgres_setup():
    """Demonstrates basic setup of PostgreSQL checkpointer."""
    
    # Database connection string
    DB_URI = os.getenv("POSTGRES_URI", "postgresql://postgres:postgres@localhost:5432/langgraph?sslmode=disable")
    
    try:
        # Initialize checkpointer
        with PostgresSaver.from_conn_string(DB_URI) as checkpointer:
            # Setup database tables (required on first use)
            checkpointer.setup()
            print("✅ PostgreSQL checkpointer setup successful")
            
            # Basic checkpoint operations
            write_config = {"configurable": {"thread_id": "demo_thread", "checkpoint_ns": ""}}
            read_config = {"configurable": {"thread_id": "demo_thread"}}
            
            # Sample checkpoint data
            checkpoint = {
                "v": 1,
                "ts": datetime.utcnow().isoformat(),
                "id": str(uuid.uuid4()),
                "channel_values": {"status": "active", "step": "setup"},
                "channel_versions": {"__start__": 1, "status": 1},
                "versions_seen": {"__input__": {}, "__start__": {"__start__": 1}},
                "pending_sends": []
            }
            
            # Store checkpoint
            checkpointer.put(write_config, checkpoint, {}, {})
            print("✅ Checkpoint stored successfully")
            
            # Retrieve checkpoint
            loaded_checkpoint = checkpointer.get(read_config)
            print(f"✅ Checkpoint retrieved: {loaded_checkpoint['channel_values']}")
            
            # List checkpoints
            checkpoints = list(checkpointer.list(read_config))
            print(f"✅ Found {len(checkpoints)} checkpoints")
            
    except Exception as e:
        print(f"❌ Setup failed: {e}")

# Example 2: Async PostgreSQL Checkpointer
async def async_postgres_setup():
    """Demonstrates async setup of PostgreSQL checkpointer."""
    
    DB_URI = os.getenv("POSTGRES_URI", "postgresql://postgres:postgres@localhost:5432/langgraph?sslmode=disable")
    
    try:
        async with AsyncPostgresSaver.from_conn_string(DB_URI) as checkpointer:
            # Setup database tables
            await checkpointer.asetup()
            print("✅ Async PostgreSQL checkpointer setup successful")
            
            # Async checkpoint operations
            write_config = {"configurable": {"thread_id": "async_demo", "checkpoint_ns": ""}}
            read_config = {"configurable": {"thread_id": "async_demo"}}
            
            checkpoint = {
                "v": 1,
                "ts": datetime.utcnow().isoformat(),
                "id": str(uuid.uuid4()),
                "channel_values": {"status": "async_active", "step": "async_setup"},
                "channel_versions": {"__start__": 1, "status": 1},
                "versions_seen": {"__input__": {}, "__start__": {"__start__": 1}},
                "pending_sends": []
            }
            
            # Store checkpoint asynchronously
            await checkpointer.aput(write_config, checkpoint, {}, {})
            print("✅ Async checkpoint stored successfully")
            
            # Retrieve checkpoint asynchronously
            loaded_checkpoint = await checkpointer.aget(read_config)
            print(f"✅ Async checkpoint retrieved: {loaded_checkpoint['channel_values']}")
            
    except Exception as e:
        print(f"❌ Async setup failed: {e}")

# Example 3: LangGraph with PostgreSQL Persistence
def langgraph_with_postgres():
    """Demonstrates LangGraph workflow with PostgreSQL persistence."""
    
    DB_URI = os.getenv("POSTGRES_URI", "postgresql://postgres:postgres@localhost:5432/langgraph?sslmode=disable")
    
    # Define state schema
    class ChatState(MessagesState):
        user_id: str
        conversation_count: int
    
    # Define node functions
    def chat_node(state: ChatState) -> ChatState:
        """Simple chat node that increments conversation count."""
        return {
            "messages": state["messages"] + [AIMessage(content="Hello! I'm a PostgreSQL-persistent chatbot.")],
            "user_id": state["user_id"],
            "conversation_count": state["conversation_count"] + 1
        }
    
    def memory_node(state: ChatState) -> ChatState:
        """Node that demonstrates memory persistence."""
        return {
            "messages": state["messages"] + [AIMessage(content=f"Conversation #{state['conversation_count']} completed!")],
            "user_id": state["user_id"],
            "conversation_count": state["conversation_count"]
        }
    
    try:
        # Setup PostgreSQL checkpointer
        with PostgresSaver.from_conn_string(DB_URI) as checkpointer:
            checkpointer.setup()
            print("✅ PostgreSQL checkpointer ready for LangGraph")
            
            # Build graph
            builder = StateGraph(ChatState)
            builder.add_node("chat", chat_node)
            builder.add_node("memory", memory_node)
            builder.add_edge(START, "chat")
            builder.add_edge("chat", "memory")
            builder.add_edge("memory", END)
            
            # Compile with PostgreSQL persistence
            graph = builder.compile(checkpointer=checkpointer)
            print("✅ LangGraph compiled with PostgreSQL persistence")
            
            # Execute workflow
            config = {"configurable": {"thread_id": "user_123"}}
            initial_state = {
                "messages": [HumanMessage(content="Hi there!")],
                "user_id": "user_123",
                "conversation_count": 0
            }
            
            result = graph.invoke(initial_state, config=config)
            print(f"✅ Workflow executed: {result['conversation_count']} conversations")
            
            # Demonstrate persistence by running again
            result2 = graph.invoke({"messages": [HumanMessage(content="Hello again!")]}, config=config)
            print(f"✅ Persistent execution: {result2['conversation_count']} conversations")
            
    except Exception as e:
        print(f"❌ LangGraph with PostgreSQL failed: {e}")

# Example 4: Advanced Features - Encrypted Checkpoints
def encrypted_checkpoints():
    """Demonstrates encrypted checkpoint storage."""
    
    DB_URI = os.getenv("POSTGRES_URI", "postgresql://postgres:postgres@localhost:5432/langgraph?sslmode=disable")
    
    try:
        # Setup encrypted serializer (requires LANGGRAPH_AES_KEY env var)
        aes_key = os.getenv("LANGGRAPH_AES_KEY")
        if not aes_key:
            print("⚠️  LANGGRAPH_AES_KEY not set, skipping encrypted example")
            return
        
        serde = EncryptedSerializer.from_pycryptodome_aes()
        
        # Initialize encrypted checkpointer
        with PostgresSaver.from_conn_string(DB_URI, serde=serde) as checkpointer:
            checkpointer.setup()
            print("✅ Encrypted PostgreSQL checkpointer setup successful")
            
            # Store encrypted checkpoint
            write_config = {"configurable": {"thread_id": "encrypted_demo", "checkpoint_ns": ""}}
            checkpoint = {
                "v": 1,
                "ts": datetime.utcnow().isoformat(),
                "id": str(uuid.uuid4()),
                "channel_values": {"secret": "encrypted_data", "timestamp": datetime.utcnow().isoformat()},
                "channel_versions": {"__start__": 1, "secret": 1},
                "versions_seen": {"__input__": {}, "__start__": {"__start__": 1}},
                "pending_sends": []
            }
            
            checkpointer.put(write_config, checkpoint, {}, {})
            print("✅ Encrypted checkpoint stored successfully")
            
    except Exception as e:
        print(f"❌ Encrypted checkpoints failed: {e}")

# Example 5: TTL Configuration
def ttl_configured_checkpoints():
    """Demonstrates TTL (Time-To-Live) configuration for checkpoints."""
    
    DB_URI = os.getenv("POSTGRES_URI", "postgresql://postgres:postgres@localhost:5432/langgraph?sslmode=disable")
    
    try:
        # Configure TTL
        ttl_config = {
            "default_ttl": 5,  # 5 minutes for demo purposes
            "refresh_on_read": True
        }
        
        with PostgresSaver.from_conn_string(DB_URI, ttl=ttl_config) as checkpointer:
            checkpointer.setup()
            print("✅ TTL-configured PostgreSQL checkpointer setup successful")
            
            # Store checkpoint with TTL
            write_config = {"configurable": {"thread_id": "ttl_demo", "checkpoint_ns": ""}}
            checkpoint = {
                "v": 1,
                "ts": datetime.utcnow().isoformat(),
                "id": str(uuid.uuid4()),
                "channel_values": {"status": "temporary", "expires_in": "5_minutes"},
                "channel_versions": {"__start__": 1, "status": 1},
                "versions_seen": {"__input__": {}, "__start__": {"__start__": 1}},
                "pending_sends": []
            }
            
            checkpointer.put(write_config, checkpoint, {}, {})
            print("✅ TTL checkpoint stored (will expire in 5 minutes)")
            
    except Exception as e:
        print(f"❌ TTL configuration failed: {e}")

# Example 6: PostgreSQL Store for Cross-Thread Memory
def postgres_store_example():
    """Demonstrates PostgreSQL store for cross-thread memory sharing."""
    
    DB_URI = os.getenv("POSTGRES_URI", "postgresql://postgres:postgres@localhost:5432/langgraph?sslmode=disable")
    
    try:
        # Setup PostgreSQL store
        with PostgresStore.from_conn_string(DB_URI) as store:
            store.setup()
            print("✅ PostgreSQL store setup successful")
            
            # Store memories
            namespace = ("user_memories", "user_123")
            
            # Store user preferences
            store.put(namespace, "preference_1", {
                "type": "food",
                "preference": "Italian cuisine",
                "timestamp": datetime.utcnow().isoformat()
            })
            
            store.put(namespace, "preference_2", {
                "type": "music",
                "preference": "Jazz",
                "timestamp": datetime.utcnow().isoformat()
            })
            
            print("✅ Memories stored successfully")
            
            # Search memories
            results = store.search(namespace, query="food preferences")
            print(f"✅ Found {len(results)} food-related memories")
            
            for result in results:
                print(f"  - {result.value['preference']}")
            
    except Exception as e:
        print(f"❌ PostgreSQL store failed: {e}")

# Example 7: Production-Ready Setup with Error Handling
def production_setup():
    """Demonstrates production-ready PostgreSQL setup with proper error handling."""
    
    DB_URI = os.getenv("POSTGRES_URI", "postgresql://postgres:postgres@localhost:5432/langgraph?sslmode=disable")
    
    # Production configuration
    production_config = {
        "ttl": {
            "default_ttl": 1440,  # 24 hours
            "refresh_on_read": True,
            "sweep_interval_minutes": 60
        },
        "connection_pool": {
            "min_size": 5,
            "max_size": 20
        }
    }
    
    try:
        # Initialize with production settings
        with PostgresSaver.from_conn_string(DB_URI, ttl=production_config["ttl"]) as checkpointer:
            checkpointer.setup()
            print("✅ Production PostgreSQL checkpointer ready")
            
            # Health check
            health_config = {"configurable": {"thread_id": "health_check"}}
            checkpoints = list(checkpointer.list(health_config))
            print(f"✅ Health check passed: {len(checkpoints)} checkpoints found")
            
    except Exception as e:
        print(f"❌ Production setup failed: {e}")
        # In production, you might want to:
        # - Log the error
        # - Send alerts
        # - Fall back to alternative storage
        # - Retry with exponential backoff

# Example 8: Multi-Thread Scenario
def multi_thread_scenario():
    """Demonstrates PostgreSQL checkpointer with multiple threads."""
    
    DB_URI = os.getenv("POSTGRES_URI", "postgresql://postgres:postgres@localhost:5432/langgraph?sslmode=disable")
    
    try:
        with PostgresSaver.from_conn_string(DB_URI) as checkpointer:
            checkpointer.setup()
            print("✅ Multi-thread PostgreSQL checkpointer ready")
            
            # Simulate multiple user sessions
            user_sessions = ["user_001", "user_002", "user_003", "user_004", "user_005"]
            
            for user_id in user_sessions:
                thread_config = {"configurable": {"thread_id": user_id, "checkpoint_ns": ""}}
                
                # Store checkpoint for each user
                checkpoint = {
                    "v": 1,
                    "ts": datetime.utcnow().isoformat(),
                    "id": str(uuid.uuid4()),
                    "channel_values": {"user_id": user_id, "session_start": datetime.utcnow().isoformat()},
                    "channel_versions": {"__start__": 1, "user_id": 1},
                    "versions_seen": {"__input__": {}, "__start__": {"__start__": 1}},
                    "pending_sends": []
                }
                
                checkpointer.put(thread_config, checkpoint, {}, {})
                print(f"✅ Checkpoint stored for {user_id}")
            
            # Verify all threads are stored
            for user_id in user_sessions:
                thread_config = {"configurable": {"thread_id": user_id}}
                checkpoints = list(checkpointer.list(thread_config))
                print(f"✅ {user_id}: {len(checkpoints)} checkpoints")
                
    except Exception as e:
        print(f"❌ Multi-thread scenario failed: {e}")

# Main execution function
def run_examples():
    """Run all PostgreSQL saver examples."""
    
    print("🚀 Starting PostgreSQL Saver Implementation Examples")
    print("=" * 60)
    
    # Check environment
    if not os.getenv("POSTGRES_URI"):
        print("⚠️  POSTGRES_URI not set, using default localhost connection")
        print("   Set POSTGRES_URI environment variable for custom connection")
    
    # Run examples
    examples = [
        ("Basic Setup", basic_postgres_setup),
        ("Async Setup", lambda: asyncio.run(async_postgres_setup())),
        ("LangGraph Integration", langgraph_with_postgres),
        ("Encrypted Checkpoints", encrypted_checkpoints),
        ("TTL Configuration", ttl_configured_checkpoints),
        ("PostgreSQL Store", postgres_store_example),
        ("Production Setup", production_setup),
        ("Multi-Thread Scenario", multi_thread_scenario)
    ]
    
    for name, example_func in examples:
        print(f"\n📋 Running: {name}")
        print("-" * 40)
        try:
            example_func()
        except Exception as e:
            print(f"❌ {name} failed: {e}")
    
    print("\n🎉 PostgreSQL Saver Examples Completed!")
    print("=" * 60)

if __name__ == "__main__":
    # Run examples
    run_examples()
