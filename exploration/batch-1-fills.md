# Batch 1 — Fills endpoints

Base URL: `https://api.hypedexer.com` · Auth: `X-API-Key` header · Captured: 2026-05-11
Raw JSON samples: `./samples/batch-1/` (call log: `_calls.tsv`, OpenAPI snapshot: `_openapi.json`)

## Summary

- **6 endpoints tested, 6 reachable.** All happy-paths return 200; validation errors return FastAPI-style 422; auth errors return **401** with a plaintext body (not JSON).
- **All numeric fields come back as JSON numbers (float/int), not strings.** Good news for the SDK — no string-to-number decoding needed for `px`, `sz`, `fee`, `notional`, `closedPnl`, `startPosition`, `priorityGas`, `feeUsdc`.
- **Date `time` is an ISO-8601 string WITHOUT timezone suffix** (e.g. `"2026-05-11T15:22:49.398000"`). Per-fill `time` has no `Z`; `count.data.timestamp` *does* have `+00:00`. Inconsistent — SDK should normalize.
- **Two pagination styles coexist.** `/fills/`, `/fills/recent`, `/fills/user/{addr}` expose `next_cursor` (string `"<ms>:<tid>"`) + `has_more`. `/fills/spot/*` returns `next_cursor=null`, `has_more=null` — spot is **offset-only** in practice; `total_count` on spot also reflects the *page* size (5), not a true total.
- **Compact response items omit several swagger-implied fields and include several swagger-undocumented ones.** The actual fill schema is NOT modeled in the OpenAPI components (only request schemas exist). Notable extras: `coinMeaning`, `dir`, `startPosition`, `closedPnl`, `liqMarkPx`, `liqMethod`, `liquidatedUser`, `liquidationRole`, `priorityGas`, `typeTrade`, `feeUsdc` (spot only).
- **`/fills/count` returns a wrapped object** (`data: { count, timestamp, execution_time_ms }`), unlike list endpoints (`data: Fill[]`).

## Cross-cutting observations

### APIResponse envelope (actual)

All happy-path responses follow:

```ts
{
  success: boolean;          // always true on 200, default true
  message: string;           // human-readable, e.g. "Fetched 5 fills (compact)"
  data: Fill[] | object;     // list endpoints → array; /count → object
  total_count: number | null;
  execution_time_ms: number | null;  // server-side processing time
  next_cursor: string | null;
  has_more: boolean | null;
}
```

Quirks:
- `total_count` is **inconsistent**: sometimes the true global count (`fills-filter-coin-btc: 383338331`), sometimes 0 on empty filters, sometimes `null` (`fills-baseline`, `fills-page1`), and on `/fills/spot/*` it is **the page size** (5), not a total. Cannot be relied on.
- `execution_time_ms` is a float in ms, present on list endpoints, `null` on `/fills/count` (which embeds its own `execution_time_ms` inside `data`).
- `has_more`/`next_cursor` are `null` on `/fills/spot/*` even when more rows exist — they are simply not implemented for spot.

### Pagination

- **Cursor format observed:** `"<epoch_ms>:<tid>"`, e.g. `"1778513002104:444284598976375"`. Sortable, opaque, safe to round-trip.
- Cursor pagination works on `/fills/`, `/fills/recent`, `/fills/user/{addr}`. Confirmed page1→page2 transition produces distinct, newer-to-older results.
- `/fills/spot/` and `/fills/spot/user/{addr}` ignore cursor in responses (always `null`); pagination must use `offset`. Verified offset=0 vs offset=5 returns different rows.

### Numeric encoding

All numbers are JSON numbers (no string-wrapped decimals). Fields & observed types:

| Field            | Type   | Notes                                                 |
| ---------------- | ------ | ----------------------------------------------------- |
| `px`             | number | price, float                                          |
| `sz`             | number | size, float                                           |
| `notional`       | number | float                                                 |
| `fee`            | number | float, in `feeToken` units (may be HYPE, USDT0, etc.) |
| `feeUsdc`        | number | spot only, USDC-equivalent of fee                     |
| `closedPnl`      | number | perp only                                             |
| `startPosition`  | number | perp only, can be negative                            |
| `priorityGas`    | number \| null | usually null, float (e.g. `9.79e-06`) when set |
| `oid`            | number | order id, big int but fits JS Number safely so far    |
| `tid`            | number | trade id, big int — **could exceed 2^53**, audit needed |
| `isLiquidation`  | number | 0/1 — boolean encoded as int (swagger says `integer`) |

`tid` values observed up to `1097587181317310` (≈10^15), still under `Number.MAX_SAFE_INTEGER` (≈9×10^15) but close enough that the SDK should consider exposing it as `bigint | string` for safety.

### Date encoding

