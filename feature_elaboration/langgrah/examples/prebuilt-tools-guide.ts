/**
 * LangGraph Prebuilt Tools and Components Guide
 * 
 * This file demonstrates how to use LangGraph's prebuilt components for building
 * AI agents and workflows. Based on Context7 research of the latest LangGraph documentation.
 */

import { z } from "zod";

// ============================================================================
// 1. CORE PREBUILT COMPONENTS
// ============================================================================

/**
 * 1.1 ToolNode - Specialized node for executing tools in workflows
 * 
 * Features:
 * - Supports both synchronous and asynchronous tools
 * - Executes multiple tools concurrently
 * - Built-in error handling (handle_tool_errors=True by default)
 * - Operates on MessagesState
 */
export const toolNodeExample = `
// Python Example
from langgraph.prebuilt import ToolNode
from langchain_core.messages import AIMessage

def get_weather(location: str):
    """Call to get the current weather."""
    if location.lower() in ["sf", "san francisco"]:
        return "It's 60 degrees and foggy."
    else:
        return "It's 90 degrees and sunny."

def get_coolest_cities():
    """Get a list of coolest cities"""
    return "nyc, sf"

# Create ToolNode with multiple tools
tool_node = ToolNode([get_weather, get_coolest_cities])

# Execute single tool call
message_with_single_tool_call = AIMessage(
    content="",
    tool_calls=[
        {
            "name": "get_weather",
            "args": {"location": "sf"},
            "id": "tool_call_id",
            "type": "tool_call",
        }
    ],
)

result = tool_node.invoke({"messages": [message_with_single_tool_call]})

# Execute multiple tool calls in parallel
message_with_multiple_tool_calls = AIMessage(
    content="",
    tool_calls=[
        {
            "name": "get_coolest_cities",
            "args": {},
            "id": "tool_call_id_1",
            "type": "tool_call",
        },
        {
            "name": "get_weather",
            "args": {"location": "sf"},
            "id": "tool_call_id_2",
            "type": "tool_call",
        },
    ],
)

result = tool_node.invoke({"messages": [message_with_multiple_tool_calls]})
`;

/**
 * 1.2 ValidationNode - Validates tool calls against schemas
 * 
 * Features:
 * - Schema-based validation using Pydantic
 * - Custom field validators
 * - Error handling for invalid inputs
 */
export const validationNodeExample = `
// Python Example
from pydantic import BaseModel, field_validator
from langgraph.prebuilt import ValidationNode
from langchain_core.messages import AIMessage

class SelectNumber(BaseModel):
    a: int

    @field_validator("a")
    def a_must_be_meaningful(cls, v):
        if v != 37:
            raise ValueError("Only 37 is allowed")
        return v

validation_node = ValidationNode([SelectNumber])
validation_node.invoke({
    "messages": [AIMessage("", tool_calls=[{"name": "SelectNumber", "args": {"a": 42}, "id": "1"}])]
})
`;

/**
 * 1.3 create_react_agent - Prebuilt ReAct-style agent
 * 
 * Features:
 * - Automatic tool calling and execution
 * - Built-in error handling
 * - Configurable hooks and response formats
 * - Parallel tool execution support
 */
export const createReactAgentExample = `
// Python Example
from langchain_core.tools import tool
from langgraph.prebuilt import create_react_agent
from langchain_openai import ChatOpenAI

@tool
def multiply(a: int, b: int) -> int:
    """Multiply two numbers."""
    return a * b

@tool
def add(a: int, b: int) -> int:
    """Add two numbers"""
    return a + b

model = ChatOpenAI(model="gpt-4o", temperature=0)
tools = [add, multiply]

# Create ReAct agent with tools
agent = create_react_agent(
    model=model.bind_tools(tools, parallel_tool_calls=False),  # Disable parallel execution
    tools=tools
)

# Invoke the agent
response = agent.invoke({
    "messages": [{"role": "user", "content": "what's 3 + 5 and 4 * 7?"}]
})

# With direct return tool
@tool(return_direct=True)
def greet(user_name: str) -> str:
    """Greet user."""
    return f"Hello {user_name}!"

greeting_agent = create_react_agent(
    model="anthropic:claude-3-7-sonnet-latest",
    tools=[greet]
)

# Force tool usage
forced_agent = create_react_agent(
    model=model.bind_tools(tools, tool_choice={"type": "tool", "name": "greet"}),
    tools=tools
)
`;

