# Batch 2 — Analytics + Overview

Base URL: `https://api.hypedexer.com` · Auth: `X-API-Key` header · Captured: 2026-05-11
Raw JSON samples: `./samples/batch-2/` (call log: `_calls.tsv`)

## Summary

- **13 endpoints tested, all reachable.** All happy-paths return 200; range-validated params return 422 with the same FastAPI `detail[]` shape as batch 1.
- **APIResponse envelope holds across analytics + overview** — same 7 keys as batch 1 (`success`, `message`, `data`, `total_count`, `execution_time_ms`, `next_cursor`, `has_more`). `total_count` and pagination fields are **always `null`** here (these are aggregates, not lists with pagination). `execution_time_ms` **is consistently populated**, unlike batch 1's list endpoints where it was sometimes null.
- **`data` is heterogeneous and untyped in swagger.** Three families observed: (a) stat-summary objects (`fills/stats`, `priority-fees/stats`, `liquidations/stats`, `total-fees-24h`), (b) KPI-with-variation objects shaped `{value, variationPct}` (`active-traders-24h`, `trading-volume-24h`, `total-fills-24h`), (c) arrays of records (`top-traders`, `daily-*`, `coin-distribution`, `prio-chart-daily`, `prio-gossip`). SDK must define a distinct response type per endpoint.
- **All numerics are JSON numbers** (no string-wrapped decimals). Even very large aggregates (`totalVolume ≈ 2.8e8`, `volume ≈ 1.9e10`) fit safely in JS Number. **No bigint concerns in this batch.**
- **Date encoding is inconsistent across endpoints**, more than in batch 1. Three variants observed in this batch alone:
  - `time_range` on fills/priority-fees stats: ISO with `Z`, no microseconds — `"2026-05-11T14:40:32Z"`.
  - `time_range` on liquidations stats: ISO with microseconds **and** `Z` — `"2026-05-10T15:40:43.737038Z"`.
  - Daily charts/series use bare date strings — `"2026-05-02"` (no time component).
- **Validation is uneven.** `hours`/`days`/`limit` ranges are enforced server-side; but `sort=bogus` on `/overview/top-traders-24h` **silently falls back** to default sort (still returns 20 rows), and `user=0x123` on `/overview/coin-distribution` **returns 200 with `data: []`** rather than 422 — the eth-address regex is NOT applied here.
- **Gossip leaderboard returns IP addresses, not eth addresses.** `address` is the L1 validator gossip IP (e.g. `"54.64.2.87"`). Naming is misleading — message says "wallets" but the values are clearly node IPs. SDK should rename / document this.
- **Slowest endpoints are overview KPI counters**: `active-traders-24h` (7.5s), `trading-volume-24h` (3.2s), `daily-pnl-10d` (3.5s), `total-fills-24h` (2.5s). Cache aggressively in the SDK.
- **`coin-distribution` is user-required** and returns `data: []` for any well-formed address without fills, including syntactically-bad ones — the bad-input rejection observed elsewhere does NOT apply.

## Cross-cutting observations

### APIResponse envelope

Identical to batch 1. All 13 endpoints respect it on happy-path:

```ts
{
  success: true,
  message: string,
  data: object | object[],        // shape varies per endpoint (see below)
  total_count: null,              // never populated in batch 2
  execution_time_ms: number,      // ALWAYS populated (in ms), float
  next_cursor: null,
  has_more: null
}
```

Differences vs batch 1:
- `total_count` is always `null` here (no pagination on aggregates) — batch 1 had it inconsistent. Less ambiguity but also no use.
- `execution_time_ms` is **always** populated (no `null` cases observed across all 13). Batch 1's `/fills/count` moved it into `data`; that quirk is not repeated.
- Pagination fields (`next_cursor`/`has_more`) are always `null`. None of these endpoints are paginated.

### Validation errors (422)

Same FastAPI `{ detail: [{type, loc, msg, input, ctx}] }` shape as batch 1. Confirmed caps:

| Endpoint                                    | Param   | Range   | Observed cap message                         |
| ------------------------------------------- | ------- | ------- | -------------------------------------------- |
| `/analytics/fills/stats`                    | `hours` | 1–168   | `Input should be less than or equal to 168`  |
| `/analytics/priority-fees/stats`            | `hours` | 1–168   | (same family; not tested but swagger says)   |
| `/analytics/liquidations/stats`             | `days`  | 1–30    | `Input should be less than or equal to 30`   |
| `/analytics/priority-fees/gossip/leaderboard` | `limit` | 1–200 | `Input should be less than or equal to 200`  |
| `/overview/coin-distribution`               | `user`  | required | `Field required` (when missing)             |