- Per-fill `time`: `"2026-05-11T15:22:49.398000"` — ISO 8601 with microseconds, **no timezone suffix**. Should be treated as UTC.
- `/fills/count` `data.timestamp`: `"2026-05-11T15:24:14.018991+00:00"` — ISO 8601 with explicit `+00:00`.
- `start_time` / `end_time` query params accept ISO UTC with `Z` (verified working with `2026-05-11T14:22:53Z`).

SDK recommendation: parse to `Date` and re-emit as ISO `Z` for callers.

### Auth behavior

| Scenario              | Status | Body                                                     |
| --------------------- | ------ | -------------------------------------------------------- |
| Missing `X-API-Key`   | **401** | plaintext `missing api key` (not JSON, no envelope)     |
| Wrong key             | **401** | plaintext `invalid api key` (not JSON, no envelope)     |
| Valid key             | 200    | JSON envelope                                            |

SDK must defensively handle non-JSON 401 bodies. No 403 observed.

### Validation errors (422)

Standard FastAPI shape:

```json
{ "detail": [ { "type": "...", "loc": ["query"|"path", "<field>"], "msg": "...", "input": "...", "ctx": {...} } ] }
```

- `limit=99999` → 422, message `Input should be less than or equal to 1000`. **Real max `limit` = 1000.**
- `user_address=0x123` → 422, `String should match pattern '^0x[0-9a-fA-F]{40}$'`. Pattern enforced server-side.

### Bad-coin behavior

`coin=DOESNOTEXIST` returns **200 with `data: []`** on all list endpoints (not 422). Filtering is permissive — the SDK should not assume a 200 means the coin exists.

## Per-endpoint

### GET /fills/

| Scenario               | Status | Time (s) | Notes                                   |
| ---------------------- | ------ | -------- | --------------------------------------- |
| baseline `limit=5`     | 200    | 2.19     | `next_cursor` present, `has_more=true`  |
| `coin=BTC`             | 200    | 14.65    | slow; `total_count=383338331`           |
| `side=B`               | 200    | 16.32    | slow                                    |
| `has_priority_gas=true`| 200    | 4.11     | priorityGas shows non-null float        |
| cursor page1→page2     | 200    | 1.39 / 16.5 | cursor works, second page is older  |
| `start_time`/`end_time`| 200    | 0.80     | accepts `Z`-suffixed ISO                |
| `coin=DOESNOTEXIST`    | 200    | 1.27     | empty `data`, `total_count=0`           |
| `limit=99999`          | **422** | 1.02    | cap = 1000                              |

**Response item shape (`Fill` perp+spot unified):**

```ts
interface Fill {
  user: string;                // 0x...
  coin: string;                // e.g. "BTC", "@107", "xyz:EWY", "#250", "cash:MSFT"
  coinMeaning: string;         // resolved human name (may equal coin or differ, e.g. "@107" → "HYPE")
  px: number;
  sz: number;
  side: "A" | "B";             // A = Ask/Sell, B = Bid/Buy
  time: string;                // ISO-8601 no TZ, UTC
  startPosition: number;       // perp only (still present in /fills/ rows of typeTrade=spot?)
  dir: string;                 // "Open Long" | "Close Long" | "Open Short" | "Close Short" | "Buy" | "Sell"
  closedPnl: number;
  hash: string;                // 0x... 66-char tx hash
  oid: number;
  tid: number;                 // potentially huge — see Numeric Encoding
  fee: number;
  feeToken: string;            // "USDC" | "USDT0" | "HYPE" | "KNTQ" | "+250" | ...
  typeTrade: "perp" | "spot";  // mixed in /fills/ stream
  isLiquidation: 0 | 1;        // integer, not boolean
  liquidationRole: "none" | string;
  liqMarkPx: number | null;
  liqMethod: string | null;
  liquidatedUser: string | null;
  notional: number;
  priorityGas: number | null;
}
```

**Divergences from swagger:**
- Swagger only models `FillsRequest` (the query inputs). No `Fill` response schema is defined; the response is typed as the generic `APIResponse` with `data: any`. The SDK must define its own `Fill` type — capture from this run.
- Side values are `"A"`/`"B"` not human-readable.
- `total_count` semantics not documented (sometimes global count, sometimes null, sometimes 0).

**SDK recommendations:**
- Expose `iterate()` async generator backed by `next_cursor` for `/fills/` and `/fills/recent`.
- Add an `enum Side { Ask = "A", Bid = "B" }` and map to/from `"buy"/"sell"` for ergonomics.
- Cap `limit` client-side at 1000 with a clear error.
- Normalize `time` → `Date` (assume UTC).

Samples: `fills-baseline.json`, `fills-filter-coin-btc.json`, `fills-filter-side-b.json`, `fills-filter-prio-gas.json`, `fills-page1.json`, `fills-page2.json`, `fills-timewindow.json`, `fills-bad-coin.json`, `fills-bad-limit.json`.