// ============================================================================
// 2. MULTI-AGENT ARCHITECTURES
// ============================================================================

/**
 * 2.1 Supervisor Pattern - Centralized agent coordination
 * 
 * Features:
 * - Central supervisor manages multiple agents
 * - Dynamic tool routing based on context
 * - Sequential or parallel agent execution
 */
export const supervisorPatternExample = `
// Python Example
from langchain_openai import ChatOpenAI
from langgraph.prebuilt import create_react_agent
from langgraph_supervisor import create_supervisor

def book_hotel(hotel_name: str):
    """Book a hotel"""
    return f"Successfully booked a stay at {hotel_name}."

def book_flight(from_airport: str, to_airport: str):
    """Book a flight"""
    return f"Successfully booked a flight from {from_airport} to {to_airport}."

# Create specialized agents
flight_assistant = create_react_agent(
    model="openai:gpt-4o",
    tools=[book_flight],
    prompt="You are a flight booking assistant",
    name="flight_assistant"
)

hotel_assistant = create_react_agent(
    model="openai:gpt-4o",
    tools=[book_hotel],
    prompt="You are a hotel booking assistant",
    name="hotel_assistant"
)

# Create supervisor to coordinate agents
supervisor = create_supervisor(
    agents=[flight_assistant, hotel_assistant],
    model=ChatOpenAI(model="gpt-4o"),
    prompt=(
        "You manage a hotel booking assistant and a "
        "flight booking assistant. Assign work to them."
    )
).compile()

# Stream interactions
for chunk in supervisor.stream({
    "messages": [
        {
            "role": "user",
            "content": "book a flight from BOS to JFK and a stay at McKittrick Hotel"
        }
    ]
}):
    print(chunk)
`;

/**
 * 2.2 Swarm Pattern - Dynamic agent handoffs
 * 
 * Features:
 * - Agents dynamically hand off control
 * - Memory of last active agent
 * - Collaborative problem solving
 */
export const swarmPatternExample = `
// Python Example
from langgraph_swarm import create_swarm, create_handoff_tool

# Create handoff tools for seamless transitions
transfer_to_hotel_assistant = create_handoff_tool(
    agent_name="hotel_assistant",
    description="Transfer user to the hotel-booking assistant.",
)

transfer_to_flight_assistant = create_handoff_tool(
    agent_name="flight_assistant",
    description="Transfer user to the flight-booking assistant.",
)

# Create agents with handoff capabilities
flight_assistant = create_react_agent(
    model="anthropic:claude-3-5-sonnet-latest",
    tools=[book_flight, transfer_to_hotel_assistant],
    prompt="You are a flight booking assistant",
    name="flight_assistant"
)

hotel_assistant = create_react_agent(
    model="anthropic:claude-3-5-sonnet-latest",
    tools=[book_hotel, transfer_to_flight_assistant],
    prompt="You are a hotel booking assistant",
    name="hotel_assistant"
)

# Create swarm system
swarm = create_swarm(
    agents=[flight_assistant, hotel_assistant],
    default_active_agent="flight_assistant"
).compile()

# Stream collaborative interactions
for chunk in swarm.stream({
    "messages": [
        {
            "role": "user",
            "content": "book a flight from BOS to JFK and a stay at McKittrick Hotel"
        }
    ]
}):
    print(chunk)
`;

// ============================================================================
// 3. ADVANCED TOOL INTEGRATION
// ============================================================================

/**
 * 3.1 Dynamic Tool Selection - Runtime tool availability
 * 
 * Features:
 * - Context-based tool selection
 * - Runtime tool configuration
 * - Conditional tool availability
 */
