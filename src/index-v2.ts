#!/usr/bin/env node
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  McpError,
  ErrorCode,
} from "@modelcontextprotocol/sdk/types.js";
import { setTimeout } from "node:timers/promises";

// Cache storage with TTL support
interface CacheEntry {
  value: any;
  expiresAt: number;
}

const cache = new Map<string, CacheEntry>();

// Store for tracking retry metadata
const retryMetadata = new Map<string, {
  attempts: number;
  lastAttempt: number;
  success: boolean;
}>();

// Clean up expired cache entries periodically
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of cache.entries()) {
    if (entry.expiresAt <= now) {
      cache.delete(key);
    }
  }
  
  // Clean old retry metadata (older than 1 hour)
  for (const [key, meta] of retryMetadata.entries()) {
    if (meta.lastAttempt < now - 3600000) {
      retryMetadata.delete(key);
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

// Define tools with a more practical approach
const tools = [
  {
    name: "retry_operation",
    description: "Retry an operation with exponential backoff. Use this for operations that might fail temporarily (API calls, network requests, etc.)",
    inputSchema: {
      type: "object",
      properties: {
        operation_id: {
          type: "string",
          description: "Unique identifier for this operation (used for tracking retries)"
        },
        operation_type: {
          type: "string",
          enum: ["http_request", "database_query", "file_operation", "custom"],
          description: "Type of operation being retried"
        },
        operation_data: {
          type: "object",
          description: "Data specific to the operation (e.g., URL for HTTP, query for DB)"
        },
        max_retries: {
          type: "number",
          default: 3,
          minimum: 1,
          maximum: 10
        },
        initial_delay_ms: {
          type: "number",
          default: 1000,
          minimum: 100,
          maximum: 60000
        },
        should_execute: {
          type: "boolean",
          description: "If false, just returns retry metadata without executing",
          default: true
        }
      },
      required: ["operation_id", "operation_type", "operation_data"]
    }
  },
  {
    name: "cache_get",
    description: "Get a value from the cache by key. Returns null if not found or expired.",
    inputSchema: {
      type: "object",
      properties: {
        key: {
          type: "string",
          description: "Cache key to retrieve"
        },
        namespace: {
          type: "string",
          description: "Optional namespace to prevent key collisions",
          default: "default"
        }
      },
      required: ["key"]
    }
  },
  {
    name: "cache_put",
    description: "Store a value in the cache with TTL. Useful for caching API responses, computed values, etc.",
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
        },
        namespace: {
          type: "string",
          description: "Optional namespace to prevent key collisions",
          default: "default"
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
        },
        namespace: {
          type: "string",
          description: "Optional namespace",
          default: "default"
        }
      },
      required: ["key"]
    }
  },
  {
    name: "cache_clear",
    description: "Clear all entries from the cache or a specific namespace",
    inputSchema: {
      type: "object",
      properties: {
        namespace: {
          type: "string",
          description: "Clear only this namespace, or all if not specified"
        }
      }
    }
  },
  {
    name: "batch_operation",
    description: "Process multiple operations with configurable concurrency and error handling",
    inputSchema: {
      type: "object",
      properties: {
        operations: {
          type: "array",
          description: "Array of operations to process",
          items: {
            type: "object",
            properties: {
              id: {
                type: "string",
                description: "Unique identifier for this operation"
              },
              type: {
                type: "string",
                description: "Type of operation"
              },
              data: {
                type: "object",
                description: "Operation-specific data"
              }
            },
            required: ["id", "type", "data"]
          },
          minItems: 1,
          maxItems: 100
        },
        concurrency: {
          type: "number",
          description: "Maximum number of concurrent operations",
          default: 5,
          minimum: 1,
          maximum: 20
        },
        timeout_ms: {
          type: "number",
          description: "Timeout per operation in milliseconds",
          default: 30000,
          minimum: 1000,
          maximum: 300000
        },
        continue_on_error: {
          type: "boolean",
          description: "Continue processing even if some operations fail",
          default: true
        },
        use_cache: {
          type: "boolean",
          description: "Cache successful results",
          default: false
        },
        cache_ttl_seconds: {
          type: "number",
          description: "TTL for cached results",
          default: 300
        }
      },
      required: ["operations"]
    }
  },
  {
    name: "rate_limit_check",
    description: "Check if an operation should be rate-limited",
    inputSchema: {
      type: "object",
      properties: {
        resource: {
          type: "string",
          description: "Resource identifier (e.g., 'api.github.com')"
        },
        max_requests: {
          type: "number",
          description: "Maximum requests allowed",
          default: 60
        },
        window_seconds: {
          type: "number",
          description: "Time window in seconds",
          default: 60
        },
        increment: {
          type: "boolean",
          description: "Increment the counter if allowed",
          default: true
        }
      },
      required: ["resource"]
    }
  }
];

