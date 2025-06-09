# Contributing to MCP Utility Tools

Thank you for your interest in contributing to MCP Utility Tools! This document provides guidelines and instructions for contributing.

## Code of Conduct

By participating in this project, you agree to abide by our Code of Conduct:
- Be respectful and inclusive
- Welcome newcomers and help them get started
- Focus on constructive criticism
- Respect differing viewpoints and experiences

## How to Contribute

### Reporting Bugs

1. Check if the bug has already been reported in [Issues](https://github.com/haasonsaas/mcp-utility-tools/issues)
2. If not, create a new issue with:
   - Clear, descriptive title
   - Steps to reproduce
   - Expected vs actual behavior
   - Your environment (OS, Node.js version, etc.)
   - Any relevant logs or screenshots

### Suggesting Features

1. Check existing issues and discussions first
2. Create a new issue with the "enhancement" label
3. Describe the feature and its use case
4. Explain why this would be useful for other users

### Pull Requests

1. Fork the repository
2. Create a feature branch: `git checkout -b feature/your-feature-name`
3. Make your changes following our coding standards
4. Add tests for new functionality
5. Ensure all tests pass: `npm test`
6. Commit with clear messages: `git commit -m "feat: add new cache eviction policy"`
7. Push to your fork: `git push origin feature/your-feature-name`
8. Create a Pull Request

## Development Setup

```bash
# Clone your fork
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

## Coding Standards

### TypeScript Style

- Use TypeScript for all new code
- Enable strict mode
- Provide proper types (avoid `any`)
- Use descriptive variable names
- Add JSDoc comments for public APIs

### Code Organization

```typescript
// Good: Clear, single responsibility
async function cacheGet(key: string, namespace: string = "default"): Promise<CacheResult> {
  const fullKey = getCacheKey(key, namespace);
  const entry = cache.get(fullKey);
  
  if (!entry || isExpired(entry)) {
    return { found: false, key, namespace };
  }
  
  return {
    found: true,
    key,
    namespace,
    value: entry.value,
    expiresIn: getTimeUntilExpiry(entry)
  };
}

// Bad: Multiple responsibilities, unclear types
async function doStuff(data: any) {
  // Avoid this pattern
}
```

### Commit Messages

Follow conventional commits:
- `feat:` New features
- `fix:` Bug fixes
- `docs:` Documentation changes
- `test:` Test additions/changes
- `refactor:` Code refactoring
- `chore:` Maintenance tasks

Examples:
```
feat: add support for Redis backend
fix: handle cache expiration edge case
docs: update README with new examples
test: add batch operation timeout tests
```

## Testing

### Writing Tests

- Write tests for all new functionality
- Use descriptive test names
- Test edge cases and error conditions
- Aim for >80% code coverage

Example:
```typescript
test("cache should return expired entries as not found", async () => {
  await cacheSet("key", "value", 1); // 1 second TTL
  await sleep(1100); // Wait for expiration
  
  const result = await cacheGet("key");
  expect(result.found).toBe(false);
  expect(result.reason).toBe("expired");
});
```

### Running Tests

```bash
# Run all tests
npm test

# Run tests in watch mode
npm run test:watch

# Run with coverage
npm run test:coverage
```

## Adding New Tools

When adding a new MCP tool:

1. Define the tool schema in the tools array
2. Implement the handler in the switch statement
3. Add comprehensive tests
4. Update documentation with examples
5. Consider error cases and edge conditions

Template:
```typescript
// 1. Add to tools array
{
  name: "your_tool_name",
  description: "Clear description of what the tool does",
  inputSchema: {
    type: "object",
    properties: {
      // Define parameters
    },
    required: ["required_params"]
  }
}

// 2. Add handler
case "your_tool_name": {
  const { param1, param2 } = args as YourToolArgs;
  
  // Validate inputs
  if (!isValid(param1)) {
    throw new McpError(ErrorCode.InvalidParams, "Invalid param1");
  }
  
  // Implement logic
  const result = await yourToolLogic(param1, param2);
  
  // Return response
  return {
    content: [{
      type: "text",
      text: JSON.stringify(result)
    }]
  };
}
```

## Documentation

- Update README.md with new features
- Add examples for new tools
- Keep API documentation current
- Include performance considerations

## Performance Guidelines

- Cache operations should be O(1)
- Batch operations should respect concurrency limits
- Clean up expired entries periodically
- Monitor memory usage for large caches

## Questions?

- Open an issue for questions
- Join discussions in the Issues section
- Check existing documentation first

Thank you for contributing!