export const dynamicToolSelectionExample = `
// Python Example
from dataclasses import dataclass
from typing import Literal
from langchain.chat_models import init_chat_model
from langchain_core.tools import tool
from langgraph.prebuilt import create_react_agent
from langgraph.prebuilt.chat_agent_executor import AgentState
from langgraph.runtime import Runtime

@dataclass
class CustomContext:
    tools: list[Literal["weather", "compass"]]

@tool
def weather() -> str:
    """Returns the current weather conditions."""
    return "It's nice and sunny."

@tool
def compass() -> str:
    """Returns the direction the user is facing."""
    return "North"

model = init_chat_model("anthropic:claude-sonnet-4-20250514")

def configure_model(state: AgentState, runtime: Runtime[CustomContext]):
    """Configure the model with tools based on runtime context."""
    selected_tools = [
        tool
        for tool in [weather, compass]
        if tool.name in runtime.context.tools
    ]
    return model.bind_tools(selected_tools)

agent = create_react_agent(
    configure_model,
    tools=[weather, compass]
)

# Invoke with specific tool availability
output = agent.invoke(
    {
        "messages": [
            {
                "role": "user",
                "content": "Who are you and what tools do you have access to?",
            }
        ]
    },
    context=CustomContext(tools=["weather"]),  # Only enable weather tool
)
`;

/**
 * 3.2 LLM Provider Tools - Native tool integration
 * 
 * Features:
 * - OpenAI web search preview
 * - Anthropic tool calling
 * - Provider-specific optimizations
 */
export const llmProviderToolsExample = `
// Python Example
from langgraph.prebuilt import create_react_agent

# Integrate OpenAI's web search preview
agent = create_react_agent(
    model="openai:gpt-4o-mini",
    tools=[{"type": "web_search_preview"}]
)

response = agent.invoke({
    "messages": ["What was a positive news story from today?"]
})

# TypeScript Example
import { createReactAgent } from "@langchain/langgraph/prebuilt";
import { ChatOpenAI } from "@langchain/openai";

const agent = createReactAgent({
  llm: new ChatOpenAI({ model: "gpt-4o-mini" }),
  tools: [{ type: "web_search_preview" }],
});

const response = await agent.invoke({
  messages: [
    { role: "user", content: "What was a positive news story from today?" },
  ],
});
`;

/**
 * 3.3 Memory Integration - Persistent state management
 * 
 * Features:
 * - Long-term memory storage
 * - User-specific data persistence
 * - Configurable storage backends
 */
export const memoryIntegrationExample = `
// Python Example
from typing_extensions import TypedDict
from langchain_core.tools import tool
from langgraph.config import get_store
from langchain_core.runnables import RunnableConfig
from langgraph.prebuilt import create_react_agent
from langgraph.store.memory import InMemoryStore

store = InMemoryStore()

class UserInfo(TypedDict):
    name: str

@tool
def save_user_info(user_info: UserInfo, config: RunnableConfig) -> str:
    """Save user info."""
    store = get_store()
    user_id = config["configurable"].get("user_id")
    store.put(("users",), user_id, user_info)
    return "Successfully saved user info."

agent = create_react_agent(
    model="anthropic:claude-3-7-sonnet-latest",
    tools=[save_user_info],
    store=store
)

# Run the agent with user context
agent.invoke(
    {"messages": [{"role": "user", "content": "My name is John Smith"}]},
    config={"configurable": {"user_id": "user_123"}}
)

# Access stored data directly
stored_info = store.get(("users",), "user_123").value
`;

// ============================================================================
// 4. HUMAN-IN-THE-LOOP FEATURES
// ============================================================================

/**
 * 4.1 Human Interrupts - Interactive agent workflows
 * 
 * Features:
 * - Human intervention during execution
 * - Action request/response handling
 * - Configurable interrupt behavior
 */