Silent-fallback / permissive cases (no 422):
- `sort=bogus` on `/overview/top-traders-24h` → 200, default ordering (matches `sort=pnl_pos` first user). SDK should validate the enum client-side to avoid this footgun.
- `user=0x123` (not a valid eth address) on `/overview/coin-distribution` → 200 with `data: []`. No regex enforcement here, unlike `/fills/user/{addr}` in batch 1.

### Numeric encoding

All values are JSON numbers. Largest magnitudes seen:
- `totalVolume` in top-traders: ~2.8e8 USD
- `volume` in daily-volume-10d (whole-market): ~1.99e10 USD
- `total_priority_gas`, `totalGas`: floats with high precision (e.g. `42735.410193299955`)

All well within `Number.MAX_SAFE_INTEGER` (~9.0e15). No string-wrapped numbers; no bigint required.

`winRate` is a unit float in `[0, 1]` (e.g. `0.555…`), not a percent. SDK should document.
`variationPct` is signed — naming suggests a percent but value scale not yet confirmed (could be a ratio like `winRate`). Worth a follow-up sample at different times of day.

### Date encoding

| Field location                       | Format example                          | Notes                       |
| ------------------------------------ | --------------------------------------- | --------------------------- |
| `fills/stats` `time_range.{start,end}` | `2026-05-11T14:40:32Z`                | second precision, `Z`       |
| `priority-fees/stats` `time_range.*` | `2026-05-11T14:40:35Z`                  | second precision, `Z`       |
| `liquidations/stats` `time_range.*`  | `2026-05-10T15:40:43.737038Z`           | µs precision, `Z`           |
| `daily-pnl-10d` items `date`         | `2026-05-02`                            | calendar date only          |
| `daily-volume-10d` items `date`      | `2026-05-02`                            | calendar date only          |
| `prio-chart-daily` items `date`      | `2026-04-13`                            | calendar date only          |

Compared with batch 1: fills had ISO **without** TZ (`"2026-05-11T15:22:49.398000"`). Batch 2 always has `Z` on timestamps. Adding to the date-format inventory the SDK must normalize:

1. ISO no TZ (batch 1 `time`)
2. ISO with `+00:00` (batch 1 `/count.data.timestamp`)
3. ISO with `Z`, second precision (batch 2 stats `time_range`)
4. ISO with `Z`, microsecond precision (batch 2 liquidations `time_range`)
5. Bare calendar date `YYYY-MM-DD` (batch 2 daily series)

SDK recommendation: parse all five via a single lenient ISO parser; expose `Date` for timestamps and `string` (or a `PlainDate`-like) for calendar-date series, since promoting `"2026-05-02"` to `Date` introduces TZ ambiguity.

### Response time profile

Analytics calls (stats) are sub-second consistently (0.6–2.2s). Overview KPI counters are noticeably slower because they recompute aggregates per request:

| Endpoint                          | Time (s) | Notes                          |
| --------------------------------- | -------- | ------------------------------ |
| `active-traders-24h`              | **7.50** | slowest in batch               |
| `daily-pnl-10d`                   | 3.47     | 3301 items                     |
| `trading-volume-24h`              | 3.16     |                                |
| `total-fills-24h`                 | 2.52     |                                |
| `fills/stats` baseline            | 2.16     |                                |
| `daily-volume-10d` (no user)      | 1.91     | 10 items, but full-market scan |
| `total-fees-24h`                  | 1.71     |                                |
| `coin-distribution-user`          | 1.48     | 27 items                       |
| `prio-chart-daily-window`         | 0.87     |                                |
| `liq-stats`                       | 0.71     | fastest of batch               |

SDK should expose a short-TTL in-memory cache (e.g. 30s for KPIs, 5min for daily series) to avoid hammering these.

## Per-endpoint sections

### GET /analytics/fills/stats

Sample: `fills-stats-baseline.json`, `fills-stats-coin-btc.json`, `fills-stats-bad-hours.json`.

| Scenario              | Status | Time (s) | Notes                                |
| --------------------- | ------ | -------- | ------------------------------------ |
| baseline (no params)  | 200    | 2.16     | message: `Fill stats for the last 1 hours` — default `hours=1` |
| `coin=BTC&hours=24`   | 200    | 0.85     | adds `coin` field in `data`          |
| `hours=999`           | **422** | 0.71    | cap is 168                            |

