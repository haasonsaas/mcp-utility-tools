# Integration Examples: Using MCP Utility Tools with Other MCP Servers

## Overview

The MCP Utility Tools are designed to work alongside other MCP servers. While MCP tools can't directly call each other (they communicate through the client), you can use these utility tools to enhance any workflow.

## Example 1: GitHub API with Retry and Caching

When using the GitHub MCP server, you might want to:
1. Cache API responses to avoid rate limits
2. Retry failed requests automatically

```typescript
// Workflow: Get repository information with caching and retry

// Step 1: Check cache first
const cacheKey = `github:repo:${owner}/${repo}`;
const cached = await client.callTool('cache_get', {
  key: cacheKey,
  namespace: 'github'
});

if (cached.found) {
  return cached.value;
}

// Step 2: Set up retry tracking
const operationId = `github-get-repo-${Date.now()}`;
let attempts = 0;
let result = null;

while (attempts < 3 && !result) {
  // Check if we should retry
  const retryCheck = await client.callTool('retry_operation', {
    operation_id: operationId,
    operation_type: 'http_request',
    operation_data: { 
      tool: 'github_get_repository',
      args: { owner, name: repo }
    },
    max_retries: 3,
    initial_delay_ms: 2000
  });

  if (retryCheck.status === 'execute_attempt') {
    try {
      // Call the actual GitHub tool
      result = await client.callTool('github_get_repository', {
        owner,
        name: repo
      });
      
      // Cache the successful result
      await client.callTool('cache_put', {
        key: cacheKey,
        value: result,
        ttl_seconds: 300, // 5 minutes
        namespace: 'github'
      });
    } catch (error) {
      attempts++;
      // Will retry on next iteration
    }
  } else if (retryCheck.status === 'retry_delayed') {
    // Wait before retrying
    await new Promise(resolve => setTimeout(resolve, retryCheck.wait_ms));
  } else {
    // Max retries exceeded or already succeeded
    break;
  }
}
```

## Example 2: Batch Processing Multiple Sentry Issues

When working with Sentry MCP server to process multiple issues:

```typescript
// Step 1: Check rate limits
const rateCheck = await client.callTool('rate_limit_check', {
  resource: 'sentry-api',
  max_requests: 100,
  window_seconds: 60,
  increment: false // Just checking
});

if (rateCheck.remaining < issueIds.length) {
  console.log(`Warning: Only ${rateCheck.remaining} requests remaining`);
}

// Step 2: Create batch operations for all issues
const operations = issueIds.map(issueId => ({
  id: `sentry-issue-${issueId}`,
  type: 'sentry_get_issue',
  data: { 
    organizationSlug: 'my-org',
    issueId 
  }
}));

// Step 3: Process with controlled concurrency
const batchResult = await client.callTool('batch_operation', {
  operations,
  concurrency: 5, // Respect rate limits
  timeout_ms: 10000,
  continue_on_error: true,
  use_cache: true,
  cache_ttl_seconds: 600 // Cache for 10 minutes
});

// Step 4: Process results
const successfulIssues = batchResult.results
  .filter(r => r.success)
  .map(r => r.result);
```

## Example 3: Slack Notifications with Rate Limiting

When sending multiple Slack messages:

```typescript
async function sendSlackMessage(channel: string, message: string) {
  // Check rate limit
  const rateCheck = await client.callTool('rate_limit_check', {
    resource: `slack:${channel}`,
    max_requests: 10,
    window_seconds: 60,
    increment: true
  });

  if (!rateCheck.allowed) {
    throw new Error(`Rate limited. Reset in ${rateCheck.reset_in_seconds}s`);
  }

  // Send with retry
  const operationId = `slack-send-${Date.now()}`;
  
  const retry = await client.callTool('retry_operation', {
    operation_id: operationId,
    operation_type: 'slack_message',
    operation_data: { channel, text: message }
  });

  if (retry.status === 'execute_attempt') {
    return await client.callTool('slack_post_message', {
      channel_id: channel,
      text: message
    });
  }
}
```

## Example 4: File System Operations with Caching

When working with the filesystem MCP server:

```typescript
async function getFileContent(filePath: string) {
  // Use path as cache key
  const cacheKey = `file:${filePath}`;
  
  // Check cache first
  const cached = await client.callTool('cache_get', {
    key: cacheKey,
    namespace: 'filesystem'
  });

  if (cached.found) {
    console.log('Returning cached file content');
    return cached.value;
  }

  // Read file
  const content = await client.callTool('read_file', {
    path: filePath
  });

  // Cache for 1 minute (useful for config files)
  await client.callTool('cache_put', {
    key: cacheKey,
    value: content,
    ttl_seconds: 60,
    namespace: 'filesystem'
  });

  return content;
}
```

## Example 5: Complex Workflow - Deploy with Notifications

A complete workflow using multiple MCP servers:

```typescript
async function deployWithNotifications(projectId: string) {
  const deployId = `deploy-${projectId}-${Date.now()}`;
  
  try {
    // 1. Check if we can deploy (rate limit)
    const deployCheck = await client.callTool('rate_limit_check', {
      resource: 'deployments',
      max_requests: 5,
      window_seconds: 3600, // 5 deploys per hour
      increment: true
    });

    if (!deployCheck.allowed) {
      await client.callTool('slack_post_message', {
        channel_id: 'engineering',
        text: `⚠️ Deploy rate limit reached. Next deploy in ${deployCheck.reset_in_seconds}s`
      });
      return;
    }

    // 2. Notify start
    await client.callTool('slack_post_message', {
      channel_id: 'deployments',
      text: `🚀 Starting deployment for ${projectId}...`
    });

    // 3. Get build info (with caching)
    const buildInfo = await getCachedBuildInfo(projectId);

    // 4. Deploy with retry
    const deployResult = await deployWithRetry(deployId, projectId);

    // 5. Update GitHub PR
    await client.callTool('github_create_comment', {
      owner: 'my-org',
      repo: projectId,
      issue_number: buildInfo.prNumber,
      body: `✅ Deployed to production: ${deployResult.url}`
    });

    // 6. Create Sentry release
    await client.callTool('sentry_create_release', {
      organizationSlug: 'my-org',
      version: buildInfo.version,
      projects: [projectId]
    });

    // 7. Final notification
    await client.callTool('slack_post_message', {
      channel_id: 'deployments',
      text: `✅ ${projectId} deployed successfully!`
    });

  } catch (error) {
    // Error notification with retry
    const errorNotifyId = `error-notify-${Date.now()}`;
    await retryOperation(errorNotifyId, async () => {
      await client.callTool('slack_post_message', {
        channel_id: 'engineering',
        text: `❌ Deployment failed for ${projectId}: ${error.message}`
      });
    });
  }
}
```

## Best Practices for Integration

1. **Always Check Cache First**: Reduce API calls and improve performance
2. **Use Rate Limiting**: Prevent hitting API limits
3. **Implement Retry Logic**: Handle transient failures gracefully
4. **Batch When Possible**: Process multiple items efficiently
5. **Namespace Your Cache**: Prevent key collisions between different tools

## Configuration for Multiple MCP Servers

Add all servers to your Claude Desktop config:

```json
{
  "mcpServers": {
    "utility-tools": {
      "command": "node",
      "args": ["/path/to/mcp-utility-tools/build/index-v2.js"]
    },
    "github": {
      "command": "npx",
      "args": ["@modelcontextprotocol/server-github"],
      "env": {
        "GITHUB_PERSONAL_ACCESS_TOKEN": "your-token"
      }
    },
    "slack": {
      "command": "npx",
      "args": ["@modelcontextprotocol/server-slack"],
      "env": {
        "SLACK_BOT_TOKEN": "your-token"
      }
    },
    "sentry": {
      "command": "node",
      "args": ["/path/to/sentry-mcp-server/index.js"],
      "env": {
        "SENTRY_AUTH_TOKEN": "your-token"
      }
    }
  }
}
```

## Limitations and Considerations

1. **No Direct Tool-to-Tool Calls**: MCP tools can't call each other directly. The client (e.g., Claude) must orchestrate the calls.

2. **State Management**: The utility tools maintain state (cache, retry counts) within their server instance. This state is not shared across different MCP server instances.

3. **Error Handling**: Always wrap tool calls in try-catch blocks and use the retry tool for critical operations.

4. **Performance**: The batch_operation tool simulates concurrency but actual execution depends on the client's implementation.

5. **Security**: Be careful about what you cache - don't cache sensitive data like tokens or passwords.