export const humanInterruptExample = `
// Python Example
from langgraph.types import interrupt
from langgraph.prebuilt.interrupt import HumanInterrupt, HumanResponse

def my_graph_function():
    # Extract the last tool call from the messages field in the state
    tool_call = state["messages"][-1].tool_calls[0]
    
    # Create an interrupt request
    request: HumanInterrupt = {
        "action_request": {
            "action": tool_call['name'],
            "args": tool_call['args']
        },
        "config": {
            "allow_ignore": True,
            "allow_respond": True,
            "allow_edit": False,
            "allow_accept": False
        },
        "description": _generate_email_markdown(state)  # Generate detailed description
    }
    
    # Send the interrupt request and extract the response
    response = interrupt([request])[0]
    
    if response['type'] == "response":
        # Process the human response
        return process_human_response(response)
`;

// ============================================================================
// 5. TOOL CREATION PATTERNS
// ============================================================================

/**
 * 5.1 Custom Tool Definition - Function-based tools
 * 
 * Features:
 * - Automatic schema generation
 * - Docstring parsing
 * - Type validation
 */
export const customToolDefinitionExample = `
// Python Example
from langchain_core.tools import tool

@tool("multiply_tool", parse_docstring=True)
def multiply(a: int, b: int) -> int:
    """Multiply two numbers.

    Args:
        a: First operand
        b: Second operand
    """
    return a * b

# TypeScript Example
import { tool } from "@langchain/core/tools";
import { z } from "zod";

const multiply = tool(
  (input) => {
    return input.a * input.b;
  },
  {
    name: "multiply",
    description: "Multiply two numbers.",
    schema: z.object({
      a: z.number().describe("First operand"),
      b: z.number().describe("Second operand"),
    }),
  }
);
`;

/**
 * 5.2 Handoff Tools - Agent transition utilities
 * 
 * Features:
 * - Seamless agent transitions
 * - State preservation
 * - Command-based routing
 */
export const handoffToolExample = `
// Python Example
from typing import Annotated
from langchain_core.tools import tool, InjectedToolCallId
from langgraph.prebuilt import create_react_agent, InjectedState
from langgraph.graph import StateGraph, START, MessagesState
from langgraph.types import Command

def create_handoff_tool(*, agent_name: str, description: str | None = None):
    name = f"transfer_to_{agent_name}"
    description = description or f"Transfer to {agent_name}"

    @tool(name, description=description)
    def handoff_tool(
        state: Annotated[MessagesState, InjectedState],
        tool_call_id: Annotated[str, InjectedToolCallId],
    ) -> Command:
        tool_message = {
            "role": "tool",
            "content": f"Successfully transferred to {agent_name}",
            "name": name,
            "tool_call_id": tool_call_id,
        }
        return Command(
            goto=agent_name,
            update={"messages": state["messages"] + [tool_message]},
            graph=Command.PARENT,
        )
    return handoff_tool

# Create handoff tools for different agents
transfer_to_hotel_assistant = create_handoff_tool(
    agent_name="hotel_assistant",
    description="Transfer user to the hotel-booking assistant.",
)

transfer_to_flight_assistant = create_handoff_tool(
    agent_name="flight_assistant",
    description="Transfer user to the flight-booking assistant.",
)
`;

// ============================================================================
// 6. INSTALLATION AND SETUP
// ============================================================================

export const installationGuide = `
# LangGraph Package Ecosystem Installation

## Core Packages
pip install -U langgraph langchain                    # Prebuilt components for agents
pip install -U langgraph-supervisor                   # Supervisor pattern tools
pip install -U langgraph-swarm                        # Swarm multi-agent system
pip install -U langchain-mcp-adapters                 # MCP server integration
pip install -U langmem                                # Agent memory management
pip install -U agentevals                             # Agent evaluation utilities

## Node.js/TypeScript
npm install @langchain/langgraph @langchain/core      # Core LangGraph
npm install @langchain/langgraph-supervisor           # Supervisor components
npm install @langchain/langgraph-swarm                # Swarm components
npm install @langchain/mcp-adapters                   # MCP adapters
npm install agentevals                                # Evaluation tools

## Key Features by Package

### langgraph-prebuilt
- ToolNode: Execute tools in workflows
- ValidationNode: Validate tool inputs/outputs
- create_react_agent: ReAct-style agents
- tools_condition: Conditional tool routing

### langgraph-supervisor
- create_supervisor: Centralized agent coordination
- Handoff tools: Agent transition utilities
- Task delegation: Structured task assignment

### langgraph-swarm
- create_swarm: Dynamic agent collaboration
- create_handoff_tool: Seamless agent transitions
- Active agent routing: Memory-based agent selection

### langchain-mcp-adapters
- MCP server integration
- External tool and resource access
- Protocol-based communication
`;

