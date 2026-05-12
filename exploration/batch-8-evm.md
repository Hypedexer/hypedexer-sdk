# Batch 8 — EVM

Tested 16 endpoints under `/evm/*`. All returned 2xx (except deliberate 404/422). Samples in `samples/batch-8/`.

## Summary (takeaways)

1. **Envelope is uniformly `APIResponse<T>`** for every EVM endpoint, matching the default family — including `total_count`/`execution_time_ms`/`next_cursor`/`has_more` fields. No bare arrays here, unlike funding/vaults/hip3 root endpoints.
2. **Time params use ISO** (`start_time` / `end_time`) per the same convention as Batch 1/2/3. Epoch ms is silently accepted but yields the same result as no filter — i.e. **silent fallback**, not an error. Use ISO only.
3. **Critical data quality issue: `tx_hash` and `from_addr` on `/evm/transactions` are empty strings** (not null, not 0x-prefixed hex). The indexer apparently does not populate sender/hash for transaction rows. Logs do carry full `tx_hash`-equivalent data via `block_number`+`tx_index`+`log_index`. Plan SDK types accordingly — these are `string` but observed empty in 100% of samples.
4. **Numeric encoding is mixed**: `value_wei` is a **string** (large int safe), but `gas_limit`, `gas_used`, `base_fee_per_gas`, `block_number`, `nonce` (bridge), `amount` (bridge), `dex_index` are all **numbers**. `amount_raw` in ledger/user-events is string, `amount` is number.
5. **Enum validation is inconsistent**: invalid `event_type` on `/evm/user/{address}/ledger-events` is enforced (422 with explicit allowed values listed), but invalid `action_type` on `/evm/ledger/transfers` and invalid `event_type` on `/evm/bridge/events` silently return empty data. Same for unknown `dex` on `/backstop/{dex}/fills` (empty), but `/backstop/{dex}/health` returns 404 with a plaintext-ish JSON detail.

## Cross-cutting observations

### Envelope
All 16 endpoints return `APIResponse<T>` with:
```
{ success, message, data, total_count: null, execution_time_ms, next_cursor: null, has_more }
```
`total_count` and `next_cursor` are always `null` across EVM (no cursor pagination — offset only). `has_more` is populated.

### Time formats observed in responses
- `/evm/stats`, `/blocks`, `/transactions`, `/logs`: `block_time`, `first_block_time`, `last_block_time` use **ISO without timezone, seconds precision**: `"2026-05-11T21:02:30"`
- `/evm/ledger/transfers`, `/bridge/events`, `/user/*/ledger-events`, `/backstop/*`: `time` uses **ISO with microseconds, no TZ**: `"2026-05-11T21:38:40.088000"`
- `/evm/stats/daily`: `day` is **date-only**: `"2026-05-11"`

This matches the date-format diversity seen in earlier batches; SDK should parse both ISO variants leniently.

### Large-number encoding
- `value_wei` — **string** (correct for wei).
- `gas_limit`, `gas_used`, `base_fee_per_gas` — **number** (fits int53; safe for HL EVM where gas is small but risky for general wei values).
- `block_number` — **number** (current ~34.8M; safe).
- `nonce` in bridge events — **number** (observed 1778535277015000, fits int53 but on edge).
- `amount` (bridge / user ledger / ledger transfers) — **number** (float64). `amount_raw` is string in ledger/user, but bridge events expose only number `amount`.

SDK note: type `value_wei: string`, `gas_*: number`, `amount: number`, `amount_raw: string`. Document the gas number risk.

### Limit caps
`limit > 1000` → **422** with explicit `less_than_equal` validation. Same pattern as other batches.

### Pagination
**Offset-only**, no cursor anywhere in `/evm/*`. `has_more: true` indicates next page exists. `offset` works (verified — different blocks returned).

### Hash / address formats
- `block_hash`, `parent_hash`: full `0x` + 64 hex.
- `tx_hash` in `/transactions`: **empty string** in all samples. Bug or unimplemented.
- `tx_hash` in ledger/bridge/user-events: full `0x` + 64 hex (these come from the L1 tx, not the EVM-tx table).
- `address` in `/logs`: lowercase 0x40.
- `from_addr` in `/transactions`: **empty string**. `to_addr` populated.
- `user_to` in ledger transfers: mixed case (observed `0xe75e47e7Ea08726eF005B14b3EA77efF32581480`). Other addr fields lowercase.

### Empty/nullable convention
- `topic1`/`topic2`/`topic3` in logs: **empty string `""`** when absent, not null.
- `validator` in bridge events: empty string for `withdraw3` type.
- `raw` in bridge events: empty string for `withdraw3`, full JSON string for `withdrawal_finalized` / `deposit_vote`.
- `source_dex`, `destination_dex` in ledger transfers: actual `null`.

## Per-endpoint

### Core blockchain

**1. `GET /evm/stats`** — `data` is single object: `{total_blocks, total_transactions, total_logs, first_block, last_block, first_block_time, last_block_time}`. All numbers + ISO strings. ~28ms server. Sample: `stats.json`.

