# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [1.0.0] - 2024-12-08

### Added
- Initial release of MCP Utility Tools
- `retry_operation` tool with exponential backoff and jitter
- `cache_get`, `cache_put`, `cache_delete`, `cache_clear` tools with TTL support
- `batch_operation` tool for parallel processing with concurrency control
- `rate_limit_check` tool with sliding window rate limiting
- Comprehensive test suite and test harness
- Full TypeScript support with type definitions
- Integration examples with other MCP servers
- MCP Inspector compatibility

### Features
- In-memory cache with automatic expiration
- Namespace support for cache isolation
- Configurable retry delays and maximum attempts
- Per-operation timeouts in batch processing
- Continue-on-error support for batch operations
- Optional result caching in batch operations
- Per-resource rate limiting with automatic reset

### Documentation
- Comprehensive README with examples
- Contributing guidelines
- Integration patterns with GitHub, Slack, and Sentry MCP servers
- Architecture overview

[Unreleased]: https://github.com/haasonsaas/mcp-utility-tools/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/haasonsaas/mcp-utility-tools/releases/tag/v1.0.0