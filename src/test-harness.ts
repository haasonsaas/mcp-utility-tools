#!/usr/bin/env node
import { spawn } from 'child_process';
import { createInterface } from 'readline';

// MCP JSON-RPC message structure
interface JsonRpcMessage {
  jsonrpc: '2.0';
  id?: number;
  method?: string;
  params?: any;
  result?: any;
  error?: any;
}

class MCPTestClient {
  private process: any;
  private rl: any;
  private messageId = 1;
  private pendingRequests = new Map<number, { resolve: Function; reject: Function }>();

  constructor(private serverPath: string) {}

  async start() {
    console.log(`Starting MCP server: ${this.serverPath}`);
    
    this.process = spawn('node', [this.serverPath], {
      stdio: ['pipe', 'pipe', 'pipe']
    });

    this.rl = createInterface({
      input: this.process.stdout,
      crlfDelay: Infinity
    });

    // Handle server responses
    this.rl.on('line', (line: string) => {
      try {
        const message = JSON.parse(line) as JsonRpcMessage;
        if (message.id && this.pendingRequests.has(message.id)) {
          const { resolve, reject } = this.pendingRequests.get(message.id)!;
          this.pendingRequests.delete(message.id);
          
          if (message.error) {
            reject(new Error(message.error.message));
          } else {
            resolve(message.result);
          }
        }
      } catch (e) {
        // Ignore non-JSON lines (like console.error output)
      }
    });

    this.process.stderr.on('data', (data: Buffer) => {
      console.error('Server stderr:', data.toString());
    });

    // Initialize connection
    await this.sendRequest('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: {
        name: 'test-harness',
        version: '1.0.0'
      }
    });

    console.log('MCP server initialized');
  }

  async sendRequest(method: string, params?: any): Promise<any> {
    const id = this.messageId++;
    const message: JsonRpcMessage = {
      jsonrpc: '2.0',
      id,
      method,
      params
    };

    return new Promise((resolve, reject) => {
      this.pendingRequests.set(id, { resolve, reject });
      this.process.stdin.write(JSON.stringify(message) + '\n');
    });
  }

  async listTools() {
    return await this.sendRequest('tools/list');
  }

  async callTool(name: string, args: any) {
    return await this.sendRequest('tools/call', {
      name,
      arguments: args
    });
  }

  async stop() {
    this.process.kill();
    this.rl.close();
  }
}

// Test functions
async function testCacheOperations(client: MCPTestClient) {
  console.log('\n=== Testing Cache Operations ===');
  
  // Test cache put
  console.log('1. Testing cache_put...');
  const putResult = await client.callTool('cache_put', {
    key: 'test-key',
    value: { name: 'John Doe', age: 30 },
    ttl_seconds: 60,
    namespace: 'users'
  });
  console.log('Put result:', JSON.parse(putResult.content[0].text));

  // Test cache get - should find it
  console.log('\n2. Testing cache_get (should find)...');
  const getResult = await client.callTool('cache_get', {
    key: 'test-key',
    namespace: 'users'
  });
  console.log('Get result:', JSON.parse(getResult.content[0].text));

  // Test cache get - different namespace
  console.log('\n3. Testing cache_get (different namespace)...');
  const getMissResult = await client.callTool('cache_get', {
    key: 'test-key',
    namespace: 'products'
  });
  console.log('Get miss result:', JSON.parse(getMissResult.content[0].text));

  // Test cache delete
  console.log('\n4. Testing cache_delete...');
  const deleteResult = await client.callTool('cache_delete', {
    key: 'test-key',
    namespace: 'users'
  });
  console.log('Delete result:', JSON.parse(deleteResult.content[0].text));

  // Test cache clear
  console.log('\n5. Testing cache_clear...');
  await client.callTool('cache_put', { key: 'key1', value: 'val1' });
  await client.callTool('cache_put', { key: 'key2', value: 'val2' });
  const clearResult = await client.callTool('cache_clear', {});
  console.log('Clear result:', JSON.parse(clearResult.content[0].text));
}

