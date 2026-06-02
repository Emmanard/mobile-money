# PR Description: Improve Docker-Compose Setup with Mock Services

## Overview
This pull request implements **Issue #1002 [GOOD FIRST ISSUE]: Improve bridge-starter-node Docker-Compose setup**. 

It introduces a self-contained, offline-first local development and testing environment under Docker Compose. By integrating mock services for **SMTP** and **Stellar Horizon**, developers can run, test, and verify the entire application stack out-of-the-box with a single command (`docker compose up`) without requiring real external API keys, email accounts, or public testnet access.

---

## Technical Implementations

### 1. Mock SMTP Server (`maildev`)
- **Service Name**: `maildev`
- **Image**: `maildev/maildev:2.1.0`
- **Ports**: 
  - `1025` (SMTP port): Captures outbound transactional emails from the application.
  - `1080` (HTTP Web UI): Provides a local inbox viewer to check transaction receipts, alerts, and notifications.
- **Healthcheck**: Validates SMTP socket readiness (`nc -z localhost 1025 || exit 1`) before downstream services launch.

### 2. Local Stellar Standalone Node (`stellar`)
- **Service Name**: `stellar`
- **Image**: `stellar/quickstart:latest`
- **Command**: `["--standalone", "--enable-horizon"]` (starts a local, sandboxed Stellar core, Horizon API, and Friendbot instance).
- **Ports**:
  - `8000` (Horizon/Friendbot HTTP API): Used for local ledger state interaction.
- **Healthcheck**: Checks HTTP availability of Horizon (`curl -f http://localhost:8000 || exit 1`) with a grace period of `30s`.

### 3. Application Integration
- Updated both `docker-compose.yml` and `docker-compose.dev.yml`.
- Configured the `app` container's `depends_on` block to await healthy statuses of both `maildev` and `stellar` in addition to `postgres` and `redis`.
- Exposed default local environment variables inside Compose:
  - `SMTP_HOST=maildev`
  - `SMTP_PORT=1025`
  - `STELLAR_HORIZON_URL=http://stellar:8000`
  - `STELLAR_NETWORK=local`

---

## Key Benefits
- **Zero Configuration**: Developers can clone the repository and run `docker compose up` immediately. No pre-created keys or external SMTP configs are required to start local validation.
- **Offline Capabilities**: Testing can be executed locally without internet connectivity.
- **Stellar Node Mocking**: Avoids testnet Horizon rate limits or public ledger downtime.
- **Local Receipt Auditing**: Transactional email receipts can be audited at `http://localhost:1080` right in the browser.

---

## Verification & Testing
1. Boot the stack:
   ```bash
   docker compose up -d
   ```
2. Verify all services boot and establish healthy status:
   ```bash
   docker compose ps
   ```
3. Check the health status endpoint:
   ```bash
   curl http://localhost:3000/health
   ```
4. Access the Maildev local inbox UI:
   Navigate to `http://localhost:1080` in your web browser.
5. Verify the Stellar Horizon service:
   ```bash
   curl http://localhost:8000
   ```
