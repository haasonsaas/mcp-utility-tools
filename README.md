# MCP Utility Tools

[![CI](https://github.com/haasonsaas/mcp-utility-tools/actions/workflows/ci.yml/badge.svg)](https://github.com/haasonsaas/mcp-utility-tools/actions/workflows/ci.yml)
[![npm version](https://badge.fury.io/js/mcp-utility-tools.svg)](https://badge.fury.io/js/mcp-utility-tools)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

A collection of utility tools for the Model Context Protocol (MCP) that provide caching, retry logic, batch operations, and rate limiting capabilities to enhance any MCP-based workflow.

## Features

- 🔄 **Retry with Exponential Backoff** - Automatically retry failed operations with configurable delays
- 💾 **TTL-based Caching** - Cache expensive operations with automatic expiration
- 🚀 **Batch Operations** - Process multiple operations in parallel with concurrency control
- 🚦 **Rate Limiting** - Prevent API abuse with sliding window rate limiting
- 🔍 **Full TypeScript Support** - Type-safe with comprehensive TypeScript definitions

## Installation

```bash
npm install mcp-utility-tools

# or with yarn
yarn add mcp-utility-tools

# or with bun
bun add mcp-utility-tools
```

## Quick Start

### 1. Add to Claude Desktop

Add the utility tools to your Claude Desktop configuration:

```json
{
  "mcpServers": {
    "utility-tools": {
      "command": "npx",
      "args": ["mcp-utility-tools"]
    }
  }
}
```

### 2. Use with Claude

Once configured, Claude can use these tools to enhance any workflow:

```python
# Check cache before expensive operation
cache_result = mcp_cache_get(key="api-response", namespace="github")

if not cache_result["found"]:
    # Fetch data with retry
    response = fetch_with_retry("https://api.github.com/user/repos")
    
    # Cache for 5 minutes
    mcp_cache_put(
        key="api-response",
        value=response,
        ttl_seconds=300,
        namespace="github"
    )
```

## Available Tools

### 🔄 retry_operation

Retry operations with exponential backoff and jitter.

```json
{
  "tool": "retry_operation",
  "arguments": {
    "operation_id": "unique-operation-id",
    "operation_type": "http_request",
    "operation_data": {
      "url": "https://api.example.com/data",
      "method": "GET"
    },
    "max_retries": 3,
    "initial_delay_ms": 1000
  }
}
```

**Features:**
- Tracks retry attempts across multiple calls
- Exponential backoff with configurable delays
- Optional jitter to prevent thundering herd
- Prevents duplicate retries for successful operations

### 💾 Cache Operations

#### cache_get
Retrieve values from cache with TTL support.

```json
{
  "tool": "cache_get",
  "arguments": {
    "key": "user-data-123",
    "namespace": "users"
  }
}
```

#### cache_put
Store values with automatic expiration.

```json
{
  "tool": "cache_put",
  "arguments": {
    "key": "user-data-123",
    "value": { "name": "John", "role": "admin" },
    "ttl_seconds": 300,
    "namespace": "users"
  }
}
```

**Features:**
- Namespace support to prevent key collisions
- Automatic cleanup of expired entries
- Configurable TTL (1 second to 24 hours)
- Memory-efficient storage

### 🚀 batch_operation

Process multiple operations with controlled concurrency.

```json
{
  "tool": "batch_operation",
  "arguments": {
    "operations": [
      { "id": "op1", "type": "fetch", "data": { "url": "/api/1" } },
      { "id": "op2", "type": "fetch", "data": { "url": "/api/2" } },
      { "id": "op3", "type": "fetch", "data": { "url": "/api/3" } }
    ],
    "concurrency": 2,
    "timeout_ms": 5000,
    "continue_on_error": true,
    "use_cache": true
  }
}
```

**Features:**
- Configurable concurrency (1-20 operations)
- Per-operation timeout
- Continue or fail-fast on errors
- Optional result caching
- Maintains order of results

### 🚦 rate_limit_check

Implement sliding window rate limiting.

```json
{
  "tool": "rate_limit_check",
  "arguments": {
    "resource": "api.github.com",
    "max_requests": 60,
    "window_seconds": 60,
    "increment": true
  }
}
```

**Features:**
- Per-resource tracking
- Sliding window algorithm
- Automatic reset after time window
- Check without incrementing option

## Integration Examples

### With GitHub MCP Server

```typescript
// Cache GitHub API responses
async function getRepositoryWithCache(owner: string, repo: string) {
  const cacheKey = `github:${owner}/${repo}`;
  
  // Check cache first
  const cached = await mcp_cache_get({
    key: cacheKey,
    namespace: "github"
  });
  
  if (cached.found) {
    return cached.value;
  }
  
  // Fetch with retry
  const data = await retryableGitHubCall(owner, repo);
  
  // Cache for 10 minutes
  await mcp_cache_put({
    key: cacheKey,
    value: data,
    ttl_seconds: 600,
    namespace: "github"
  });
  
  return data;
}
```

### With Slack MCP Server

```typescript
// Rate-limited Slack notifications
async function sendSlackNotifications(messages: string[], channel: string) {
  for (const message of messages) {
    // Check rate limit
    const canSend = await mcp_rate_limit_check({
      resource: `slack:${channel}`,
      max_requests: 10,
      window_seconds: 60,
      increment: true
    });
    
    if (!canSend.allowed) {
      console.log(`Rate limited. Retry in ${canSend.reset_in_seconds}s`);
      await sleep(canSend.reset_in_seconds * 1000);
    }
    
    await mcp_slack_post_message({
      channel_id: channel,
      text: message
    });
  }
}
```

## Architecture

```
┌─────────────────┐     ┌──────────────────┐     ┌─────────────────┐
│                 │     │                  │     │                 │
│  Claude/Client  │────▶│ MCP Utility Tools│────▶│  Cache Storage  │
│                 │     │                  │     │   (In-Memory)   │
└─────────────────┘     └──────────────────┘     └─────────────────┘
         │                       │
         │                       │
         ▼                       ▼
┌─────────────────┐     ┌──────────────────┐
│  Other MCP      │     │  Retry/Rate      │
│  Servers        │     │  Limit Tracking  │
└─────────────────┘     └──────────────────┘
```

## Development

```bash
# Clone the repository
git clone https://github.com/haasonsaas/mcp-utility-tools.git
cd mcp-utility-tools

# Install dependencies
npm install

# Build the project
npm run build

# Run tests
npm test

# Run in development mode
npm run dev
```

## Testing

Run the comprehensive test suite:

```bash
# Unit tests
npm test

# Integration tests with test harness
npm run test:integration

# Test with MCP Inspector
npx @modelcontextprotocol/inspector build/index-v2.js
```

## Contributing

We welcome contributions! Please see our [Contributing Guide](CONTRIBUTING.md) for details.

### Areas for Contribution

- 🔌 **Storage Backends**: Add Redis, SQLite support
- 🔧 **New Tools**: Circuit breakers, request deduplication
- 📊 **Metrics**: Add performance tracking and analytics
- 🌐 **Examples**: More integration examples with other MCP servers

## License

MIT © [Jonathan Haas](LICENSE)

## Acknowledgments

Built on top of the [Model Context Protocol SDK](https://github.com/anthropics/model-context-protocol) by Anthropic.

---

<p align="center">
  Made with ❤️ for the MCP community
</p>