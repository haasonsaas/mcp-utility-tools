#!/usr/bin/env node
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  McpError,
  ErrorCode
} from "@modelcontextprotocol/sdk/types.js";
import { setTimeout } from "node:timers/promises";

// Cache storage with TTL support
interface CacheEntry {
  value: any;
  expiresAt: number;
}

const cache = new Map<string, CacheEntry>();

// Clean up expired cache entries periodically
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of cache.entries()) {
    if (entry.expiresAt <= now) {
      cache.delete(key);
    }
  }
}, 60000); // Clean every minute

// Create server
const server = new Server({
  name: "mcp-utility-tools",
  version: "1.0.0",
}, {
  capabilities: {
    tools: {}
  }
});

// Define tools
const tools = [
  {
    name: "retry_with_backoff",
    description: "Execute a tool with automatic retry and exponential backoff for failures",
    inputSchema: {
      type: "object",
      properties: {
        tool_name: {
          type: "string",
          description: "Name of the tool to execute"
        },
        args: {
          type: "object",
          description: "Arguments to pass to the tool"
        },
        max_retries: {
          type: "number",
          description: "Maximum number of retry attempts",
          default: 3,
          minimum: 1,
          maximum: 10
        },
        initial_delay_ms: {
          type: "number",
          description: "Initial delay in milliseconds before first retry",
          default: 1000,
          minimum: 100,
          maximum: 60000
        },
        max_delay_ms: {
          type: "number",
          description: "Maximum delay between retries",
          default: 30000
        },
        jitter: {
          type: "boolean",
          description: "Add random jitter to retry delays",
          default: true
        }
      },
      required: ["tool_name", "args"]
    }
  },
  {
    name: "cache_get",
    description: "Get a value from the cache by key",
    inputSchema: {
      type: "object",
      properties: {
        key: {
          type: "string",
          description: "Cache key to retrieve"
        }
      },
      required: ["key"]
    }
  },
  {
    name: "cache_put",
    description: "Store a value in the cache with TTL",
    inputSchema: {
      type: "object",
      properties: {
        key: {
          type: "string",
          description: "Cache key"
        },
        value: {
          description: "Value to cache (any JSON-serializable data)"
        },
        ttl_seconds: {
          type: "number",
          description: "Time to live in seconds",
          default: 300,
          minimum: 1,
          maximum: 86400 // 24 hours
        }
      },
      required: ["key", "value"]
    }
  },
  {
    name: "cache_delete",
    description: "Delete a key from the cache",
    inputSchema: {
      type: "object",
      properties: {
        key: {
          type: "string",
          description: "Cache key to delete"
        }
      },
      required: ["key"]
    }
  },
  {
    name: "cache_clear",
    description: "Clear all entries from the cache",
    inputSchema: {
      type: "object",
      properties: {}
    }
  },
  {
    name: "fork_join",
    description: "Execute multiple tool calls in parallel and return all results",
    inputSchema: {
      type: "object",
      properties: {
        calls: {
          type: "array",
          description: "Array of tool calls to execute in parallel",
          items: {
            type: "object",
            properties: {
              tool_name: {
                type: "string",
                description: "Name of the tool to execute"
              },
              args: {
                type: "object",
                description: "Arguments for the tool"
              }
            },
            required: ["tool_name", "args"]
          },
          minItems: 1,
          maxItems: 10
        },
        timeout_ms: {
          type: "number",
          description: "Overall timeout for all operations",
          default: 30000,
          minimum: 1000,
          maximum: 300000 // 5 minutes
        },
        continue_on_error: {
          type: "boolean",
          description: "Continue executing even if some calls fail",
          default: true
        }
      },
      required: ["calls"]
    }
  }
];

// Register list handler
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return { tools };
});

// Helper function to execute a tool call
async function executeToolCall(toolName: string, args: any): Promise<any[]> {
  // This would normally call back into the MCP client to execute the tool
  // For this utility server, we'll simulate tool execution
  // In a real implementation, this would need access to the client's tool execution context
  
  // For now, return a mock response indicating the limitation
  return [{
    type: "text",
    text: JSON.stringify({
      error: "Tool execution requires integration with MCP client context",
      tool: toolName,
      args: args
    })
  }];
}