### GET /fills/recent

| Scenario               | Status | Time (s) | Notes                              |
| ---------------------- | ------ | -------- | ---------------------------------- |
| baseline               | 200    | 0.84     | message says `recent fills`        |
| `coin=ETH`             | 200    | 0.82     | `total_count=384296` (24h-scoped)  |
| `side=A`               | 200    | 1.47     |                                    |
| cursor page1→page2     | 200    | 0.72 / 0.84 | cursor works identically to /fills/ |
| time window            | 200    | 0.80     |                                    |
| `coin=DOESNOTEXIST`    | 200    | 0.75     | empty                              |

**Shape:** identical to `/fills/`. Only differences are (a) message string (`Fetched N recent fills (compact)`) and (b) the 24h TTL window — total counts are noticeably smaller.

**Divergences from swagger:** none beyond the shared `Fill` schema not being defined.

**SDK recommendations:**
- Share `Fill` type with `/fills/`.
- Expose as `fills.recent.list({...})` and `fills.recent.iterate({...})`.
- Document that this endpoint is materially faster (sub-second consistently vs multi-second on the full history).

Samples: `recent-baseline.json`, `recent-filter-coin-eth.json`, `recent-filter-side-a.json`, `recent-page1.json`, `recent-page2.json`, `recent-timewindow.json`, `recent-bad-coin.json`.

### GET /fills/user/{user_address}

User used: `0xcee1cc9b396bde5944482f64f3e18be7b8d5df73` (pulled from `/fills/recent` baseline).

| Scenario               | Status | Time (s) | Notes                                                |
| ---------------------- | ------ | -------- | ---------------------------------------------------- |
| baseline               | 200    | 1.35     | `total_count=10241658` for this user                 |
| `coin=BTC`             | 200    | 1.01     | empty (this user has no BTC fills)                   |
| cursor page1→page2     | 200    | 0.96 / 1.01 | works                                              |
| `time_range=24h`       | 200    | 0.90     | accepts `1h/24h/7d/30d` enum per swagger             |
| `start_time/end_time`  | 200    | 1.08     |                                                      |
| `user=0x123` (bad)     | **422** | 0.63    | pattern enforced                                     |
| `limit=99999`          | **422** | 0.79    | cap=1000                                             |

**Response shape:** `Fill[]` minus `startPosition`, `dir`, `closedPnl` (these three are **not** returned by user endpoint — only by `/fills/` global and `/fills/recent` global). The user endpoint returns a slightly trimmer record.

```ts
// Diff vs Fill: omits startPosition, dir, closedPnl
type UserFill = Omit<Fill, "startPosition" | "dir" | "closedPnl">;
```

**Divergences from swagger:** none in inputs. Response is again `any` in spec.

**SDK recommendations:**
- Expose `time_range` as a typed union `"1h" | "24h" | "7d" | "30d"` (regex-validated server-side).
- The SDK should expose two distinct types `Fill` (global) and `UserFill` (user-scoped) OR mark `startPosition/dir/closedPnl` as optional on a unified type. Recommend optional fields on a single `Fill` type to keep one model.

Samples: `user-baseline.json`, `user-filter-coin.json`, `user-page1.json`, `user-page2.json`, `user-timerange-24h.json`, `user-timewindow.json`, `user-bad-addr.json`, `user-bad-limit.json`.

### GET /fills/count

| Scenario  | Status | Time (s) | Notes                                  |
| --------- | ------ | -------- | -------------------------------------- |
| single    | 200    | 0.71     | `count = 2794558408` at capture time   |

**Response shape:**

```ts
{
  success: true,
  message: "Number of fills",
  data: {
    count: number,                  // 2794558408
    timestamp: string,              // ISO with +00:00
    execution_time_ms: number       // server-side
  },
  total_count: null,
  execution_time_ms: null,          // moved into data.execution_time_ms!
  next_cursor: null,
  has_more: null
}
```

**Divergences from swagger:** `data` is an object, not an array. `execution_time_ms` exists at *both* envelope-level (null) and inside `data` (populated) — inconsistent placement.

**SDK recommendations:**
- Return just `data.count` (number) from a `fills.count()` helper, but expose the full envelope for advanced callers.
- Add a unit test that `data` is detected as object not array.

Sample: `count.json`.

### GET /fills/spot/

| Scenario                | Status | Time (s) | Notes                                                |
| ----------------------- | ------ | -------- | ---------------------------------------------------- |
| baseline                | 200    | 1.26     | `total_count=5` (!! = page length, not global)       |
| `coin=PURR`             | 200    | 0.74     | empty                                                |
| `side=B`                | 200    | 0.79     |                                                      |
| time window             | 200    | 0.74     |                                                      |
| `coin=DOESNOTEXIST`     | 200    | 0.81     | empty                                                |
| `offset=0` vs `offset=5`| 200    | 0.72 / 0.73 | works                                              |

