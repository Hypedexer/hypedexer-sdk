# Batch 7 — Funding + Vaults + Spot

API: `https://api.hypedexer.com` · Auth: `X-API-Key` · Raw samples in `samples/batch-7/`, call log `samples/batch-7/_calls.tsv`.

## Summary

1. **All four `/spot/*` endpoints return HTTP 500 "Internal Server Error"** (text/plain body, not JSON). This is a server-side bug — tried `limit=5`, `limit=200&offset=0`, `?search=USD`, `freshness_sec=0`, no params. Every variant 500s. SDK must surface these as a typed error class (`HttpServerError`) since the body isn't even JSON.
2. **Funding & Vaults envelopes are bare** — top-level is either a JSON array (lists) or a single JSON object (`vaultDetails`). No `APIResponse<T>` wrapper, no `Hip4Envelope`. This puts Funding/Vaults in the same family as **HIP-3** (bare), unlike fills/users which use `APIResponse<T>`.
3. **Time params are epoch ms** for both Funding (`startTime`/`endTime`) and Vaults (`startTime`/`endTime`). And response `time` fields are **always epoch ms numbers** (never ISO strings). This is the opposite of batch-1 (`start_time`/`end_time` ISO) and batches 2–6 which were mixed. The SDK must clearly mark these per-endpoint — see §"Time-unit inconsistency map".
4. **Numeric encoding inconsistency**: funding `fundingRate`, `premium` are **string-encoded floats** (`"-0.0000101097"`). Vaults amounts (`totalDeposits`, `amount`, `accountValue`) are **JSON numbers**. SDK types must reflect this — funding wraps strings for precision; vaults trust float.
5. **Param-name style** in Funding/Vaults is **camelCase** (`startTime`, `endTime`, `vaultAddress`, `includeClosed`). Spot swagger says snake_case (`freshness_sec`, `lookback_hours`) — can't verify due to 500. Same camelCase/snake_case split we saw earlier across batches.

## Cross-cutting observations

### Envelope family
| Group | Style | Example |
|---|---|---|
| Funding (list) | bare `T[]` | `[{coin,fundingRate,premium,time}, ...]` |
| Funding (`predictedFundings`) | bare `T[]` | same shape, one row per coin |
| Vaults (list) | bare `T[]` | `vaultSummaries`, `dailySnapshots`, `equitySnapshots`, `vaultLedger`, `userVaultEquities`, `userFunding` |
| Vaults (`vaultDetails`) | bare object `T` | single vault object with embedded `portfolio[]` |
| Spot | unknown (all 500) | swagger says bare `T[]` — unconfirmed |

No `success`/`message`/`execution_time_ms`/`next_cursor` fields anywhere in this batch. **All pagination is offset-only** (or `limit`-only for those without offset).

### Time-unit inconsistency map (running)
| Batch | Request time params | Response `time` |
|---|---|---|
| 1 fills | ISO `start_time`/`end_time` | ISO `"2026-05-11T15:22:..."` |
| 4 HIP-3 | mixed | mixed |
| 6 builders/TWAPs | mixed | mixed |
| **7 funding** | **epoch ms** `startTime`/`endTime` | **epoch ms number** |
| **7 vaults** | **epoch ms** `startTime`/`endTime` | **epoch ms number**; `vaultDetails` adds `day: "2026-04-11"` (ISO date string) |

SDK action: a single canonical `TimeInput` (Date | number | ISO string) coerced per-endpoint via internal `encodeTime: 'epochMs' | 'iso'` flag.

### Numeric precision
- `fundingRate` ≈ `1e-5` to `1e-6`. Returned as string. **Keep as string** in SDK types (or expose `.asNumber()`/`.asBigDecimal()` accessor). Casting to JS number is lossless here but the API contract is string — preserve it.
- Vault $$ amounts: returned as `number` (JSON float). At HLP scale (`271M`) precision is still fine (within Number.MAX_SAFE_INTEGER).
- `premium` also string.

### Pagination
- Funding & Vaults: **offset is NOT a query param** in swagger. Only `startTime`/`endTime`/`limit`. To page back in time, the caller decrements `endTime` to the oldest row's `time`. SDK helper: `paginateByTime(fn, {pageSize})`.
- Spot: swagger says `limit` + `offset`. Untestable.

### Limit caps
- Confirmed: funding/vaults default 500 (per swagger), cap **5000** (422: `"Input should be less than or equal to 5000"`).
- Validation error shape matches batch 1: `{"detail":[{"type","loc","msg","input","ctx"}]}`.

