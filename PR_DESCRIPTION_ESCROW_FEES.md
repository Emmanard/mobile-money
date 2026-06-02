# PR Description: Implement Fee Collection Mechanism inside Soroban Escrow

## Overview
This pull request implements **Issue #979 [MEDIUM]: Implement Fee Collection Mechanism inside Soroban Escrow**. 

It introduces a protocol fee deduction mechanism within the Soroban Escrow smart contract. When releasing locked funds, the contract now optionally deducts a specified fee percentage (in basis points) and transfers the fee amount to the configured fee recipient address, releasing the remaining net amount to the beneficiary.

---

## Technical Implementations

### 1. Persistent State Enhancements (`EscrowState`)
- Updated the `EscrowState` struct inside `contracts/escrow/src/lib.rs` to include the missing fields necessary for fee deductions and time-locks:
  - `lock_until_ledger: u32`: Time-lock threshold sequence after which the depositor can claim a self-refund.
  - `fee_bps: u32`: Protocol fee in basis points (0–10,000, where 10,000 represents 100%).
  - `fee_recipient: Address`: Target wallet address receiving the fee portion upon release execution.

### 2. Parameter Updates & Validations (`initialize`)
- Expanded `initialize()` signature to accept all parameters: `lock_until_ledger`, `fee_bps`, and `fee_recipient`.
- Added strict validations:
  - Asserts that the fee basis points do not exceed the limit of 10,000 (`assert!(fee_bps <= 10_000)`).
  - Asserts that the beneficiary and depositor are unique (`assert!(depositor != beneficiary)`).
  - Asserts that the arbiter is a unique third-party address (`assert!(arbiter != depositor && arbiter != beneficiary)`).

### 3. Fee Deduction and Release Mechanics (`release`)
- When the arbiter authorises `release()`, the contract calculates the fee split:
  - `fee = amount * fee_bps / 10,000`
  - `net_beneficiary_amount = amount - fee`
- If `fee > 0`, a transfer is executed from the contract's SAC balance to the `fee_recipient` wallet.
- The remaining `net_beneficiary_amount` is transferred to the `beneficiary` wallet.
- Fixed a syntax bug in `release()` and `refund()` where they were missing the standard `Ok(())` success return.

### 4. Comprehensive Workspace Bug Fixes
- **Workspace Cargo Manifests**: Corrected a cargo manifest error where `contracts/escrow/Cargo.toml` and `htlc/Cargo.toml` attempted to inherit `lints` from the workspace root manifest's `workspace.lints`, but no `[workspace.lints]` block was defined in `contracts/Cargo.toml`.
- **HTLC Contract Types**: Fixed compilation type errors in `contracts/htlc/src/lib.rs` where the sha256 output (`Hash<32>`) was compared directly against `BytesN<32>` and passed into `initialize()` mismatching arguments. Cleanly cast sha256 output to `BytesN<32>` in the contract and its tests.

---

## Testing Strategy & Workspace Integrity
The entire unit test suite for the Rust contracts workspace compiles and passes cleanly with zero warnings or errors.

### To Run Tests:
```bash
cargo test --manifest-path contracts/Cargo.toml
```

### Test Execution Results:
```text
running 5 tests (escrow)
test tests::test_initialize_and_release ... ok
test tests::test_refund ... ok
test tests::test_emergency_refund ... ok
test tests::test_release_with_zero_fee ... ok
test tests::test_release_distributes_fee_and_net ... ok
test result: ok. 5 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.06s

running 3 tests (htlc)
test tests::test_setup_with_custom_issuer ... ok
test tests::test_htlc_refund ... ok
test tests::test_htlc_happy_path ... ok
test result: ok. 3 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.05s
```
