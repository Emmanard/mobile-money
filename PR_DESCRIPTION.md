# Pull Request Description

## Summary

This PR introduces two improvements:

1. **Swagger UI CDN by default** – Swagger UI assets (CSS and JavaScript) are now served from the jsDelivr CDN unless explicitly disabled.
2. **Strict GraphQL query complexity limiting** – Apollo Server now enforces query complexity validation to prevent excessively expensive GraphQL requests.

---

## Changes Made

### Swagger UI CDN Default

**File Modified:** `src/routes/docs.ts`

```ts
// Previously:
const useCdn = process.env.SWAGGER_CDN === 'true';

// Updated to:
// Use CDN for Swagger UI assets unless explicitly disabled via SWAGGER_CDN='false'
const useCdn = process.env.SWAGGER_CDN !== 'false';
```

- Swagger UI now defaults to loading assets from jsDelivr.
- Local assets can still be used by setting `SWAGGER_CDN='false'`.

### GraphQL Query Complexity Limiting

- Configured the `graphql-query-complexity` validation rule in Apollo Server.
- Enforced a maximum complexity of **500 points per request**.
- Updated query complexity tests to match the new limit.

---

## Impact

### Performance
- Faster Swagger UI loading through CDN-hosted assets.
- Reduced server load from malicious or overly complex GraphQL queries.

### Security & Reliability
- Protects GraphQL endpoints from resource-exhaustion attacks.
- Maintains predictable query execution costs.

### Compatibility
- Existing deployments can retain local Swagger assets by setting `SWAGGER_CDN='false'`.
- No breaking API changes.

---

## Testing

### Swagger UI

1. Run the application with the default configuration.
2. Verify Swagger UI loads assets from:
   `https://cdn.jsdelivr.net/npm/swagger-ui-dist/...`
3. Set `SWAGGER_CDN='false'`.
4. Verify Swagger UI falls back to local assets.

### GraphQL Complexity

1. Verify validation rules in `src/graphql/server.ts`.
2. Verify and update tests in `src/tests/graphql-depth-complexity.test.ts`.
3. Confirm requests exceeding the complexity threshold are rejected.
4. Run all test suites:

```bash
npm test
```

All tests pass successfully.

---

## Upstream

The branch `standardize-mock-assertions` tracks `origin/standardize-mock-assertions` and has been pushed.
