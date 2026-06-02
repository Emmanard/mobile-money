# Batch payouts: MTN native batch disbursement (implementation checklist)

- [ ] Add unit tests for MTN `sendBatchPayout()`:
  - [ ] immediate results mapping (no polling)
  - [ ] polling required until terminal states
  - [ ] missing `referenceId` in MTN response (fallback matching)
- [ ] Improve `src/services/mobilemoney/providers/mtn.ts`:
  - [ ] Make polling attempts/delay configurable via env (safe defaults)
  - [ ] Improve terminal-state detection to not stop too early
  - [ ] Add fallback matching if MTN response items don’t include `referenceId`
  - [ ] Normalize providerReference extraction across possible response shapes
- [ ] Run tests and TypeScript checks
- [ ] Ensure batch worker per-item resolution still updates transactions independently