// Rate limiting storage
const rateLimits = new Map<string, { count: number; resetAt: number }>();

// Helper to generate cache key
function getCacheKey(key: string, namespace: string = "default"): string {
  return `${namespace}:${key}`;
}

// Register list handler
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return { tools };
});

// Register call handler
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    switch (name) {
      case "retry_operation": {
        const {
          operation_id,
          operation_type,
          operation_data,
          max_retries = 3,
          initial_delay_ms = 1000,
          should_execute = true
        } = args as any;

        // Get or create retry metadata
        let metadata = retryMetadata.get(operation_id) || {
          attempts: 0,
          lastAttempt: 0,
          success: false
        };

        // Check if we should retry
        if (metadata.success) {
          return {
            content: [{
              type: "text",
              text: JSON.stringify({
                operation_id,
                status: "already_succeeded",
                attempts: metadata.attempts,
                message: "Operation already completed successfully"
              })
            }]
          };
        }

        if (metadata.attempts >= max_retries) {
          return {
            content: [{
              type: "text",
              text: JSON.stringify({
                operation_id,
                status: "max_retries_exceeded",
                attempts: metadata.attempts,
                message: "Maximum retry attempts reached"
              })
            }]
          };
        }

        // Calculate delay with exponential backoff
        const timeSinceLastAttempt = Date.now() - metadata.lastAttempt;
        const requiredDelay = initial_delay_ms * Math.pow(2, metadata.attempts);
        
        if (metadata.attempts > 0 && timeSinceLastAttempt < requiredDelay) {
          const waitTime = requiredDelay - timeSinceLastAttempt;
          return {
            content: [{
              type: "text",
              text: JSON.stringify({
                operation_id,
                status: "retry_delayed",
                attempts: metadata.attempts,
                wait_ms: waitTime,
                message: `Retry delayed. Wait ${waitTime}ms before next attempt`
              })
            }]
          };
        }

        if (!should_execute) {
          return {
            content: [{
              type: "text",
              text: JSON.stringify({
                operation_id,
                status: "ready_to_execute",
                attempts: metadata.attempts,
                next_delay_ms: requiredDelay,
                operation_type,
                operation_data
              })
            }]
          };
        }

        // Update metadata for this attempt
        metadata.attempts += 1;
        metadata.lastAttempt = Date.now();
        retryMetadata.set(operation_id, metadata);

        // Here we return instructions for what should be retried
        // In practice, the calling system would execute the actual operation
        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              operation_id,
              status: "execute_attempt",
              attempt_number: metadata.attempts,
              operation_type,
              operation_data,
              instructions: "Execute the operation and call retry_operation again with the result"
            })
          }]
        };
      }

      case "cache_get": {
        const { key, namespace = "default" } = args as any;
        const cacheKey = getCacheKey(key, namespace);
        
        const entry = cache.get(cacheKey);
        if (!entry) {
          return {
            content: [{
              type: "text",
              text: JSON.stringify({ 
                found: false, 
                key,
                namespace
              })
            }]
          };
        }

        // Check if expired
        if (entry.expiresAt <= Date.now()) {
          cache.delete(cacheKey);
          return {
            content: [{
              type: "text",
              text: JSON.stringify({ 
                found: false, 
                key,
                namespace,
                reason: "expired" 
              })
            }]
          };
        }

        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              found: true,
              key,
              namespace,
              value: entry.value,
              expires_in_seconds: Math.floor((entry.expiresAt - Date.now()) / 1000)
            })
          }]
        };
      }

      case "cache_put": {
        const { key, value, ttl_seconds = 300, namespace = "default" } = args as any;
        const cacheKey = getCacheKey(key, namespace);
        
        const expiresAt = Date.now() + (ttl_seconds * 1000);
        cache.set(cacheKey, { value, expiresAt });

        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              success: true,
              key,
              namespace,
              ttl_seconds,
              expires_at: new Date(expiresAt).toISOString(),
              cache_size: cache.size
            })
          }]
        };
      }

      case "cache_delete": {
        const { key, namespace = "default" } = args as any;
        const cacheKey = getCacheKey(key, namespace);
        
        const existed = cache.delete(cacheKey);
        
        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              success: true,
              key,
              namespace,
              existed
            })
          }]
        };
      }

      case "cache_clear": {
        const { namespace } = args as any;
        
        if (namespace) {
          let cleared = 0;
          const prefix = `${namespace}:`;
          for (const key of cache.keys()) {
            if (key.startsWith(prefix)) {
              cache.delete(key);
              cleared++;
            }
          }
          
          return {
            content: [{
              type: "text",
              text: JSON.stringify({
                success: true,
                namespace,
                cleared_entries: cleared
              })
            }]
          };
        } else {
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
      }

      case "batch_operation": {
        const {
          operations,
          concurrency = 5,
          timeout_ms = 30000,
          continue_on_error = true,
          use_cache = false,
          cache_ttl_seconds = 300
        } = args as any;

        const results: any[] = [];
        const queue = [...operations];
        const inProgress = new Map<string, Promise<any>>();
        
        // Process operations with controlled concurrency
        while (queue.length > 0 || inProgress.size > 0) {
          // Start new operations up to concurrency limit
          while (queue.length > 0 && inProgress.size < concurrency) {
            const op = queue.shift()!;
            
            // Check cache first if enabled
            if (use_cache) {
              const cacheKey = `batch:${op.type}:${JSON.stringify(op.data)}`;
              const cached = cache.get(cacheKey);
              if (cached && cached.expiresAt > Date.now()) {
                results.push({
                  id: op.id,
                  success: true,
                  cached: true,
                  result: cached.value
                });
                continue;
              }
            }
            
            // Create operation promise
            const promise = Promise.race([
              // Simulate operation execution
              (async () => {
                // In real implementation, this would execute the actual operation
                await setTimeout(Math.random() * 1000); // Simulate work
                
                const result = {
                  id: op.id,
                  type: op.type,
                  data: op.data,
                  processed_at: new Date().toISOString()
                };
                
                // Cache result if enabled
                if (use_cache) {
                  const cacheKey = `batch:${op.type}:${JSON.stringify(op.data)}`;
                  cache.set(cacheKey, {
                    value: result,
                    expiresAt: Date.now() + (cache_ttl_seconds * 1000)
                  });
                }
                
                return result;
              })(),
              // Timeout promise
              setTimeout(timeout_ms).then(() => {
                throw new Error(`Operation ${op.id} timed out`);
              })
            ]);
            
            inProgress.set(op.id, promise);
            
            // Handle completion
            promise
              .then(result => {
                results.push({
                  id: op.id,
                  success: true,
                  result
                });
              })
              .catch(error => {
                results.push({
                  id: op.id,
                  success: false,
                  error: error.message
                });
                
                if (!continue_on_error) {
                  // Cancel remaining operations
                  queue.length = 0;
                }
              })
              .finally(() => {
                inProgress.delete(op.id);
              });
          }
          
          // Wait for at least one operation to complete
          if (inProgress.size > 0) {
            await Promise.race(inProgress.values());
          }
        }

        // Sort results to match input order
        const sortedResults = operations.map((op: any) => 
          results.find(r => r.id === op.id)
        );

        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              success: true,
              total_operations: operations.length,
              successful: results.filter(r => r.success).length,
              failed: results.filter(r => !r.success).length,
              results: sortedResults
            }, null, 2)
          }]
        };
      }

      case "rate_limit_check": {
        const {
          resource,
          max_requests = 60,
          window_seconds = 60,
          increment = true
        } = args as any;

        const now = Date.now();
        const windowMs = window_seconds * 1000;
        
        let limit = rateLimits.get(resource);
        
        // Initialize or reset if window expired
        if (!limit || limit.resetAt <= now) {
          limit = {
            count: 0,
            resetAt: now + windowMs
          };
          rateLimits.set(resource, limit);
        }
        
        const allowed = limit.count < max_requests;
        const remaining = Math.max(0, max_requests - limit.count);
        const resetIn = Math.ceil((limit.resetAt - now) / 1000);
        
        if (allowed && increment) {
          limit.count++;
        }
        
        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              allowed,
              resource,
              current_count: limit.count,
              max_requests,
              remaining,
              reset_in_seconds: resetIn,
              reset_at: new Date(limit.resetAt).toISOString()
            })
          }]
        };
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