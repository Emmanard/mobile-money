# Dashboard API Endpoints Reference

## Overview

Three new endpoints have been added to the admin routes to support the CLI dashboard functionality. All endpoints require authentication and return JSON.

## Endpoints

### 1. GET /api/admin/dashboard/stats

**Primary comprehensive dashboard endpoint**

Returns all metrics needed for the full dashboard display in a single call.

**Authentication**: Required (Admin role)
```
Header: X-API-Key: <key>
```

**Response** (HTTP 200):
```json
{
  "timestamp": "2024-06-01T14:35:20.123Z",
  "health": {
    "database": "healthy|degraded|unhealthy",
    "redis": "healthy|degraded|unhealthy",
    "stellar": "healthy|degraded|unhealthy",
    "responseTime": 150
  },
  "queue": {
    "totalJobs": 1234,
    "pendingJobs": 245,
    "activeJobs": 12,
    "completedJobs": 952,
    "failedJobs": 25,
    "dlqSize": 5
  },
  "transactions": {
    "totalCount": 5678,
    "successRate": 97.50,
    "totalVolume": 45678900,
    "activeUsers": 234
  },
  "providers": {
    "MTN": {
      "status": "online|offline|degraded",
      "failureRate": 1.23,
      "lastChecked": "2024-06-01T14:35:20.123Z"
    },
    "Airtel": {
      "status": "online|offline|degraded",
      "failureRate": 0.45,
      "lastChecked": "2024-06-01T14:35:20.123Z"
    },
    "Orange": {
      "status": "online|offline|degraded",
      "failureRate": 5.67,
      "lastChecked": "2024-06-01T14:35:20.123Z"
    }
  }
}
```

**Performance**:
- Response time: 200-500ms
- Fetches metrics in parallel
- Aggregates data from multiple sources

**Error Responses**:
- HTTP 401: Unauthorized (invalid/missing API key)
- HTTP 403: Forbidden (insufficient permissions)
- HTTP 500: Internal server error

**Example Usage**:
```bash
curl -H "X-API-Key: $MOMO_API_KEY" \
  http://localhost:3000/api/admin/dashboard/stats | jq '.'
```

---

### 2. GET /api/admin/health

**Quick health check endpoint**

Fast, lightweight health check for all system components. No authentication required (useful for load balancers).

**Authentication**: Optional (public health check)
```
Header: X-API-Key: <key>  # Optional
```

**Response** (HTTP 200):
```json
{
  "database": "healthy|degraded|unhealthy",
  "redis": "healthy|degraded|unhealthy",
  "stellar": "healthy|degraded|unhealthy",
  "responseTime": 45
}
```

**Performance**:
- Response time: <100ms
- Concurrent checks on all components
- No database query overhead

**Status Codes**:
- HTTP 200: All or most components healthy
- HTTP 503: Service unavailable (multiple components down)

**Example Usage**:
```bash
# No authentication needed
curl http://localhost:3000/api/admin/health | jq '.'

# Check specific component
curl http://localhost:3000/api/admin/health | jq '.database'

# Use in health checks
if curl -s http://localhost:3000/api/admin/health | \
   jq -e '.database == "healthy"' > /dev/null; then
  echo "Database is healthy"
fi
```

---

### 3. GET /api/admin/queue/stats

**Queue-specific metrics endpoint**

Dedicated endpoint for queue management metrics.

**Authentication**: Required (Admin role)
```
Header: X-API-Key: <key>
```

**Response** (HTTP 200):
```json
{
  "totalJobs": 1234,
  "pendingJobs": 245,
  "activeJobs": 12,
  "completedJobs": 952,
  "failedJobs": 25,
  "dlqSize": 5,
  "timestamp": "2024-06-01T14:35:20.123Z"
}
```

**Performance**:
- Response time: <100ms
- Minimal database overhead
- Real-time queue counts

**Fields**:
- **totalJobs**: Sum of all queue states
- **pendingJobs**: Waiting for processing
- **activeJobs**: Currently being processed
- **completedJobs**: Successfully processed
- **failedJobs**: Failed processing attempts
- **dlqSize**: Dead Letter Queue items (requiring intervention)