// Register call handler
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    switch (name) {
      case "retry_with_backoff": {
        const {
          tool_name,
          args: toolArgs,
          max_retries = 3,
          initial_delay_ms = 1000,
          max_delay_ms = 30000,
          jitter = true
        } = args as any;

        let lastError: Error | null = null;
        let delay = initial_delay_ms;

        for (let attempt = 0; attempt <= max_retries; attempt++) {
          try {
            if (attempt > 0) {
              // Add jitter if enabled
              const jitterAmount = jitter ? Math.random() * 0.3 * delay : 0;
              const actualDelay = delay + jitterAmount;
              
              console.error(`Retry attempt ${attempt} after ${actualDelay}ms delay`);
              await setTimeout(actualDelay);
            }

            // Execute the tool
            const result = await executeToolCall(tool_name, toolArgs);
            
            return {
              content: [{
                type: "text",
                text: JSON.stringify({
                  success: true,
                  attempts: attempt + 1,
                  result: result
                }, null, 2)
              }]
            };
          } catch (error) {
            lastError = error as Error;
            console.error(`Attempt ${attempt + 1} failed:`, error);
            
            // Calculate next delay with exponential backoff
            delay = Math.min(delay * 2, max_delay_ms);
          }
        }

        throw new McpError(
          ErrorCode.InternalError,
          `Failed after ${max_retries + 1} attempts: ${lastError?.message}`
        );
      }

      case "cache_get": {
        const { key } = args as { key: string };
        
        const entry = cache.get(key);
        if (!entry) {
          return {
            content: [{
              type: "text",
              text: JSON.stringify({ found: false, key })
            }]
          };
        }

        // Check if expired
        if (entry.expiresAt <= Date.now()) {
          cache.delete(key);
          return {
            content: [{
              type: "text",
              text: JSON.stringify({ found: false, key, reason: "expired" })
            }]
          };
        }

        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              found: true,
              key,
              value: entry.value,
              expires_in_seconds: Math.floor((entry.expiresAt - Date.now()) / 1000)
            })
          }]
        };
      }

      case "cache_put": {
        const { key, value, ttl_seconds = 300 } = args as any;
        
        const expiresAt = Date.now() + (ttl_seconds * 1000);
        cache.set(key, { value, expiresAt });

        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              success: true,
              key,
              ttl_seconds,
              expires_at: new Date(expiresAt).toISOString()
            })
          }]
        };
      }

      case "cache_delete": {
        const { key } = args as { key: string };
        
        const existed = cache.delete(key);
        
        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              success: true,
              key,
              existed
            })
          }]
        };
      }

      case "cache_clear": {
        const size = cache.size;
        cache.clear();
        
        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              success: true,
              cleared_entries: size
            })
          }]
        };
      }

      case "fork_join": {
        const {
          calls,
          timeout_ms = 30000,
          continue_on_error = true
        } = args as any;

        // Create promises for all calls
        const promises = calls.map(async (call: any, index: number) => {
          try {
            const result = await executeToolCall(call.tool_name, call.args);
            return {
              index,
              success: true,
              tool_name: call.tool_name,
              result
            };
          } catch (error) {
            const errorResult = {
              index,
              success: false,
              tool_name: call.tool_name,
              error: (error as Error).message
            };
            
            if (!continue_on_error) {
              throw error;
            }
            
            return errorResult;
          }
        });

        // Execute with timeout
        const timeoutPromise = setTimeout(timeout_ms).then(() => {
          throw new Error(`Fork-join timeout after ${timeout_ms}ms`);
        });

        try {
          const results = await Promise.race([
            Promise.all(promises),
            timeoutPromise
          ]);

          return {
            content: [{
              type: "text",
              text: JSON.stringify({
                success: true,
                total_calls: calls.length,
                results: results
              }, null, 2)
            }]
          };
        } catch (error) {
          if ((error as Error).message.includes('timeout')) {
            throw new McpError(
              ErrorCode.InternalError,
              `Fork-join operation timed out after ${timeout_ms}ms`
            );
          }
          throw error;
        }
      }

      default:
        throw new McpError(
          ErrorCode.MethodNotFound,
          `Unknown tool: ${name}`
        );
    }
  } catch (error) {
    if (error instanceof McpError) {
      throw error;
    }
    
    throw new McpError(
      ErrorCode.InternalError,
      `Tool execution failed: ${(error as Error).message}`
    );
  }
});

// Start server
const transport = new StdioServerTransport();
await server.connect(transport);

console.error("MCP Utility Tools Server running on stdio");