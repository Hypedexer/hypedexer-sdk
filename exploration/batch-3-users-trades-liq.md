# Batch 3 — Users + Completed Trades + Liquidations

Base URL: `https://api.hypedexer.com` · Auth: `X-API-Key` header · Captured: 2026-05-11
Raw JSON samples: `./samples/batch-3/` (call log: `_calls.tsv`)

## Summary

- **All 10 endpoints reachable.** Envelope is identical to batches 1-2. **Liquidations confirm the batch-1 cursor format `"<epoch_ms>:<tid>"`** — same pagination as `/fills/`, including `has_more` and `total_count` semantics. Completed-trades use **offset pagination** only (no cursor surfaced).
- **Two real server-side bugs discovered.** (1) `/completed-trades/` accepts `limit=99999` and actually returns 99999 rows (~70 MB, 48 s) — **no server cap** on this endpoint (every other limit-having endpoint in this batch caps at 100). (2) `/completed-trades/{trade_id}/fills` returns a **key/value-shifted item**: the values for `feeUsdc` and `typeTrade` are mis-mapped — `feeUsdc: "perp"` (string), `typeTrade: "2026-05-11T15:51:51"` (a timestamp). See `ct-trade-fills.json`. SDK must not trust these two fields on this endpoint; ideally parse positionally or skip them.
- **Validation is now mixed across the API.** `/users/leaderboard?by=bogus` → 422 (good — batch 2 had `/overview` silently ignoring `sort=bogus`). `/liquidations/?order=bogus` → 422. But `/completed-trades/?sort_by=bogus` → 200 silent fallback. So the silent-fallback validation gap **still exists** for completed-trades. SDK must validate `sort_by` client-side.
- **`/liquidations/?cursor=garbage`** is silently ignored — returns first page, no error. Different `total_count` per call (probably non-deterministic cache), and **`order=asc` produces a clearly broken `next_cursor` `"20911751377956:0"`** (epoch_ms in the year 2245) and `time_ms` on the oldest row is `8713204932780` (year 2245). The `time` field is correct (`2025-03-22`); only `time_ms` and the cursor are wrong on very old liquidation rows. Avoid `order=asc` deep paging until fixed.
- **`{user}/overview` on a bogus address returns 200 with zeroed stats and `last_activity: "1970-01-01T00:00:00"`** — no regex enforcement at this level. Same gap as `/overview/coin-distribution` in batch 2. SDK should validate the eth-address pattern client-side; the `0x123` here did not 422.
- **`limit` caps in batch 3 are 100, not 1000.** Verified on `/users/coins` and `/users/leaderboard`. Different from batch 1's 1000 cap on `/fills/`. SDK needs per-endpoint cap config.
- **`completed-trades` and its `summary` set `execution_time_ms: null` at the envelope level** (regression vs batch 2 where it was always populated). Only the list endpoints inside this group share this; users + liquidations endpoints do populate it.

## Cross-cutting observations

### APIResponse envelope

Identical 7-key envelope from batches 1-2 holds across all 10 endpoints. Notable variance:

| Endpoint                              | `total_count`                | `execution_time_ms` | `next_cursor` | `has_more` |
| ------------------------------------- | ---------------------------- | ------------------- | ------------- | ---------- |
| `/users/{user}/overview`              | `null`                       | populated           | `null`        | `null`     |
| `/users/{user}/performance`           | `null`                       | populated           | `null`        | `null`     |
| `/users/{user}/coins`                 | = page size (e.g. 10)        | populated           | `null`        | `null`     |
| `/users/leaderboard`                  | = page size                  | populated           | `null`        | `null`     |
| `/users/active`                       | = page size                  | populated           | `null`        | `null`     |
| `/completed-trades/`                  | usually = page size, but `?coin=BTC` gave `12824851` (true total); `?do_count=true` gave page-size again | **null** | `null` | `null` |
| `/completed-trades/summary`           | `null`                       | **null**            | `null`        | `null`     |
| `/completed-trades/{trade_id}/fills`  | = fill count for trade (real)| populated           | `null`        | `null`     |
| `/liquidations/`                      | sometimes true global, sometimes `null` (when `order=asc`), sometimes 0 | populated | **populated** (cursor flow works) | **populated** |
| `/liquidations/recent`                | `null`                       | populated           | **populated** | **populated** |