### Auth / required params
- Missing required (`coin`, `user`, `vaultAddress`): **422** with structured `detail[]`.
- Unknown `coin` on `fundingHistory`: **200 `[]`** (silent empty). SDK should NOT treat empty as error.
- Zero-address vault on `vaultDetails`: **404** `{"detail":"Vault '0x000…' not found"}` — different shape (string `detail`, not array). The SDK needs both `ValidationError` (422, array) and `NotFoundError` (404, string).

## Per-endpoint sections

### Funding

#### `GET /funding/predictedFundings`
- No params. 200 in ~2.8s, 19.5 KB.
- Returns **230 entries** — one per tradeable perp. This is the canonical perp universe (compare HIP-3 batch). 47 entries have `fundingRate="0"` (likely HIP-3 coins).
- Row shape: `{ coin: string, fundingRate: string, premium: string, time: number }`. `time` is epoch ms.
- File: `funding-predicted.json`

#### `GET /funding/fundingHistory?coin=...`
- 200 bare array, hourly bars (epoch deltas ~3.6e6 = 1 h).
- Shape: same as predicted (`coin`, `fundingRate`, `premium`, `time`).
- Required: `coin`. Missing → 422. Unknown coin → `[]`.
- Time window with `startTime`/`endTime` in **epoch ms** works (sample returned `[]` for the most recent 24 h window because of clock skew — server time ~ `1778533200034` vs my computed window. Likely no rows in that exact range; not an error.)
- File: `funding-history-btc.json`, `funding-history-bad-coin.json`, `funding-history-missing-coin.json`, `funding-history-limit-huge.json`.

#### `GET /funding/userFunding?user=...`
- Required: `user`. 200 `[]` for both tested users (random fills user + HLP leader). Untyped swagger says `usdc`, `szi`, `delta` per record — could not verify (no rows). SDK should still surface the swagger-claimed shape as a `FundingPayment` record but document that empty for most users is normal.
- File: `user-funding.json`, `user-funding-leader.json`.

### Vaults

#### `GET /vaults/vaultDetails?vaultAddress=...` (single object, NOT array)
- 200, bare object.
- Fields: `vaultAddress, name, leader, leaderCommission(num 0..1), isClosed, lockupDurationSeconds, allowDeposits, followerCount, snapshotTime, createTime, portfolio[]`
- `portfolio[]` rows: `{ time, followerCount, leaderCommission }` — historical leader-commission snapshots. NOT positions. The name is misleading.
- `startTime`/`endTime` filters apply to `portfolio[]` (sample with last 24h returned empty portfolio array — main vault meta still returned).
- Zero-address vault → **404 string detail**.
- File: `vault-details.json`, `vault-details-tw.json`, `vault-details-zero.json`.

#### `GET /vaults/vaultSummaries`
- Bare array. Default sort: by follower count desc (HLP first).
- Fields: `vaultAddress, name, leader, leaderCommission, isClosed, followerCount, snapshotTime, createTime`. (Strict subset of vaultDetails — no `portfolio`, no `lockupDurationSeconds`, no `allowDeposits`.)
- `includeClosed=true` accepted; needs longer test to see if closed appear at this depth.
- File: `vaults-summaries-l5.json`, `vault-summaries-closed.json`.

#### `GET /vaults/userVaultEquities?user=...`
- 200 `[]` for tested users — couldn't capture shape. Swagger has no typed schema. SDK should expose unknown rows pending future capture.
- File: `user-vault-equities.json`, `user-vault-equities-real.json`.

#### `GET /vaults/dailySnapshots?vaultAddress=...` vs `equitySnapshots?vaultAddress=...`
- Both bare arrays of identical-looking metric rows.
- `dailySnapshots` rows: `{ time, day, totalDeposits, accountValue, totalNotional, totalRawPnl, nPositions, followerCount }` — `day` is ISO date string (`"2026-04-11"`).
- `equitySnapshots` rows: same minus `day` field (`{ time, totalDeposits, accountValue, totalNotional, totalRawPnl, nPositions, followerCount }`).
- **Difference**: `dailySnapshots` is one snapshot per UTC day (timestamps ~24h apart in sample); `equitySnapshots` is the higher-frequency raw series (~hourly).
- Files: `vault-daily.json`, `vault-equity-snap.json`.