// ============================================================================
// 7. BEST PRACTICES AND PATTERNS
// ============================================================================

export const bestPractices = `
# LangGraph Prebuilt Tools Best Practices

## 1. Tool Design
- Use descriptive names and docstrings
- Implement proper error handling
- Return structured data when possible
- Use return_direct=True for simple responses

## 2. Agent Architecture
- Choose between supervisor and swarm based on complexity
- Use ToolNode for custom workflows
- Implement proper state management
- Handle tool errors gracefully

## 3. Performance Optimization
- Enable parallel tool calls when appropriate
- Use dynamic tool selection for large tool sets
- Implement caching for expensive operations
- Monitor agent performance with LangSmith

## 4. Error Handling
- Configure handle_tool_errors appropriately
- Implement custom error messages
- Use ValidationNode for input validation
- Handle human interrupts gracefully

## 5. State Management
- Use appropriate state types (MessagesState, TypedDict)
- Implement proper state updates
- Handle state persistence when needed
- Use configurable contexts for runtime flexibility

## 6. Multi-Agent Coordination
- Design clear agent responsibilities
- Implement proper handoff mechanisms
- Use supervisor for complex orchestration
- Consider swarm for collaborative tasks

## 7. Testing and Debugging
- Use agentevals for performance testing
- Visualize graphs with draw_mermaid_png()
- Implement proper logging and tracing
- Test with various input scenarios
`;

// ============================================================================
// 8. COMPLETE WORKFLOW EXAMPLE
// ============================================================================

export const completeWorkflowExample = `
# Complete Multi-Agent Research Workflow

## Setup and Imports
from typing import Annotated, Literal
from langchain_openai import ChatOpenAI
from langchain_core.tools import tool
from langgraph.prebuilt import create_react_agent, ToolNode, tools_condition
from langgraph.graph import StateGraph, START, END
from langgraph.graph.message import add_messages
from langgraph.types import Command
from typing_extensions import TypedDict

## State Definition
class State(TypedDict):
    messages: Annotated[list, add_messages]
    research_topic: str
    current_phase: Literal["research", "analysis", "writing"]

## Tool Definitions
@tool
def web_search(query: str) -> str:
    """Search the web for information."""
    # Implementation would use actual search API
    return f"Search results for: {query}"

@tool
def analyze_data(data: str) -> str:
    """Analyze the provided data."""
    return f"Analysis of: {data[:100]}..."

@tool
def write_summary(topic: str, findings: str) -> str:
    """Write a summary based on findings."""
    return f"Summary for {topic}: {findings[:200]}..."

## Agent Creation
llm = ChatOpenAI(model="gpt-4o")

research_agent = create_react_agent(
    model=llm,
    tools=[web_search],
    prompt="You are a research agent. Gather comprehensive information on the given topic.",
    name="research_agent"
)

analysis_agent = create_react_agent(
    model=llm,
    tools=[analyze_data],
    prompt="You are an analysis agent. Analyze the provided data and extract key insights.",
    name="analysis_agent"
)

writing_agent = create_react_agent(
    model=llm,
    tools=[write_summary],
    prompt="You are a writing agent. Create clear, concise summaries based on the analysis.",
    name="writing_agent"
)

## Graph Construction
def supervisor_node(state: State) -> Command[Literal["research_agent", "analysis_agent", "writing_agent", END]]:
    """Route to appropriate agent based on current phase."""
    if state["current_phase"] == "research":
        return Command(goto="research_agent")
    elif state["current_phase"] == "analysis":
        return Command(goto="analysis_agent")
    elif state["current_phase"] == "writing":
        return Command(goto="writing_agent")
    else:
        return Command(goto=END)

def research_node(state: State) -> Command[Literal["supervisor"]]:
    """Execute research phase."""
    result = research_agent.invoke(state)
    return Command(
        goto="supervisor",
        update={
            "messages": result["messages"],
            "current_phase": "analysis"
        }
    )

def analysis_node(state: State) -> Command[Literal["supervisor"]]:
    """Execute analysis phase."""
    result = analysis_agent.invoke(state)
    return Command(
        goto="supervisor",
        update={
            "messages": result["messages"],
            "current_phase": "writing"
        }
    )

def writing_node(state: State) -> Command[Literal["supervisor"]]:
    """Execute writing phase."""
    result = writing_agent.invoke(state)
    return Command(
        goto="supervisor",
        update={
            "messages": result["messages"],
            "current_phase": "complete"
        }
    )

## Graph Assembly
builder = StateGraph(State)
builder.add_node("supervisor", supervisor_node)
builder.add_node("research_agent", research_node)
builder.add_node("analysis_agent", analysis_node)
builder.add_node("writing_agent", writing_node)

builder.add_edge(START, "supervisor")
builder.add_edge("research_agent", "supervisor")
builder.add_edge("analysis_agent", "supervisor")
builder.add_edge("writing_agent", "supervisor")

workflow = builder.compile()

## Execution
result = workflow.invoke({
    "messages": [{"role": "user", "content": "Research the impact of AI on healthcare"}],
    "research_topic": "AI in Healthcare",
    "current_phase": "research"
})

print("Final result:", result["messages"][-1].content)
`;

