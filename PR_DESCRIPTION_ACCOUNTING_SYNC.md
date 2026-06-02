# PR Description: QuickBooks/Xero Failed Operations Retry Queue

## Overview
This pull request implements **Issue #975 [MEDIUM]: Create Retry Queue for Failed QuickBooks/Xero Operations**. It introduces a robust, resilient retry mechanism utilizing **BullMQ** with **exponential backoff** to handle transient network issues or API rate-limit errors (HTTP 429) when syncing transaction data to external accounting platforms (QuickBooks Online and Xero).

Additionally, it isolates permanent errors (e.g., payload validation mismatches) from transient ones to immediately halt and discard failed transactions, preventing queue pollution and wasteful API calls.

---

## Architectural Implementation

### 1. Mock Services with Error Classification
- **File**: `src/services/accounting/accountingService.ts`
- **Details**:
  - Implements simulated QuickBooks and Xero API integrations.
  - Custom error classes for strict categorization:
    - **Transient Errors**: `RateLimitError` (HTTP 429), `NetworkError` (Timeout/Outage).
    - **Permanent Errors**: `ValidationError` (Invalid amount, missing reference numbers, incorrect parameters).
  - Offers a deterministic mock injector (`setMockFailures`) for robust unit testing in Jest.

### 2. BullMQ Queue Configurations
- **File**: `src/queue/syncQueue.ts`
- **Details**:
  - Sets up the `accounting-sync` queue under `bullmq`.
  - Configures **exponential backoff** with:
    - `attempts: 5` (max retry attempts).
    - `delay: 3000` (initial delay of 3 seconds, scaling exponentially to 6s, 12s, 24s, 48s).

### 3. Queue Processor / Worker
- **File**: `src/queue/syncWorker.ts`
- **Details**:
  - Implements the processor logic that calls platform sync services.
  - **Transient Handling**: Catches transient errors and rethrows them, prompting BullMQ to register a retry with backoff.
  - **Permanent Handling**: Catches permanent/validation errors, calls `await job.discard()`, and immediately throws to finalize the failure without further retries.

### 4. Admin Routing & Stats APIs
- **File**: `src/routes/accounting.ts`
- **Details**:
  - **`POST /api/accounting/sync`**: Enqueues sync operations with auto-generated unique `syncId`.
  - **`GET /api/accounting/sync/stats`**: Returns wait times, active jobs, completed, and failed counts.
  - **`GET /api/accounting/sync/:jobId`**: Returns status, history, retry attempts, and specific error reports.
- **File**: `src/index.ts`
  - Mounts routes under `/api/accounting` protected by token authentication.

### 5. Centralized Integration
- **File**: `src/queue/index.ts`: Integrates the new worker/queue and ensures clean shutdown.
- **File**: `src/queue/dashboard.ts`: Registers the `accounting-sync` queue on the Bull-board admin UI.

---

## Testing Strategy & Coverage

A dedicated Jest suite has been developed to validate every potential outcome deterministically without real Redis dependencies, preventing socket connection pollution (`ECONNREFUSED` errors).

- **File**: `tests/queue/accountingSync.test.ts`
- **Test Scenarios Covered**:
  1. **Success QuickBooks Sync**: Validates successful enqueuing and processing.
  2. **Success Xero Sync**: Validates successful invoice matching.
  3. **QuickBooks Rate Limits**: Emulates `RateLimitError` and ensures BullMQ retains the job for retry.
  4. **Xero Outages**: Emulates `NetworkError` and ensures it schedules retries under exponential backoff.
  5. **Invalid Payload (QBO)**: Enters negative amounts, verifies `ValidationError` causes immediate job discarding.
  6. **Missing Ref Number (Xero)**: Enters empty string reference numbers, verifies immediate job discarding.

---

## How to Verify
1. Run the integration test suite:
   ```bash
   npx jest tests/queue/accountingSync.test.ts
   ```
2. Verify all 6 tests pass cleanly:
   ```text
   PASS tests/queue/accountingSync.test.ts
     Accounting Integration (QuickBooks & Xero Sync Retry Queue)
       Successful Sync Operations
         ✓ should successfully sync a valid transaction to QuickBooks (57 ms)
         ✓ should successfully sync a valid transaction to Xero (8 ms)
       Transient Outages and Retries (Backoff)
         ✓ should throw a transient error (RateLimitError) when QuickBooks rate limits are hit (28 ms)
         ✓ should throw a transient error (NetworkError) when Xero connection fails (19 ms)
       Permanent Failures (No Retry)
         ✓ should discard future attempts and throw ValidationError when amount is zero/negative (17 ms)
         ✓ should discard future attempts and throw ValidationError when reference number is missing for Xero (7 ms)
   ```