**Response `data` shape:**

```ts
interface FillsStatsData {
  total_fills: number;             // int, count of fills in window
  total_volume: number;            // float USD
  total_fees: number;              // float USD-equiv
  total_builder_fees_usdc: number; // float USDC
  unique_users: number;            // int
  unique_coins: number;            // int
  time_range: { start: string; end: string }; // ISO Z second-precision
  coin?: string;                   // present only when ?coin= filter applied
}
```

**Divergences from swagger:** `data` is `any` in spec. Note `coin` field is **conditionally present** (only when filter applied) — SDK type should mark it optional.

**SDK recommendation:** parameter `hours: 1..168`, default 1. Echo `coin` filter through to typed response narrowing.

### GET /analytics/priority-fees/stats

Sample: `prio-stats-baseline.json`, `prio-stats-coin-btc-24h.json`.

| Scenario              | Status | Time (s) | Notes                       |
| --------------------- | ------ | -------- | --------------------------- |
| baseline              | 200    | 1.05     | default `hours=1`           |
| `coin=BTC&hours=24`   | 200    | 0.81     | adds `coin` field           |

**Response `data` shape:**

```ts
interface PriorityFeesStatsData {
  total_fills_with_priority: number;  // int
  total_priority_gas: number;          // float
  avg_priority_gas: number;            // float
  min_priority_gas: number;            // float
  max_priority_gas: number;            // float
  unique_users: number;                // int
  time_range: { start: string; end: string };
  coin?: string;                       // conditional, like fills/stats
}
```

**SDK recommendation:** mirror `FillsStatsData` ergonomics — same `hours: 1..168` and optional `coin`. Consider a shared `TimeRange` type.

### GET /analytics/priority-fees/chart/daily

Sample: `prio-chart-daily-baseline.json`, `prio-chart-daily-window.json`.

| Scenario                          | Status | Time (s) | Notes                                  |
| --------------------------------- | ------ | -------- | -------------------------------------- |
| baseline                          | 200    | 0.83     | 29 items, message `(29 days)`          |
| `start_time=...&end_time=...` 7d  | 200    | 0.87     | 8 items (inclusive both ends)          |

**Response `data` shape (array):**

```ts
interface PriorityFeesDailyPoint {
  date: string;          // "YYYY-MM-DD"
  fills: number;         // int
  fillsWithFee: number;  // int
  totalGas: number;      // float
  uniqueUsers: number;   // int
}
```

**Divergences from swagger:** `data` is `any` in spec. `start_time`/`end_time` accept ISO `Z` (verified with `2026-05-04T00:00:00Z`). Baseline (no window) returns ~29 days of history — likely a fixed lookback.

**SDK recommendation:** expose as `analytics.priorityFees.chartDaily({ from?: Date, to?: Date })`. Document the default ~29-day lookback. Return `Array<{ date: string; ...}>`.

### GET /analytics/priority-fees/gossip/leaderboard

Sample: `prio-gossip-baseline.json`, `prio-gossip-limit5.json`, `prio-gossip-bad-limit.json`.

| Scenario          | Status | Time (s) | Notes                                  |
| ----------------- | ------ | -------- | -------------------------------------- |
| baseline          | 200    | 0.69     | 17 items (no `limit`), msg `(17 wallets)` — **misleading** |
| `limit=5`         | 200    | 0.85     |                                        |
| `limit=500`       | **422** | 0.62    | cap is 200                              |

**Response `data` shape (array):**

```ts
interface GossipLeaderboardEntry {
  address: string;     // IP address, e.g. "54.64.2.87" — NOT an eth wallet
  totalGas: number;    // float
  count: number;       // int (fill count attributed to this gossip node)
  daysActive: number;  // int
}
```

**Divergences from swagger:**
- `address` is an **IPv4 string**, not an eth address. The server message ("wallets") is wrong.
- Total population is small (17 items even with no `limit`). The `limit: 1..200` constraint is unlikely to bind in practice.

**SDK recommendation:** rename to `nodeIp` (or `gossipIp`) in the typed model, with a doc note. Validate IPv4 with a regex on the client to catch future schema drift. Don't bother with cursor pagination.

### GET /analytics/liquidations/stats

Sample: `liq-stats-baseline.json`, `liq-stats-coin-eth-7d.json`, `liq-stats-bad-days.json`.

