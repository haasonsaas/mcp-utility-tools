# How Claude Uses MCP Utility Tools

## Real-World Scenario: Debugging a Production Issue

Here's how Claude would use these utility tools in practice when investigating and fixing a production issue:

### Scenario: API endpoint returning 500 errors intermittently

```markdown
User: "Our /api/users endpoint is returning 500 errors intermittently. Can you investigate?"

Claude's workflow using MCP tools:
```

#### Step 1: Check Recent Errors (with caching)

```python
# First, check cache for recent Sentry data
cache_result = mcp_cache_get(
    key="sentry-errors-api-users",
    namespace="investigations"
)

if not cache_result["found"]:
    # No cache, fetch from Sentry
    errors = mcp_sentry_find_issues(
        query="is:unresolved url:*/api/users*",
        organizationSlug="evalops",
        projectSlug="backend"
    )
    
    # Cache for 5 minutes to avoid repeated API calls
    mcp_cache_put(
        key="sentry-errors-api-users",
        value=errors,
        ttl_seconds=300,
        namespace="investigations"
    )
```

#### Step 2: Batch Fetch Detailed Error Information

```python
# Get detailed info for top 5 errors using batch operations
error_operations = [
    {
        "id": f"error-{issue['id']}",
        "type": "sentry_get_issue",
        "data": {
            "organizationSlug": "evalops",
            "issueId": issue["id"]
        }
    }
    for issue in errors[:5]
]

batch_result = mcp_batch_operation(
    operations=error_operations,
    concurrency=3,  # Respect Sentry rate limits
    use_cache=True,
    cache_ttl_seconds=600  # Cache for 10 minutes
)
```

#### Step 3: Check Database with Retry Logic

```python
# Database queries might fail due to connection issues
operation_id = f"db-check-{timestamp}"

retry_result = mcp_retry_operation(
    operation_id=operation_id,
    operation_type="database_query",
    operation_data={
        "query": "SELECT COUNT(*) FROM users WHERE created_at > NOW() - INTERVAL '1 hour'"
    },
    max_retries=3,
    initial_delay_ms=2000
)

if retry_result["status"] == "execute_attempt":
    # Execute the actual database query here
    # In practice, Claude would coordinate with a database MCP tool
    pass
```

#### Step 4: Rate-Limited Notifications

```python
# Check if we can send Slack notifications
rate_check = mcp_rate_limit_check(
    resource="slack-engineering",
    max_requests=10,
    window_seconds=300,  # 10 messages per 5 minutes
    increment=True
)

if rate_check["allowed"]:
    # Send notification
    mcp_slack_post_message(
        channel_id="engineering",
        text=f"🔍 Investigating /api/users errors. Found {len(errors)} issues in last hour."
    )
else:
    print(f"Rate limited. Can send again in {rate_check['reset_in_seconds']}s")
```

#### Step 5: Deploy Fix with Coordinated Tools

```python
# After identifying and fixing the issue
deploy_operations = [
    {
        "id": "create-pr",
        "type": "github_create_pr",
        "data": {
            "title": "Fix: Handle null user.expires_at in API",
            "body": "Fixes 500 errors when user.expires_at is null"
        }
    },
    {
        "id": "run-tests",
        "type": "github_action_run",
        "data": {
            "workflow": "test.yml"
        }
    },
    {
        "id": "deploy-staging",
        "type": "deploy",
        "data": {
            "environment": "staging"
        }
    }
]

# Execute deployment steps with proper error handling
deployment_result = mcp_batch_operation(
    operations=deploy_operations,
    concurrency=1,  # Sequential execution
    continue_on_error=False,  # Stop if any step fails
    timeout_ms=300000  # 5 minutes total
)
```

## Common Patterns Claude Uses

### 1. Cache-First Pattern
```python
# Always check cache before expensive operations
def get_data_with_cache(key, fetch_function, ttl=300):
    cached = mcp_cache_get(key=key)
    if cached["found"]:
        return cached["value"]
    
    data = fetch_function()
    mcp_cache_put(key=key, value=data, ttl_seconds=ttl)
    return data
```

### 2. Retry with Backoff Pattern
```python
# For unreliable external services
def reliable_api_call(operation_id, api_function, max_attempts=3):
    for attempt in range(max_attempts):
        retry_check = mcp_retry_operation(
            operation_id=operation_id,
            operation_type="api_call",
            max_retries=max_attempts
        )
        
        if retry_check["status"] == "execute_attempt":
            try:
                return api_function()
            except Exception as e:
                if attempt == max_attempts - 1:
                    raise
                # Continue to next attempt
        elif retry_check["status"] == "retry_delayed":
            time.sleep(retry_check["wait_ms"] / 1000)
```

### 3. Batch with Progress Pattern
```python
# Process large sets with progress tracking
def process_many_items(items, process_func):
    operations = [
        {"id": f"item-{i}", "type": "process", "data": item}
        for i, item in enumerate(items)
    ]
    
    # Process in batches of 10 with concurrency of 3
    for i in range(0, len(operations), 10):
        batch = operations[i:i+10]
        result = mcp_batch_operation(
            operations=batch,
            concurrency=3,
            continue_on_error=True
        )
        
        # Report progress
        completed = i + len(batch)
        print(f"Processed {completed}/{len(items)} items")
```

### 4. Rate Limit Aware Pattern
```python
# Respect API limits automatically
def send_notifications(messages, channel):
    sent = 0
    for message in messages:
        while True:
            rate_check = mcp_rate_limit_check(
                resource=f"slack-{channel}",
                max_requests=20,
                window_seconds=60,
                increment=True
            )
            
            if rate_check["allowed"]:
                mcp_slack_post_message(
                    channel_id=channel,
                    text=message
                )
                sent += 1
                break
            else:
                # Wait for rate limit reset
                print(f"Rate limited. Waiting {rate_check['reset_in_seconds']}s")
                time.sleep(rate_check['reset_in_seconds'])
```

## Benefits for Claude

1. **Reduced Token Usage**: Caching prevents re-fetching the same data
2. **Reliability**: Automatic retries handle transient failures
3. **Efficiency**: Batch operations process multiple items optimally
4. **Compliance**: Rate limiting prevents API abuse
5. **Better UX**: Users see progress and understand delays

## Example Conversation

```markdown
User: "Can you check all our GitHub repos for security vulnerabilities?"

Claude: I'll check all repositories for security vulnerabilities. Let me do this efficiently using caching and batch processing.

[Uses cache_get to check if recent scan exists]
[Uses batch_operation to check multiple repos in parallel]
[Uses rate_limit_check to respect GitHub API limits]
[Uses retry_operation for any failed requests]

Found 47 repositories to scan. This will take a few minutes due to API rate limits.

✓ Processed 10/47 repositories...
✓ Processed 20/47 repositories...
[Rate limited - waiting 30 seconds]
✓ Processed 30/47 repositories...

Summary:
- 3 repositories have critical vulnerabilities
- 8 repositories have high-severity issues
- 12 repositories need dependency updates

[Results cached for 1 hour to avoid re-scanning]
```

This demonstrates how the utility tools make Claude more efficient, reliable, and user-friendly when working with multiple external services.