**Example Usage**:
```bash
curl -H "X-API-Key: $MOMO_API_KEY" \
  http://localhost:3000/api/admin/queue/stats | jq '.dlqSize'

# Alert if DLQ is too large
DLQ=$(curl -s -H "X-API-Key: $MOMO_API_KEY" \
  http://localhost:3000/api/admin/queue/stats | jq '.dlqSize')

if [ $DLQ -gt 100 ]; then
  echo "WARNING: DLQ size is $DLQ"
fi
```

---

## Data Aggregation

### Health Status Determination

**Database**: 
- Checks primary connection pool
- Verifies replica connectivity
- Determines status: healthy if primary OK

**Redis**:
- PING command with timeout
- Response time tracked
- Status: healthy if responds <100ms

**Stellar**:
- Inferred from transaction processing ability
- Status: healthy if recent transactions succeeded
- Can check Horizon API if extended

### Queue Metrics

Fetched from `getQueueStats()` which queries:
- BullMQ queue state
- Active jobs being processed
- Completed job history
- Failed job count
- Dead Letter Queue size

### Transaction Statistics

**Time Window**: Last 24 hours

Aggregates:
- Total transaction count
- Success rate (completed / total)
- Total XAF volume processed
- Active users with transactions

### Provider Status

From `mobileMoneyService.getFailoverStats()`:
- Circuit breaker state
- Recent failure rates
- Request timeouts
- Fallover configuration

---

## Error Handling

### Fallback Strategy

If primary endpoint fails, CLI automatically falls back to:
1. `/api/admin/health` — System component checks
2. `/api/admin/queue/stats` — Queue metrics
3. `/api/stats` — Transaction statistics (existing endpoint)
4. `/api/admin/providers/health` — Provider status (existing endpoint)

### Timeout Handling

```
Individual checks: 5 second timeout
Dashboard aggregation: 10 second timeout
Health check: 2 second timeout
```

Timeouts return degraded status rather than errors:
```json
{
  "database": "degraded",
  "redis": "degraded",
  "stellar": "degraded"
}
```

### Error Messages

Errors are logged but don't fail the request. Missing data returns sensible defaults:

```json
{
  "health": {
    "database": "unhealthy",
    "redis": "unhealthy",
    "stellar": "unhealthy"
  },
  "queue": {
    "totalJobs": 0,
    "pendingJobs": 0,
    ...
  }
}
```

---

## Rate Limiting

**No specific rate limits** for dashboard endpoints. Uses standard admin rate limiting:
- Default: 100 requests per minute per API key
- Can be configured in middleware

---

## Authentication

All endpoints except `/api/admin/health` require:

**API Key Authentication**:
```bash
curl -H "X-API-Key: your-admin-api-key" http://localhost:3000/api/admin/dashboard/stats
```

**Required Role**: `admin` or `super-admin`

---

## Monitoring & Logging

All requests are logged via audit interceptor:
```json
{
  "action": "GET_DASHBOARD_STATS",
  "userId": "user-123",
  "role": "admin",
  "timestamp": "2024-06-01T14:35:20.123Z",
  "method": "GET",
  "path": "/api/admin/dashboard/stats",
  "status": 200,
  "responseTime": 245
}
```

---

## Integration Examples

### Kubernetes Liveness Probe
```yaml
livenessProbe:
  httpGet:
    path: /api/admin/health
    port: 3000
  initialDelaySeconds: 10
  periodSeconds: 10
```

### Load Balancer Health Check
```bash
curl -f http://localhost:3000/api/admin/health || exit 1
```

### Monitoring Script
```bash
while true; do
  METRICS=$(curl -s -H "X-API-Key: $KEY" \
    http://localhost:3000/api/admin/dashboard/stats)
  echo "Queue depth: $(echo $METRICS | jq '.queue.totalJobs')"
  sleep 30
done
```

---

## Changelog

**v1.0.0 (June 1, 2024)**
- Added `/api/admin/dashboard/stats` endpoint
- Added `/api/admin/health` endpoint
- Added `/api/admin/queue/stats` endpoint
- Implemented parallel metric fetching
- Added automatic fallback mechanism
- Response time tracking on all endpoints

---

## Support

For issues or questions:
- Check `cli/DASHBOARD.md` documentation
- Review `cli/EXAMPLES.md` for integration examples
- Check server logs for error details: `docker logs app`
- Verify API key with: `momo-cli auth check`