Implications for SDK:
- `total_count` remains unreliable. Only treat as authoritative when the endpoint *consistently* returns a value across filter variations (only `/liquidations/` with filters gives a real total; `/completed-trades/?coin=...` does too).
- `execution_time_ms: null` on completed-trades looks like a server bug (parity broken with the rest of the API). Worth flagging upstream.
- Liquidations are the **second cursor-paginated group** confirmed, after `/fills/`. Spot fills and completed-trades remain offset-only.

### Pagination

- **`/liquidations/` cursor format:** identical to fills — `"<epoch_ms>:<tid>"`, e.g. `1778514365496:438396392217777`. Round-trip works (page1→page2 produced disjoint sets; see `liq-baseline.json` vs `liq-page2.json`). `has_more=true` on a populated response, `has_more=false` on empty.
- **`/liquidations/?cursor=garbage`** is silently ignored (returns first page). No 422. SDK should treat cursors as opaque and not re-validate, but document that bad cursors won't fail loudly.
- **`order=asc` returns broken cursor** `"20911751377956:0"` (year 2245). Suspect the oldest row has a bogus `time_ms` (`8713204932780`) that the cursor builder reads verbatim. Symptom: cursor → first page no-progress loop. Recommend SDK refuses to iterate `order=asc` until backend is fixed, or detect `tid:0` cursor and stop.
- **`/completed-trades/` uses offset only.** `limit=3&offset=0` vs `offset=3` produced disjoint `trade_id`s (verified `ct-page1.json` vs `ct-page2.json`). No `next_cursor` ever returned.

### Numeric & ID encoding

All numerics remain JSON numbers (no strings). New observations:

- `tid` in liquidations reaches `8713204932780` (small) up to `996355826550339` — same magnitude class as batch 1 fills. Same `bigint` concern.
- `trade_id` on completed-trades is a **string**, format `"trade_<coin>_<8hex>"`, e.g. `"trade_hyna:BTC_858bdd2c"`. Contains `:` for namespaced coins → **must be URL-encoded** when used as a path segment (verified: both encoded and raw form work on this server, but encoded is the safe choice).
- `crossed: 0` and `cloid: "0x..."` are **new fields** vs the batch-1 `Fill` definition (only seen on the completed-trades fills sub-endpoint).
- `win_rate`, `avg_pnl_pct` are unit floats but `avg_pnl_pct` is sometimes >1 (1.09 in `ct-summary-baseline`) — likely a true percent on this field, unlike `win_rate`. Inconsistent.
- `avg_duration_s`, `avg_holding_time_s` come back nonsensically large (10^9 s ≈ 30 years on `user-performance-baseline`, 10^11 s on `ct-summary-baseline`). Either a server aggregation bug or these include trades that "never closed". Do not surface these without a sanity filter.
- `liquidator_count` up to **8** observed; `liquidators` array of eth addresses (possibly empty on `order=asc` outliers).
- `liquidated_user` can be **empty string** (not `null`) on old/corrupt rows. SDK should treat empty as missing.

### Date encoding

- `users/{user}/*` and `completed-trades`: ISO no TZ, microsecond precision — same as batch-1 `time` (`"2026-05-11T15:51:21"`, `"2026-05-11T09:45:42.642000"`).
- `liquidations` `time`: ISO no TZ, **second precision** (`"2026-05-11T15:46:11"`) — new variant.
- `liquidations` `time_ms`: integer epoch ms. **May be corrupted on old rows** (`8713204932780` for a 2025-03-22 fill).
- `last_activity` on `user-overview-bad-addr`: `"1970-01-01T00:00:00"` — epoch zero sentinel for "no activity". SDK should treat as null.
- `ct-summary` `time_range.start/end`: ISO no TZ, µs precision (`"2025-08-18T07:17:54.011000"`) — yet another variant. Adding to the date-format inventory established in batches 1-2:

Date format inventory now:
1. ISO no TZ, µs (batch 1, batch 3 users/trades): `"2026-05-11T15:22:49.398000"`
2. ISO no TZ, **seconds** (batch 3 liquidations): `"2026-05-11T15:46:11"`
3. ISO `+00:00`, µs (`/fills/count`): `"2026-05-11T15:24:14.018991+00:00"`
4. ISO `Z`, seconds (batch 2 stats `time_range`): `"2026-05-11T14:40:32Z"`
5. ISO `Z`, µs (batch 2 liquidations stats): `"2026-05-10T15:40:43.737038Z"`
6. Bare calendar date (batch 2 daily series): `"2026-05-02"`
7. **Epoch ms integer** (batch 3 liquidations `time_ms`): `1778514371378`

SDK should ship one lenient ISO parser plus an integer-ms branch.

### Validation summary (this batch)

| Param/endpoint                         | Bad input            | Behavior         |
| -------------------------------------- | -------------------- | ---------------- |
| `/users/leaderboard?by=bogus`          | enum violation       | **422** (good)   |
| `/users/leaderboard?hours=999`         | range                | 422 (cap 168)    |
| `/users/leaderboard?limit=99999`       | range                | 422 (**cap 100**) |
| `/users/{user}/coins?limit=999`        | range                | 422 (cap 100)    |
| `/users/{user}/overview` bad addr      | pattern              | **200, zeroed**  |
| `/completed-trades/?sort_by=bogus`     | enum violation       | **200 silent fallback** (default sort) |
| `/completed-trades/?limit=99999`       | huge limit           | **200**, returns 99999 rows (~70 MB, 48 s) |
| `/completed-trades/?coin=DOESNOTEXIST` | unknown coin         | 200 empty (consistent) |
| `/liquidations/?order=bogus`           | pattern              | 422              |
| `/liquidations/?limit=99999`           | range                | 422 (cap 100)    |
| `/liquidations/?cursor=garbage`        | bad cursor           | **200, ignored** (first page) |
| `/liquidations/?coin=DOESNOTEXIST`     | unknown coin         | 200 empty        |
| `/completed-trades/<bogus_id>/fills`   | unknown trade        | 200 empty (no 404) |

### Filter consistency

- `coin=DOESNOTEXIST` → 200 + empty on both completed-trades and liquidations (matches batch 1).
- Bogus eth address: 200 zeroed on `users/{user}/overview` (matches batch 2 `coin-distribution`). The address-regex enforcement seen on `/fills/user/{addr}` is **not** applied here.
- Bogus `trade_id` → 200 empty (no 404). SDK should expose `getTradeFills` returning `Fill[]` with empty as "not found".

## Per-endpoint sections

### GET /users/{user}/overview

Sample: `user-overview-baseline.json`, `user-overview-timewindow.json`, `user-overview-bad-addr.json`. Time: 1.9s / 0.9s / 5.3s.

`data` (object):
```ts
interface UserOverview {
  user: string;                // echoes input, NOT normalized
  total_volume: number;        // USD
  total_fees: number;          // USD
  fill_count: number;          // int
  unique_coins: number;        // int
  total_pnl: number;           // USD, signed
  total_trades: number;        // int (≠ fill_count: a trade = open+close)
  total_priority_gas: number;  // float; observed 0.0 even on heavy users — may not be wired up
  last_activity: string;       // ISO no TZ, second precision; "1970-01-01T00:00:00" = no activity
  win_rate: number;            // float in [0,1]
}
```

SDK recommendations:
- Validate eth-address client-side; do not rely on server (200 + zeroed sentinel).
- Treat `last_activity === "1970-01-01T00:00:00"` as `null`.
- `total_priority_gas` looks unreliable (always 0 on the high-volume sample). Mark experimental.

### GET /users/{user}/performance

Sample: `user-performance-baseline.json`, `user-performance-timewindow.json`. Time: 2.0s / 0.8s.

`data`:
```ts
interface UserPerformance {
  user: string;
  total_trades: number;
  win_rate: number;            // [0,1]
  avg_win: number;             // USD
  avg_loss: number;            // USD, positive number (loss magnitude)
  profit_factor: number;       // gross profit / gross loss
  max_drawdown: number;        // USD, positive (magnitude)
  avg_trade_size: number;      // USD
  avg_holding_time_s: number;  // FLOAT seconds — observed 3.7e11 (decades) — suspicious aggregation
  wins: number;
  losses: number;              // (wins + losses) can be < total_trades — break-evens excluded
  total_pnl: number;
}
```