async function testRetryOperations(client: MCPTestClient) {
  console.log('\n=== Testing Retry Operations ===');
  
  const operationId = 'test-retry-' + Date.now();
  
  // First attempt
  console.log('1. First retry attempt...');
  const attempt1 = await client.callTool('retry_operation', {
    operation_id: operationId,
    operation_type: 'http_request',
    operation_data: { url: 'https://api.example.com/data' },
    max_retries: 3,
    initial_delay_ms: 1000
  });
  console.log('Attempt 1:', JSON.parse(attempt1.content[0].text));

  // Simulate failure and retry
  console.log('\n2. Second retry attempt (should show attempt 2)...');
  const attempt2 = await client.callTool('retry_operation', {
    operation_id: operationId,
    operation_type: 'http_request',
    operation_data: { url: 'https://api.example.com/data' },
    max_retries: 3,
    initial_delay_ms: 1000
  });
  console.log('Attempt 2:', JSON.parse(attempt2.content[0].text));

  // Test with different operation ID
  console.log('\n3. Different operation ID...');
  const newOp = await client.callTool('retry_operation', {
    operation_id: 'different-op-' + Date.now(),
    operation_type: 'database_query',
    operation_data: { query: 'SELECT * FROM users' },
    max_retries: 5,
    should_execute: false
  });
  console.log('New operation:', JSON.parse(newOp.content[0].text));
}

async function testBatchOperations(client: MCPTestClient) {
  console.log('\n=== Testing Batch Operations ===');
  
  // Test batch with concurrency
  console.log('1. Testing batch operation with concurrency...');
  const batchResult = await client.callTool('batch_operation', {
    operations: [
      { id: 'op1', type: 'fetch', data: { url: '/api/users/1' } },
      { id: 'op2', type: 'fetch', data: { url: '/api/users/2' } },
      { id: 'op3', type: 'fetch', data: { url: '/api/users/3' } },
      { id: 'op4', type: 'fetch', data: { url: '/api/users/4' } },
      { id: 'op5', type: 'fetch', data: { url: '/api/users/5' } }
    ],
    concurrency: 2,
    timeout_ms: 5000,
    use_cache: true,
    cache_ttl_seconds: 60
  });
  const parsed = JSON.parse(batchResult.content[0].text);
  console.log(`Batch completed: ${parsed.successful} successful, ${parsed.failed} failed`);
  console.log('First result:', parsed.results[0]);

  // Test with cached results
  console.log('\n2. Testing batch with cached results...');
  const cachedBatch = await client.callTool('batch_operation', {
    operations: [
      { id: 'op1', type: 'fetch', data: { url: '/api/users/1' } }
    ],
    use_cache: true
  });
  const cachedParsed = JSON.parse(cachedBatch.content[0].text);
  console.log('Cached result:', cachedParsed.results[0]);
}

async function testRateLimiting(client: MCPTestClient) {
  console.log('\n=== Testing Rate Limiting ===');
  
  const resource = 'test-api-' + Date.now();
  
  // Make requests up to limit
  console.log('1. Making requests up to rate limit...');
  for (let i = 0; i < 5; i++) {
    const result = await client.callTool('rate_limit_check', {
      resource,
      max_requests: 5,
      window_seconds: 60,
      increment: true
    });
    const parsed = JSON.parse(result.content[0].text);
    console.log(`Request ${i + 1}: allowed=${parsed.allowed}, remaining=${parsed.remaining}`);
  }

  // Try one more - should be blocked
  console.log('\n2. Exceeding rate limit...');
  const blockedResult = await client.callTool('rate_limit_check', {
    resource,
    max_requests: 5,
    window_seconds: 60,
    increment: true
  });
  const blockedParsed = JSON.parse(blockedResult.content[0].text);
  console.log(`Blocked request: allowed=${blockedParsed.allowed}, reset_in=${blockedParsed.reset_in_seconds}s`);
}

// Main test runner
async function runTests() {
  const client = new MCPTestClient('./build/index-v2.js');
  
  try {
    await client.start();
    
    // List available tools
    console.log('\n=== Available Tools ===');
    const tools = await client.listTools();
    console.log(`Found ${tools.tools.length} tools:`);
    tools.tools.forEach((tool: any) => {
      console.log(`- ${tool.name}: ${tool.description}`);
    });

    // Run all tests
    await testCacheOperations(client);
    await testRetryOperations(client);
    await testBatchOperations(client);
    await testRateLimiting(client);
    
    console.log('\n=== All tests completed successfully! ===');
  } catch (error) {
    console.error('Test failed:', error);
  } finally {
    await client.stop();
  }
}

// Run tests if called directly
runTests().catch(console.error);