**2. `GET /evm/stats/daily?days=N`** — `data` array of `{day, blocks, transactions, system_txs, gas_used}`. Default 30, max 365 (1-365). Sample: `stats-daily.json`.

**3. `GET /evm/blocks`** — `data[]` of:
```
{block_time, block_number, block_hash, parent_hash, gas_limit, gas_used, base_fee_per_gas, tx_count, system_tx_count}
```
Filters: `start_block`/`end_block` work as inclusive range (verified with 34849600-34849609 → 10 rows). `limit` capped at 1000. Sample: `blocks-baseline.json`, `blocks-range.json`.

**4. `GET /evm/blocks/{block_number}`** — `data` is the single block record (same shape). 404 with `{"detail":"Block N not found"}` for unknown. Sample: `block-by-number.json`, `block-unknown.json`.

**5. `GET /evm/transactions`** — `data[]` of:
```
{block_time, block_number, tx_index, tx_hash(""), tx_type, from_addr(""), to_addr, value_wei: string, gas_limit, gas_used, success: 0|1, input_len: number, is_system_tx: 0|1}
```
- `tx_type` observed: `"Eip1559"` (single value in samples — probably enum).
- `success` and `is_system_tx` are **integers 0/1**, not booleans.
- `input_len` is the byte length of input data — not the data itself. To get actual calldata, no endpoint available.
- `include_system=false`: filters (default unclear; system txs not seen in baseline either).
- `to_addr` filter works.
- `block_number` filter works (returns txs in that block, equivalent to endpoint 6).
- ISO `start_time`/`end_time` honored; epoch ms silently ignored.
Samples: `transactions-baseline.json`, `transactions-by-to.json`, `transactions-by-block.json`, `transactions-time.json`, `transactions-epoch.json`, `transactions-offset.json`, `transactions-no-system.json`.

**6. `GET /evm/blocks/{block_number}/transactions`** — same shape as #5 filtered to that block. Sample: `block-txs.json`.

**7. `GET /evm/logs`** — `data[]` of:
```
{block_time, block_number, tx_index, log_index, address, topic0, topic1, topic2, topic3, data}
```
`topic1/2/3` and absent values are empty strings, not null. `data` is the raw hex blob (0x-prefixed). Filters `address`, `topic0`, `block_number` all work. Sample: `logs-baseline.json`, `logs-filtered.json`, `logs-by-block.json`.

### Ledger & bridge

**8. `GET /evm/ledger/transfers`** — `data[]` of:
```
{time, block_height: 0, tx_hash, action_type, user_from, user_to, token, amount_raw: string, amount: number, source_dex: null, destination_dex: null}
```
- `block_height` always 0 in samples (probably unused / placeholder).
- `action_type` observed: `usdSend` (others enum values present per swagger but not seen).
- `token` is a symbol or `SYMBOL:0x<id>` for HIP-1/spot tokens — see ledger-summary tokens list (USDC, HYPE, plus many `SYM:0x<32hex>` forms).
- Invalid `action_type` → 200 with empty `data` (silent).
- `token=USDC` filter works.
- ISO time params honored.
Samples: `ledger-transfers-baseline.json`, `ledger-transfers-usdsend.json`, `ledger-transfers-bogus.json`, `ledger-transfers-token.json`.

**9. `GET /evm/bridge/events`** — `data[]` of:
```
{time, block_height: 0, event_type, user_addr, validator, amount: number, destination, nonce: number, raw: string}
```
- `event_type` observed: `withdrawal_finalized`, `deposit_vote`, `withdraw3`. All four enum values likely valid.
- `raw` is a JSON string containing the original L1 action (`{type, user, destination, nonce, usd, ethTxHash, ...}`) for `withdrawal_finalized` / `deposit_vote`; empty for `withdraw3`.
- Invalid `event_type` → 200 empty (silent).
- `nonce` is large number (1778535277015000); document int53 risk.
Samples: `bridge-events-baseline.json`, `bridge-events-withdraw3.json`, `bridge-events-invalid.json`.

**10. `GET /evm/user/{address}/ledger-events`** — `data[]` of:
```
{time, event_type, counterparty, token, amount: number, amount_raw: string, tx_hash, source_dex, destination_dex}
```
- `event_type` enum strictly enforced (422 on invalid). Allowed: `deposit | withdrawal | transfer_in | transfer_out | class_transfer | sub_account | vault | agent_send`.
- Can pass multiple `event_type` params (verified `?event_type=deposit&event_type=withdrawal` accepted).
- This is a per-user reshape of the ledger transfers; combines incoming + outgoing relative to user.
- Sample: `user-ledger-events.json`, `user-ledger-events-bogus.json`.

**11. `GET /evm/user/{address}/ledger-summary`** — `data[]` of:
```
{action_type, count, total_amount, tokens: string[]}
```
Aggregated across 8 action types (matches the ledger enum). `tokens` is a flat array of all token identifiers seen in that action type. Useful for token discovery. Sample: `user-ledger-summary.json`.