SDK recommendations:
- Surface `avg_holding_time_s` as `number` but warn in docs. Server likely includes never-closed positions in the average.
- `wins + losses < total_trades` (74601+60484=135085 vs 149232) — emit a `breakEvens = total_trades - wins - losses` field for ergonomics.

### GET /users/{user}/coins

Sample: `user-coins-baseline.json`, `user-coins-timewindow.json`, `user-coins-bad-limit.json`. Time: 1.2s / 0.8s / 0.8s.

`data` is `CoinAggregate[]`:
```ts
interface UserCoinAggregate {
  coin: string;             // raw coin id, namespaced (e.g. "BTC", "@107", "xyz:XYZ100")
  total_volume: number;     // USD
  fill_count: number;
  total_fees: number;
  avg_price: number;
  price_range: { min: number; max: number };
  total_pnl: number;
}
```

- `limit` cap = **100** (422 on 999).
- No `coinMeaning` field here (unlike fills). Resolver would need to be SDK-side.
- `total_count` returned equals `data.length` (page size, like spot fills in batch 1) — useless as a global total.

### GET /users/leaderboard

Sample: `leaderboard-volume.json`, `-pnl.json`, `-trades.json`, `-priority-fees.json`, `-bogus-by.json`, `-bad-hours.json`, `-bad-limit.json`. Time: 1.1–1.8s.

**`data` item shape varies per `by`** — this is a real polymorphism:

```ts
type LeaderboardBy = "volume" | "pnl" | "trades" | "priority_fees";

interface LeaderboardByVolume       { user: string; total_volume: number;       fill_count: number; unique_coins: number; }
interface LeaderboardByPnl          { user: string; total_pnl: number;          trade_count: number; }
interface LeaderboardByTrades       { user: string; fill_count: number;         total_volume: number; }
interface LeaderboardByPriorityFees { user: string; total_priority_gas: number; fill_count: number; }
```