| Scenario             | Status | Time (s) | Notes                                  |
| -------------------- | ------ | -------- | -------------------------------------- |
| baseline             | 200    | 0.71     | default `days=1`                       |
| `coin=ETH&days=7`    | 200    | 0.69     | adds `coin` field                      |
| `days=999`           | **422** | 0.59    | cap is 30                               |

**Response `data` shape:**

```ts
interface LiquidationsStatsData {
  number_liquidation: number;        // int
  number_long_liquidated: number;    // int
  number_short_liquidated: number;   // int
  amount_liquidated_usd: number;     // float
  total_fees: number;                // float
  top_token_liquidated: string;      // e.g. "BTC"
  time_range: { start: string; end: string };  // µs precision, Z-suffixed
  coin?: string;                     // present only when ?coin= filter applied
}
```

**SDK recommendation:** parameter `days: 1..30`, default 1. Optional `coin`. `top_token_liquidated` may not match `coin` filter — even when filtering by ETH the server returns the global top token; **verify** before relying on this. (In ETH-filter sample, `top_token_liquidated` was still `BTC`.)

### GET /overview/top-traders-24h

Sample: `top-traders-baseline.json`, `top-traders-volume.json`, `top-traders-pnl-pos.json`, `top-traders-pnl-neg.json`, `top-traders-trades.json`, `top-traders-bad-sort.json`.

| Scenario             | Status | Time (s) | Notes                                                       |
| -------------------- | ------ | -------- | ----------------------------------------------------------- |
| baseline             | 200    | 0.86     | 20 items default, ordered like `sort=pnl_pos`               |
| `sort=volume&limit=5`| 200    | 1.24     |                                                             |
| `sort=pnl_pos&limit=5` | 200  | 0.73     | top user matches baseline → baseline default = `pnl_pos`     |
| `sort=pnl_neg&limit=5` | 200  | 0.93     | negative pnl users, ordered most-negative first             |
| `sort=trades&limit=5`| 200    | 0.85     |                                                             |
| `sort=bogus`         | 200    | 0.94     | **silently falls back** to default (returned full 20)        |

**Response `data` shape (array):**

```ts
interface TopTraderEntry {
  user: string;          // 0x... eth address
  tradeCount: number;    // int
  totalVolume: number;   // float USD
  winRate: number;       // float in [0, 1]
  totalPnl: number;      // float USD, signed
}
```

**Divergences from swagger:** swagger lists `sort: pnl_pos|pnl_neg|volume|trades`. Server does not enforce — invalid sort silently returns default. SDK must validate client-side.

**SDK recommendation:** expose `sort` as TS enum; throw before sending unknown values. Default `limit` appears to be 20 (no `limit` returned 20 rows).

### GET /overview/total-fees-24h

Sample: `total-fees-24h.json`.

```ts
data: {
  feesSpot: number;      // float USDC (or USDC-equiv)
  feesPerpUsdc: number;  // float USDC
  totalFees: number;     // float USDC — sum of feesSpot + feesPerpUsdc
}
```

Time: 1.71s. No query params.

**SDK recommendation:** verify the invariant `feesSpot + feesPerpUsdc === totalFees` in a test, since the server computes it.

### GET /overview/active-traders-24h

Sample: `active-traders-24h.json`. Time: **7.50s** (slowest in batch).

```ts
data: {
  value: number;          // int, count of unique active addresses
  variationPct: number;   // float — sign and scale TBD (could be e.g. 0.07 = +7% or 7.0 = +7%)
}
```

**SDK recommendation:** caller-facing helper `getActiveTraders24h(): { count, deltaPct }`. Cache for 30–60s on the client; server is slow. Document `variationPct` units after one more capture (negative + non-zero ideally).

### GET /overview/trading-volume-24h

Sample: `trading-volume-24h.json`. Time: 3.16s.

```ts
data: {
  value: number;         // float USD
  variationPct: number;  // float
}
```

Same `{value, variationPct}` envelope as `active-traders` and `total-fills`.

### GET /overview/total-fills-24h

Sample: `total-fills-24h.json`. Time: 2.52s.

```ts
data: {
  value: number;         // int
  variationPct: number;  // float
}
```

**SDK recommendation:** unify `active-traders-24h`, `trading-volume-24h`, `total-fills-24h` under a single `KpiCard<T> = { value: T; variationPct: number }` generic.

### GET /overview/daily-volume-10d

