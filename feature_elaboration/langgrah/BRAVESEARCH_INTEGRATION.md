# BraveSearch Integration with LangGraphJS

This guide explains how to integrate BraveSearch into your LangGraphJS chatbot backend, replacing DuckDuckGo with a privacy-focused, high-quality search solution.

## Overview

BraveSearch provides:
- **Privacy-focused search results** - No user tracking
- **High-quality web content** - Better result relevance
- **API rate limits suitable for production** - Reliable service
- **Structured search results** - Easy to parse and use

## Configuration

### 1. Environment Variables

Add the following to your `.env` file:

```bash
# Required for BraveSearch functionality
BRAVE_SEARCH_API_KEY=your_brave_search_api_key
OPENAI_API_KEY=your_openai_api_key
```

### 2. Get BraveSearch API Key

1. Visit [Brave Search API](https://brave.com/search/api/)
2. Sign up for an account
3. Create an API key
4. Add it to your environment variables

## Implementation

### Current Implementation

The chatbot now uses BraveSearch as the primary and only search tool:

```typescript
// SimpleChatAgentService automatically uses BraveSearch
const tools = [this.braveSearchTool];
```

### Key Changes Made

1. **Removed DuckDuckGo dependency** - No longer using `duckduckgo-search` or `duck-duck-scrape`
2. **BraveSearch as primary tool** - Only search engine used
3. **Required API key** - Application will fail to start without `BRAVE_SEARCH_API_KEY`
4. **Updated error handling** - Simplified error handling for single search provider

## Usage Examples

### Basic Search Integration

```typescript
import { BraveSearchAgent } from './examples/bravesearch-integration.example';

const agent = new BraveSearchAgent({
    openaiApiKey: process.env.OPENAI_API_KEY!,
    braveApiKey: process.env.BRAVE_SEARCH_API_KEY!,
    model: 'gpt-4o-mini'
});

// Process a search query
const result = await agent.processMessage(
    "What are the latest developments in AI technology?"
);
```

### Custom Search Service

```typescript
import { EnhancedSearchService } from './examples/bravesearch-integration.example';

const searchService = new EnhancedSearchService({
    braveApiKey: process.env.BRAVE_SEARCH_API_KEY!,
    maxResults: 5,
    enableSafeSearch: true
});

const searchTool = searchService.createSearchTool();
const newsTool = searchService.createNewsSearchTool();
```

## Features

### Search Capabilities

- **Web Search** - General information and current events
- **News Search** - Recent news with time filtering
- **URL Analysis** - Extract content from specific URLs
- **Result Formatting** - Enhanced readability and relevance scoring

### Agent Integration

- **Real-time streaming** - Server-Sent Events support
- **Conversation persistence** - PostgreSQL checkpoint saver
- **Error handling** - Graceful failure management
- **Logging** - Comprehensive logging for debugging

## API Endpoints

The existing chatbot endpoints automatically use BraveSearch:

- `POST /chat-agents/stream` - Stream chat with search capabilities
- Agent will automatically use BraveSearch when search is needed

## Error Handling

If BraveSearch fails or API key is missing:

```typescript
// Application will throw error on startup
throw new Error('BRAVE_SEARCH_API_KEY is required for search functionality');
```

## Performance Considerations

### Rate Limits

BraveSearch has generous rate limits suitable for production:
- Check your specific plan limits
- Implement caching for frequently searched terms
- Monitor usage through logging

### Caching Strategy

Consider implementing Redis caching for search results:

```typescript
// Example caching implementation
const cacheKey = `search:${query.toLowerCase()}`;
const cached = await redis.get(cacheKey);
if (cached) return cached;

// Perform search and cache result
const results = await braveSearch.invoke(query);
await redis.setex(cacheKey, 1800, JSON.stringify(results)); // 30 min cache
```

## Migration from DuckDuckGo

### What Changed

1. **Dependencies removed**:
   - `duck-duck-scrape`
   - `duckduckgo-search`

2. **Configuration updated**:
   - Added `BRAVE_SEARCH_API_KEY` requirement
   - Updated global config structure

3. **Service simplified**:
   - Single search provider
   - Removed fallback logic
   - Cleaner error handling

### Benefits

- **Better search quality** - More relevant results
- **Privacy compliance** - No user tracking
- **Production ready** - Reliable API service
- **Cleaner codebase** - Single search provider

## Troubleshooting

### Common Issues

1. **Missing API Key**
   ```
   Error: BRAVE_SEARCH_API_KEY is required for search functionality
   ```
   **Solution**: Add the API key to your environment variables

2. **API Rate Limiting**
   ```
   BraveSearch error: Rate limit exceeded
   ```
   **Solution**: Implement caching or upgrade API plan

3. **Network Issues**
   ```
   Search failed: Connection timeout
   ```
   **Solution**: Check network connectivity and API service status

### Debugging

Enable debug logging to see search queries and results:

```typescript
// Logs will show:
// "🔍 Searching with BraveSearch: 'your query'"
// "Using BraveSearch for job job_id"
```

## Next Steps

1. **Set up API key** - Get your BraveSearch API key
2. **Test integration** - Run a test search query
3. **Monitor usage** - Track API usage and performance
4. **Implement caching** - Add Redis caching for better performance
5. **Customize search** - Adapt search prompts for your use case

## Example Files

- `examples/bravesearch-integration.example.ts` - Complete integration example
- `src/chat_agents/simpleChatAgent.service.ts` - Production implementation
- `src/common/config/globalConfig.ts` - Configuration setup

The integration is now complete and ready for production use with BraveSearch as your primary search provider.