Caps: `hours: 1..168`, `limit: 1..100`. `by` is a strict enum (422 on bogus — confirmed fix vs batch 2's `top-traders` silent fallback).

SDK recommendation: discriminated union keyed on `by`. Provide one method per `by` for ergonomic TS narrowing.

### GET /users/active

Sample: `active-baseline.json`, `active-24h.json`. Time: 1.8s / 2.0s.

```ts
interface ActiveUser {
  user: string;
  fill_count: number;
  total_volume: number;
  unique_coins: number;
  last_activity: string;    // ISO no TZ, µs precision
}
```

Defaults: `hours=1`. `limit` likely caps at 100 (not explicitly tested; matches user-coins/leaderboard).

### GET /completed-trades/

Sample: `ct-baseline.json`, `ct-filter-*.json`, `ct-page1/2.json`, `ct-with-count.json`, `ct-sort-*.json`, `ct-bad-*.json`. Time: 0.7–2.3s; **`limit=99999` took 48 s and returned 70 MB**.

`data` is `Trade[]`:
```ts
interface Trade {
  user: string;
  coin: string;                       // namespaced
  direction: "long" | "short";
  start_time: string;                 // ISO no TZ µs
  end_time: string;                   // ISO no TZ µs
  duration_s: number;                 // int
  entry_price: number;
  exit_price: number;
  size_close: number;
  pnl_realized: number;               // USD signed
  leverage_type: "cross" | "isolated";
  position_value: number;             // USD
  total_fills: number;                // typically 2
  total_fees: number;                 // USD
  avg_fill_price: number;
  first_fill_time: string;            // = start_time?
  last_fill_time: string;             // = end_time?
  total_volume: number;
  trade_id: string;                   // "trade_<coin>_<8hex>", contains ':' for namespaced coins
  close_hash: string;                 // 0x...
  created_at: string;                 // ISO no TZ µs
}
```

Params: `user`, `coin`, `direction` (`long|short`), `start_time`, `end_time`, `min_pnl`, `max_pnl`, `offset`, `limit`, `do_count`, `sort_by`, `sort_dir`.

Issues:
- **`sort_by=bogus` → 200 silent fallback.** Validate client-side. Likely valid: `pnl`, `time`, `volume`, `duration` (not tested exhaustively).
- **No `limit` cap.** `limit=99999` accepted. SDK MUST cap client-side at ~100 to be safe.
- `do_count=true` had no observable effect (`total_count` still equal to page size). Possibly a flag that only matters for very specific filters.
- `total_count`: real global total only when a filter is supplied (e.g. `coin=BTC` → 12,824,851); otherwise echoes page size.
- No cursor pagination — offset only.

SDK recommendations:
- Hard-cap `limit` at 100, default 50.
- Validate `sort_by`/`direction` against typed enums before sending.
- URL-encode `trade_id` (contains `:`).

### GET /completed-trades/summary

Sample: `ct-summary-baseline.json`, `-user.json`, `-coin-btc.json`, `-direction-short.json`, `-timewindow.json`. Time: 1.0–2.5s.

```ts
interface TradesSummary {
  total_trades: number;
  total_pnl: number;
  avg_pnl_pct: number;                 // possibly true % (e.g. 1.09 → +1.09%), not [0,1]
  avg_duration_s: number;              // similarly inflated (10^11 s on full-history) — suspect
  total_fees: number;
  total_volume: number;
  time_range: { start: string; end: string };  // ISO no TZ µs
  direction_breakdown: Array<{ direction: "long" | "short"; count: number; total_pnl: number }>;
  top_coins: Array<{ coin: string; trade_count: number; total_pnl: number; total_volume: number }>;
}
```

- Filters supported: `user`, `coin`, `direction`, `start_time`, `end_time`. `time_range` echoes back the bounds (full history if not supplied — `start: 2025-08-18`).
- `execution_time_ms` envelope field is **null** here (parity break).

### GET /completed-trades/{trade_id}/fills

Sample: `ct-trade-fills.json` (real id), `ct-trade-fills-bogus.json` (bogus). Time: 2.3s / 0.9s.

`data` is a `Fill[]`-like array. **Item is buggy:**

```ts
// As returned (key/value mis-mapped on last two fields):
interface TradeFillRaw {
  user: string;
  coin: string;
  coinMeaning: string;
  px: number; sz: number;
  side: "A" | "B";
  time: string;          // ISO no TZ µs
  startPosition: number;
  dir: string;           // "Open Long" | "Close Long" | ...
  closedPnl: number;
  hash: string;
  oid: number;
  crossed: 0 | 1;        // NEW vs batch-1 Fill — boolean-as-int
  tid: number;
  cloid: string;         // NEW vs batch-1 Fill — "0x..." 32-byte client order id
  fee: number;
  feeToken: string;
  feeUsdc: string;       // !!! BUG: contains "perp" (value of typeTrade)
  typeTrade: string;     // !!! BUG: contains a timestamp (likely created_at)
}
```

The two trailing fields are shifted by one — almost certainly a server-side `dict` build order mismatch (perhaps `feeUsdc` and `typeTrade` got assigned the next two values in a positional zip). Both rows in `ct-trade-fills.json` exhibit the same misalignment, so it is deterministic.

SDK recommendation: expose a `TradeFill` type that **omits or renames** these two fields:
```ts
type TradeFill = Omit<TradeFillRaw, "feeUsdc" | "typeTrade"> & {
  // until backend is fixed, do not expose these
};
```
Or, if the SDK wants to recover the values: `typeTrade` is always `"perp"` on these (matches the raw `feeUsdc` value), and the `typeTrade` field actually holds an ISO timestamp — but trusting this requires backend confirmation.

Bogus `trade_id` → 200 with `data: []`, no 404.

### GET /liquidations/

Sample: `liq-baseline.json`, `liq-filter-*.json`, `liq-order-*.json`, `liq-page1/2.json`, `liq-bad-*.json`, `liq-bad-cursor.json`. Time: 0.6–1.0s.

`data` is `Liquidation[]`:
```ts
interface Liquidation {
  time: string;                  // ISO no TZ, SECOND precision (new variant)
  time_ms: number;               // epoch ms; CORRUPT on very old rows (e.g. 8713204932780)
  coin: string;                  // namespaced
  hash: string;                  // 0x...
  liquidated_user: string;       // 0x... — may be "" (empty string, not null) on outliers
  size_total: number;
  notional_total: number;
  fill_px_vwap: number | null;
  mark_px: number | null;
  method: "market" | string | null;
  fee_total_liquidated: number;
  liquidators: string[];         // 0x... addresses; up to 8 observed
  liquidator_count: number;
  liq_dir: "Long" | "Short" | null;  // direction of the LIQUIDATED position
  tid: number;
}
```

Params: `coin`, `user`, `start_time`, `end_time`, `amount_dollars` (min notional), `limit` (cap 100), `cursor` (opaque, ignored if invalid), `order` (`asc|desc`, regex enforced).

Pagination: cursor `"<epoch_ms>:<tid>"` confirmed identical to batch-1 fills cursor. `has_more` populated. `total_count` sometimes a true global (805628 on baseline, 127625 with `amount_dollars=10000`), sometimes `null` (on `order=asc`, on `recent`). Inconsistent — same caveat as batch 1.

Issues:
- **`order=asc` produces broken cursor** (`"20911751377956:0"`) due to a corrupt `time_ms` on the oldest row. Avoid.
- **`?cursor=garbage`** silently returns first page (200, no error).
- `total_count` jitters slightly between identical calls (805628 vs 680401) — likely cache-driven snapshots.

SDK recommendations:
- Cursor iterator backed by `next_cursor`/`has_more`, identical to fills.
- Refuse `order=asc` for deep pages (or detect `:0` tail) until backend fixes the `time_ms` corruption.
- Treat `liquidated_user === ""` as `null` post-decode.

### GET /liquidations/recent

Sample: `liq-recent-baseline.json`, `liq-recent-coin-btc.json`. Time: 0.7s.

Same item shape as `/liquidations/`. Differences:
- `total_count: null` always (24h hot-cache window — same pattern as `/fills/recent`).
- Cursor still works (`next_cursor` populated).

SDK should share the `Liquidation` type with `/liquidations/` and expose `.recent` as a faster alternative for last-24h queries.

## Open questions

1. **`/completed-trades/?limit=99999` accepted** — server has no cap on this endpoint. Is that intentional? Risk for both server load and clients. Recommend the API team add `limit: 1..100` validation.
2. **`/completed-trades/{trade_id}/fills` field misalignment** (`feeUsdc`="perp", `typeTrade`=ISO timestamp). Server bug. Confirm and patch — and decide whether `crossed` and `cloid` should be added to the canonical `Fill` schema for consistency with batch 1.
3. **`/completed-trades/?sort_by=bogus` silent fallback.** Should be 422 (matches the fix observed on `/users/leaderboard?by=bogus`). Server-side validation parity.
4. **`execution_time_ms` is `null` on `/completed-trades/*`.** Parity break with the rest of the API. Server bug or intentional?
5. **`/liquidations/?order=asc` cursor `"20911751377956:0"`** and matching corrupt `time_ms`. Suggests one or more old liquidation rows have a bogus `time_ms`. Recommend either filtering them server-side or recomputing `time_ms` from `time`.
6. **`/users/{user}/overview` bogus-address policy.** 200 + zeroed sentinel vs 422 (as on `/fills/user/{addr}`). Pick one consistent policy across the API.
7. **`total_priority_gas` always 0** on heavy users in `user-overview-baseline`. Wired up?
8. **`avg_holding_time_s` / `avg_pnl_pct` / `avg_duration_s` magnitudes are nonsensical** (years for holding times, e-11 for duration). Aggregation likely includes still-open or never-closed positions. Worth a calculation review.
9. **`win_rate` is unit ratio (0..1), `avg_pnl_pct` looks like a true percent.** Document and unify units across the SDK surface.
10. **`liquidator_count` up to 8.** Is there a documented max? Useful for the SDK to know whether to flatten or keep as array.
11. **`do_count=true` had no visible effect.** What does it actually toggle?
12. **`trade_id` URL safety.** Server accepted both raw `:` and `%3A` in path. SDK will always encode — confirm encoded form remains valid.

Samples directory: `/home/yaugourt/hypedexer-sdk/exploration/samples/batch-3/` (call log `_calls.tsv`). Total endpoint sample files: ~50 JSON files (incl. `ct-bad-limit.json` ~70 MB).