**Response item shape (spot):**

```ts
interface SpotFill {
  user: string;
  coin: string;            // "@254", "@304", etc. — spot uses @N internal ids
  coinMeaning: string;
  px: number;
  sz: number;
  side: "A" | "B";
  time: string;            // ISO no TZ
  tid: number;
  oid: number;
  hash: string;
  fee: number;
  feeToken: string;        // can be the spot asset itself (e.g. "KNTQ"), USDC, etc.
  feeUsdc: number;         // **NEW vs perp Fill** — USDC-equivalent fee
  typeTrade: "spot";
  priorityGas: number | null;
}
```

**Divergences from swagger:**
- `total_count` on spot endpoints is misleading — appears to be the page length (5 when requesting `limit=5`), not a global count. Confirmed across `spot-baseline` and `spot-page2`.
- `next_cursor` and `has_more` are always `null` even when there are clearly more rows. Spot is offset-only.
- Spot fills include `feeUsdc` (not present on perp fills).
- Spot fills lack `isLiquidation`, `liquidationRole`, `liqMarkPx`, `liqMethod`, `liquidatedUser`, `notional`, `startPosition`, `dir`, `closedPnl`.

**SDK recommendations:**
- Use offset-based pagination for spot (`SpotIterator` increments offset by limit until empty page).
- Define `SpotFill` distinct from `Fill` — they are different enough that a discriminated union on `typeTrade` is the cleanest TS shape:
  ```ts
  type AnyFill = (Fill & { typeTrade: "perp" }) | (SpotFill & { typeTrade: "spot" });
  ```
- Ignore `total_count`/`has_more`/`next_cursor` for spot; surface a `hasMore` derived from `data.length === limit`.

Samples: `spot-baseline.json`, `spot-filter-coin-purr.json`, `spot-filter-side-b.json`, `spot-timewindow.json`, `spot-bad-coin.json`, `spot-page1.json`, `spot-page2.json`.

### GET /fills/spot/user/{user_address}

User used: `0x68d39be8c66851afbb61abb3b2e0a8ef59b58e80` (from spot baseline).

| Scenario        | Status | Time (s) | Notes                       |
| --------------- | ------ | -------- | --------------------------- |
| baseline        | 200    | 0.73     | shape identical to `/fills/spot/` items |
| `offset=5`      | 200    | 0.90     | offset pagination works     |
| bad addr        | **422** | 0.62    | pattern enforced            |

**Response item shape:** identical to `/fills/spot/` `SpotFill`.

**Divergences from swagger:** same as spot (`total_count` is page length, no cursor, no `has_more`).

**SDK recommendations:** reuse `SpotFill` type; expose `fills.spot.user(addr).iterate()` over offsets.

Samples: `spot-user-baseline.json`, `spot-user-page2.json`, `spot-user-bad-addr.json`.

## Open questions for the SDK author

1. **`total_count` semantics:** sometimes global count, sometimes null, sometimes 0, sometimes equal to page length on spot. Is there a documented invariant or should the SDK simply not expose it?
2. **Spot pagination:** cursor fields are returned `null` — is this intentional or a backlog item? If unsupported, the SDK should not advertise cursor pagination for spot.
3. **`tid` magnitude:** values already in the 10^14–10^15 range. Should the SDK transport `tid` (and possibly `oid`) as `bigint`/`string` to be future-proof?
4. **`time` timezone:** per-fill `time` lacks a TZ suffix while `/count`'s `timestamp` includes `+00:00`. Confirm all `time` values are UTC.
5. **Side encoding:** `"A"` vs `"B"` — confirm A=Ask=Sell and B=Bid=Buy (consistent with HL convention, but worth documenting).
6. **`coin` namespacing:** values seen include `"BTC"`, `"@107"`, `"@254"`, `"xyz:EWY"`, `"cash:MSFT"`, `"#250"`, `"+250"` (as `feeToken`). What is the canonical namespace list? Should the SDK provide a resolver to/from `coinMeaning`?
7. **Fill response not in OpenAPI:** the response shape is `data: any`. Should we PR the spec to add `Fill` / `SpotFill` schemas, or maintain types only in the SDK?
8. **`isLiquidation` as int vs bool:** swagger types it `integer`; values are 0/1. SDK should expose `boolean` for ergonomics — confirm `2`/other values never appear.
9. **`/fills/recent` 24h window:** confirmed by smaller `total_count`s but not documented in swagger summary. Worth stating in SDK docs that it's a hot-cache endpoint trading completeness for latency (~10x faster).
10. **Auth 401 plaintext body:** intentional? SDK currently has to special-case this for error mapping. A JSON envelope `{success:false,message:"..."}` would be cleaner.