#### `GET /vaults/vaultLedger?vaultAddress=...&user=...`
- Bare array of deposit/withdraw transfers.
- Fields: `{ time, txHash, userFrom, userTo, amount: number, token: "USDC" }`. Deposit = `userTo == vaultAddress`. Withdraw = `userFrom == vaultAddress`. SDK helper: `tx.kind = userTo===vault ? 'deposit' : 'withdraw'`.
- Optional `user` filter works (returns only this user's txs). 
- File: `vault-ledger.json`, `vault-ledger-user.json`, `vault-ledger-real-user.json`.

### Spot — ALL BROKEN

All four endpoints (`tokens`, `pairs`, `auctions/live`, `auctions/hist`) return **HTTP 500 text/plain "Internal Server Error"**, regardless of params (with/without `limit`, `offset`, `search`, `freshness_sec=0`, `lookback_hours=48`).

- This appears to be a deployment/server-side issue, not a client error.
- SDK design implication:
  - Define types from swagger (`SpotToken`, `SpotPair`, `SpotAuctionLive`, `SpotAuctionHist`) but mark methods as `@experimental` / `@unstable` until server is fixed.
  - Error handler must accept non-JSON 5xx body — wrap as `HttpServerError { status, body: string }`.
- Files: `spot-tokens-l5.json` (`Internal Server Error`), `spot-tokens-base.json`, `spot-pairs-base.json`, `spot-auctions-live.json`, `spot-auctions-hist.json`, `spot-tokens-p0.json`, `spot-auctions-live-fresh0.json`, `spot-auctions-hist-lb.json`, `spot-tokens-l1.json`, `spot-tokens-search.json`.

## SDK design notes (batch 7 specific)

```ts
// Envelope strategy (running)
type APIResponse<T>   = { success: boolean; message: string; data: T; execution_time_ms: number; next_cursor: string|null; has_more: boolean }; // batches 1-3
type Bare<T>          = T;                                                                                                                       // HIP-3, FUNDING, VAULTS, (SPOT?)
type Hip4Envelope<T>  = { /* batch 5 */ };
```

```ts
// Funding model
interface FundingRate {
  coin: string;
  fundingRate: string;  // tiny float as string — keep
  premium: string;      // string
  time: number;         // epoch ms
}
interface FundingHistoryParams {
  coin: string;             // required
  startTime?: number;       // epoch ms
  endTime?: number;         // epoch ms
  limit?: number;           // 1..5000, default 500
}
```

```ts
// Vault models
interface VaultSummary {
  vaultAddress: `0x${string}`; name: string; leader: `0x${string}`;
  leaderCommission: number; isClosed: boolean; followerCount: number;
  snapshotTime: number; createTime: number; // both epoch ms
}
interface VaultDetails extends VaultSummary {
  lockupDurationSeconds: number; allowDeposits: boolean;
  portfolio: { time: number; followerCount: number; leaderCommission: number }[];
}
interface VaultDailySnapshot { time: number; day: string /* YYYY-MM-DD */; totalDeposits: number; accountValue: number; totalNotional: number; totalRawPnl: number; nPositions: number; followerCount: number }
interface VaultEquitySnapshot extends Omit<VaultDailySnapshot, 'day'> {}
interface VaultLedgerTx { time: number; txHash: `0x${string}`; userFrom: `0x${string}`; userTo: `0x${string}`; amount: number; token: 'USDC' | string }
```

```ts
// Error model
class HypedexerError extends Error { status: number; }
class ValidationError extends HypedexerError { detail: { type: string; loc: string[]; msg: string; input: unknown; ctx?: unknown }[]; }  // 422
class NotFoundError   extends HypedexerError { detail: string; }                                                                          // 404 vaultDetails
class HttpServerError extends HypedexerError { body: string; /* may be text/plain */ }                                                    // 500 spot/*
```

## Open questions

1. **Spot endpoints** — when will server be fixed? Need to retest. Until then, SDK can only ship typed stubs.
2. **`userFunding` / `userVaultEquities` shape** — both empty for every user tested. Need to pull a known HLP depositor (not the leader itself) and a user with funding payments. Suggest later running these against a list of top-5 HLP followers harvested from `vaultLedger`.
3. **`includeClosed=true` effect** — at limit=5 the closed vaults didn't appear (all 5 had `isClosed:false`). Need a higher limit to compare with default.
4. **`vaultSummaries` sort order** — empirically follower count desc. Not documented in swagger; SDK shouldn't assume.
5. **`predictedFundings` zero-rate coins** — 47/230 have `fundingRate:"0"`. Likely HIP-3 markets where funding hasn't been computed. Cross-check vs batch 4 HIP-3 universe.
6. **`portfolio[]` in vaultDetails** — name suggests positions but content is leader-commission history. Confirm with HL team or rename in SDK accessor (`leaderCommissionHistory`).