// ============================================================================
// 9. TROUBLESHOOTING AND DEBUGGING
// ============================================================================

export const troubleshootingGuide = `
# LangGraph Prebuilt Tools Troubleshooting

## Common Issues and Solutions

### 1. Tool Execution Errors
- Check tool function signatures
- Verify input validation
- Ensure proper error handling
- Check tool registration

### 2. Agent Routing Issues
- Verify graph edges and nodes
- Check conditional routing logic
- Ensure proper state updates
- Validate goto commands

### 3. Memory and State Problems
- Check state type definitions
- Verify state update patterns
- Ensure proper state persistence
- Check configurable contexts

### 4. Performance Issues
- Monitor tool execution times
- Check parallel tool call settings
- Implement caching where appropriate
- Use LangSmith for tracing

### 5. Human Interrupt Problems
- Verify interrupt configuration
- Check action request formats
- Ensure proper response handling
- Validate interrupt permissions

## Debugging Techniques

### 1. Graph Visualization
agent.get_graph().draw_mermaid_png()  # Generate PNG
agent.get_graph().draw_ascii()        # Terminal output

### 2. State Inspection
print("Current state:", state)
print("Messages:", state.get("messages", []))
print("Tool calls:", state.get("tool_calls", []))

### 3. LangSmith Integration
# Enable tracing for debugging
import os
os.environ["LANGCHAIN_TRACING_V2"] = "true"
os.environ["LANGCHAIN_API_KEY"] = "your-api-key"

### 4. Logging and Monitoring
import logging
logging.basicConfig(level=logging.DEBUG)

# Add logging to nodes
def debug_node(state):
    logging.debug(f"Node execution: {state}")
    # ... rest of node logic
`;

// ============================================================================
// 10. EXPORT ALL EXAMPLES
// ============================================================================

export const allExamples = {
    toolNode: toolNodeExample,
    validationNode: validationNodeExample,
    createReactAgent: createReactAgentExample,
    supervisorPattern: supervisorPatternExample,
    swarmPattern: swarmPatternExample,
    dynamicToolSelection: dynamicToolSelectionExample,
    llmProviderTools: llmProviderToolsExample,
    memoryIntegration: memoryIntegrationExample,
    humanInterrupt: humanInterruptExample,
    customToolDefinition: customToolDefinitionExample,
    handoffTool: handoffToolExample,
    installation: installationGuide,
    bestPractices: bestPractices,
    completeWorkflow: completeWorkflowExample,
    troubleshooting: troubleshootingGuide
};

export default allExamples;