### HIP-3 backstop

**12. `GET /evm/hip3/backstop/transfers`** — same envelope. Empty across all my tests (no backstop transfer activity recorded yet on any dex despite `principal_*` fields existing — they're all 0). `is_deposit=true` filter accepted but no data to verify. Sample: `backstop-transfers.json`, `backstop-transfers-deposit.json`.

**13. `GET /evm/hip3/backstop/transfers-summary`** — `data[]` per dex aggregation. Empty in current state. Sample: `backstop-transfers-summary.json`.

**14. `GET /evm/hip3/backstop/health`** — `data[]` of:
```
{dex_id, backstop_address, dex_index, principal_deposited_usdc, principal_withdrawn_usdc, net_principal_usdc, fill_count, notional_traded, fees_paid, fills_last_24h, last_fill_time, coins_active, first_fill_time}
```
Returned **6 dexes** (km, hyna, flx + 3 others) — note this is fewer than the 8 dexes listed in batch 4 (abcd, cash, flx, hyna, km, para, vntl, xyz). Only dexes that have observed backstop fills appear; dexes without backstop activity are omitted. All principal_* fields = 0 currently (no deposits yet).
`backstop_address` follows pattern `0x4000000000000000000000000000000000000000 + dex_index`. Sample: `backstop-health.json`.

**15. `GET /evm/hip3/backstop/{dex}/health`** — single object, same shape. Unknown dex → **404** with `{"detail":"No backstop activity recorded for dex 'X' (address never observed in fills)"}`. Sample: `backstop-km-health.json`, `backstop-unknown-health.json`.

**16. `GET /evm/hip3/backstop/{dex}/fills`** — `data[]` of:
```
{time, dex_id, coin, side: "B"|"A", px, sz, notional, fee, is_liquidation: 0|1, hash}
```
- This is a **simplified HIP-3 fill shape**, not the full perp Fill from Batch 1. Missing: `user`, `oid`, `tid`, `start_position`, `dir`, `closed_pnl`, `crossed`, `cloid`, `builder_fee`. Just what backstop participated in.
- `coin` is namespaced as `<dex>:<symbol>` (e.g. `km:SMALL2000`).
- `is_liquidation` is int 0/1 (not bool).
- `side` is `"B"` / `"A"` (matches Batch 1 fills convention).
- Unknown dex → **empty data, 200** (not 404 like health). Inconsistent with `/{dex}/health`.
- Note: swagger mentioned `ntl` vs `ntl_usdc` — **neither appears**; only `notional` (USDC-denominated number). The swagger note appears to refer to the input wei vs human conversion but the response field is named `notional`.
Sample: `backstop-km-fills.json`, `backstop-unknown-fills.json`.

## Open questions

- **`tx_hash` / `from_addr` empty** on `/evm/transactions` — is this a known indexer gap, or a deliberate design (since L1-side data is referenced by `block_number`+`tx_index`)? Document as "unavailable" in SDK and provide composite `(block_number, tx_index)` accessor.
- `tx_type` is only `"Eip1559"` in samples — full enum unknown. Swagger should clarify (`Legacy`, `Eip2930`, `Eip1559`, ...).
- `nonce` in bridge events approaches int53 limits; needs string handling for safety in TS bindings, but server emits number.
- Backstop `transfers` endpoints have no data yet — schema fields like `is_deposit`, `signer` are inferable from swagger but not verified live.
- `include_system=false` cannot be verified — no system txs in baseline samples to compare against.
- The 2 dexes appearing in `/backstop/health` beyond the 6 visible (vs 8 in batch 4) are obscured by the head -c truncation; assume any dex without backstop fills is omitted. SDK should treat `health[]` as "active backstops" not "all dexes".

## SDK design implications

- One client method per endpoint; group: `evm.stats`, `evm.statsDaily`, `evm.blocks.list`, `evm.blocks.get`, `evm.blocks.transactions`, `evm.transactions.list`, `evm.logs.list`, `evm.ledger.transfers`, `evm.bridge.events`, `evm.user.ledgerEvents`, `evm.user.ledgerSummary`, `evm.hip3.backstop.health` (list + getByDex), `evm.hip3.backstop.fills`, `evm.hip3.backstop.transfers`, `evm.hip3.backstop.transfersSummary`.
- Reuse the shared `APIResponse<T>` wrapper unwrapper.
- Reuse the shared offset paginator (no cursor here).
- Typed enums for `LedgerEventType` (strictly enforced), `LedgerActionType` and `BridgeEventType` (loosely enforced — silently empty), `TxType` (`"Eip1559" | ...`).
- Caller-side normalization: convert `success: 0|1` and `is_system_tx: 0|1` and `is_liquidation: 0|1` to booleans in SDK return types.
- Treat `value_wei` and `amount_raw` as strings (bigint-safe). Document `nonce` (number, int53 risk).
- Parse both ISO-seconds and ISO-microseconds date variants leniently.
