# TODO - MTN native batch disbursement

- [x] Inspect current MTN provider batch payout implementation (sendBatchPayout).
- [ ] Verify batchPayoutWorker wiring and per-item resolution flow.
- [ ] Ensure sendBatchPayout uses correct MTN batch API contract and polls until items reach terminal states.
- [ ] Ensure mapping from provider response items back to each internal transaction referenceId is correct.
- [ ] Ensure partial failure handling marks each transaction independently as Completed/Failed and persists providerReference/batch error metadata.
- [ ] Update/extend unit/integration tests if present for batch payouts.
- [ ] Run TypeScript checks and test suite.