Sample: `daily-volume-10d-noUser.json`, `daily-volume-10d-user.json`.

| Scenario         | Status | Time (s) | Notes                              |
| ---------------- | ------ | -------- | ---------------------------------- |
| no user (global) | 200    | 1.91     | 10 items, market-wide              |
| `user=0xf5d8…`   | 200    | 0.85     | 10 items, scoped to user           |

```ts
interface DailyVolumePoint {
  date: string;     // "YYYY-MM-DD"
  volume: number;   // float USD
}
```

Items are sorted **oldest → newest** (`2026-05-02` first, `2026-05-11` last).

**SDK recommendation:** `overview.dailyVolume10d({ user?: string })`. Pre-sorted ascending — document for chart bindings.

### GET /overview/daily-pnl-10d

Sample: `daily-pnl-10d.json`. Time: 3.47s.

```ts
interface DailyPnlEntry {
  date: string;   // "YYYY-MM-DD"
  coin: string;   // e.g. "BTC", "@107", "xyz:ZM" — same coin namespace as fills
  pnl: number;    // float USD, signed
}
```

3301 items (10 days × ~330 coins). **No user filter accepted** — this is global. SDK should expose helper to pivot by coin or by date if the caller wants either view.

### GET /overview/coin-distribution

Sample: `coin-distribution-user.json`, `coin-distribution-missing-user.json`, `coin-distribution-bad-user.json`.

| Scenario              | Status | Time (s) | Notes                                       |
| --------------------- | ------ | -------- | ------------------------------------------- |
| `user=0xf5d8…`        | 200    | 1.48     | 27 items, per-coin breakdown                |
| missing `user`        | **422** | 0.61    | `Field required`                            |
| `user=0x123` (bad)    | 200    | 0.94     | `data: []` — **no regex enforcement here**  |

```ts
interface CoinDistributionEntry {
  coin: string;    // e.g. "BTC", "@107"
  volume: number;  // float USD
  fills: number;   // int
}
```

**Divergences from swagger:** `user` regex is NOT enforced on this endpoint (verified `0x123` returns 200 / empty). Compare with `/fills/user/{addr}` which 422s on bad pattern. SDK should validate the address pattern client-side regardless, to give a consistent error.

**SDK recommendation:** require `user` argument; validate eth-address pattern in the SDK. Surface as `overview.coinDistribution({ user })`.

## Open questions

1. **`variationPct` units & sign convention.** Is the value a ratio (`0.07` = +7%) or a percent (`7.0` = +7%)? All three KPI samples were positive — need a follow-up sample during a quieter period to see scale. SDK doc and helper formatting hinge on this.
2. **`top_token_liquidated` ignores `coin` filter?** With `?coin=ETH&days=7`, the returned `top_token_liquidated` was still `BTC`. Either the field is global regardless of filter, or this is a server bug. Confirm before exposing in SDK.
3. **`active-traders-24h` 7.5s response.** Server-side. Worth a backend-cache request to Hypedexer team.
4. **Gossip leaderboard naming.** `address` is an IPv4 — server message "wallets" is misleading. Confirm whether the field will ever return a different format (hostnames? IPv6?). SDK is renaming this to `nodeIp` but want server confirmation.
5. **`sort=bogus` silently passes.** Should be a 422, otherwise SDK has to client-side-validate every enum. Coordinate with backend.
6. **`coin-distribution` accepts any string for `user`.** No regex enforced; 200 + empty. Probably a server gap vs `/fills/user/{addr}` enforcement. SDK will validate client-side.
7. **Coin namespace consistency.** Same as batch 1 — values include `"BTC"`, `"@107"`, `"xyz:ZM"`, `"#250"`, etc. Need a documented canonical list. Resolver from raw `coin` → human label is missing on these analytics endpoints (no `coinMeaning` here, unlike fills).
8. **`prio-chart-daily` default lookback.** Returned 29 days — is this fixed, configurable, or based on data availability? Worth a follow-up call days later to see whether the count moves.
9. **`daily-volume-10d` vs `daily-pnl-10d` granularity mismatch.** Volume is global-only-totals (`{date, volume}`); pnl is broken down by coin (`{date, coin, pnl}`). Symmetry would help: either give pnl a flattened version too or break volume out per-coin. SDK should aggregate pnl client-side if a flat series is desired.
10. **No `tid` / `oid` issues.** Unlike batch 1 where `tid` neared 2^53, none of the numerics in this batch threaten Number safety.
