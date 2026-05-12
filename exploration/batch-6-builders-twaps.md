# Batch 6 — Builders + TWAPs

Base URL: `https://api.hypedexer.com` — auth via `X-API-Key` header. Raw samples in `samples/batch-6/`.

## Summary (key SDK takeaways)

- **Both subgroups use the `APIResponse<T>` envelope** (same family as batches 1/2/3): `{success, message, data, total_count, execution_time_ms, next_cursor, has_more}`. No new envelope. Three families still: `APIResponse<T>` (perp/spot/analytics/users/builders/twaps), bare (HIP-3), `Hip4Envelope` (HIP-4).
- **`data` is polymorphic across the same envelope** — sometimes a list (e.g. `/builders/list`, `/twaps/`, `/twaps/{id}/fills`), sometimes an object that wraps the list (e.g. `/builders/top` → `data: {timeframe, sort, builders[]}`), sometimes a pure object (e.g. `/builders/stats`, `/twaps/{id}` detail). SDK can't assume `data: T[]` per envelope; each endpoint needs its own `data` schema. See `data` row in the per-endpoint tables below.
- **Total count is exposed via `message` text, not `total_count`** for the list endpoints. `total_count` is null on every endpoint *except* `/twaps/{id}/fills` (where it equals the page size — likely the actual total since `12 fills` matched the message). Pagination clients must regex `^(\d+) (TWAPs found|builders found|TWAPs for user|fills for TWAP)` if they need total — fragile. Recommend SDK exposes both: `totalCount` (parsed best-effort from message) and the raw envelope.
- **Validation is mixed**: enum params are strict 422 on `timeframe` and `status`, limit bounds enforce 422 — BUT `/builders/top?sort=bogus` is **silent fallback** (returns 200, echoes `sort: "bogus"` in `data.sort`, and serves volume-sorted results). Same silent-sort pattern observed in batches 2/3. SDK should client-side guard the `sort` enum.
- **Unknown-builder behavior is non-erroring**: `GET /builders/0x0000...0001/stats` returns 200 with real (sparse) stats for that address — *any* valid 0x is treated as queryable. `builderName: null` is the only "this isn't a registered builder" signal. By contrast, `/twaps/{unknown_id}` returns **404 with `{detail: "TWAP 999999999 not found"}`** (FastAPI default error shape, not the envelope). SDK error layer must handle both `{detail: string}` and `{detail: [{type, loc, msg, ...}]}` from 404/422.
- **TWAP status enum from swagger is incomplete**. `byStatus` rows from `/twaps/stats` reveal real-world values: `"finished"`, `"terminated"`, `"activated"`, plus error-prefixed strings like `"error: Insufficient margin to place order."`, `"error: Reduce only order would increase position."`, `"error: Insufficient spot balance"`, `"error: Price too far from oracle"`. The query enum (`activated|finished|terminated|all`) cannot retrieve error-status TWAPs as a class. SDK should type `Twap.status` as `'activated' | 'finished' | 'terminated' | \`error: ${string}\`` and document this gap.
- **TWAP detail endpoint is a composite** of three sub-shapes — `{meta, events[], fills}` — not a list. `meta` is the same row shape as the list endpoint plus `executionPct`. `events[]` is a status transition log (`{eventTime, status, executedSz, executedNtl}`). `fills` is an *aggregate* summary (`{fillCount, totalNotional, totalSz, avgPx, minPx, maxPx, totalFees, totalBuilderFees, firstFill, lastFill}`), NOT a fill list. To get fill rows, use `/twaps/{id}/fills`.
- **`/twaps/{id}/fills` reuses the perp Fill shape from batch 1** (`{user, coin, coinMeaning, px, sz, side, time, hash, oid, tid, fee, feeToken, builderFee, notional, priorityGas}`) — no TWAP-specific id linkback inside the rows. The TWAP linkage is implicit (must be path-scoped). Note `hash` is the all-zero hash on these (TWAP fills are off-chain executions). SDK should share the `Fill` type across `/fills`, `/twaps/{id}/fills`, and presumably HIP-3/HIP-4 fills.
- **Date encoding**: TWAPs use `YYYY-MM-DDTHH:MM:SS[.ffffff]` ISO-8601 *naive* (no `Z`, no offset) — fractional microseconds present on `updatedAt`/`firstFill`/`lastFill`, absent on `startTime`. Same naive-ISO format as batches 1/3. **Sentinel `1970-01-01T00:00:00`** appears as `startTime` on some historical TWAPs (e.g. `twapId=1046442`, asc order) — SDK should treat epoch-zero as "unset" rather than a real timestamp.
- **Numeric encoding remains all-JSON-number** (no string decimals). `executedSz` is float, `totalVolume` is float, `executionPct` is float (`0–100`, not `0–1`). `variations.<*>Pct` can be `null` when previous value was 0 (e.g. `totalBuilderFeesPct: null` on the unknown-builder query). SDK percent type should allow null.
- **Coin field carries HIP-3 dex prefix** — values like `"flx:OIL"`, `"xyz:CL"`, `"xyz:GME"` show up in both `/builders/top` `coinBreakdown` and `/twaps/` rows. `coinMeaning` is duplicated alongside `coin` in fills (consistent with batches 1/4). HIP-4 `#NNN` outcomes were not observed here — likely TWAPs aren't supported on HIP-4 yet.
- **Response times**: 0.7–1.5s typical; `/twaps/stats` is slowest (~2.0s) due to grouping; first request to a new builder address can be cold (~4.4s once for `0x0000...0001/stats`).

## Cross-cutting observations

### Envelope shape

Identical to `APIResponse<T>` across all 11 endpoints. Keys observed: `success, message, data, total_count, execution_time_ms, next_cursor, has_more`. `next_cursor` and `has_more` are always `null` on this batch — TWAPs/builders use offset-only pagination. Error responses use FastAPI's `{detail}` shape (no envelope) — 404 returns `{detail: string}`, 422 returns `{detail: ValidationError[]}`.

### Pagination

- All list endpoints accept `limit` + `offset`. No cursor anywhere.
- Limit caps per endpoint:
  - `/builders/top`: 1–100 (422 above 100)
  - `/twaps/`: 1–500
  - `/twaps/user/{addr}`: 1–200
  - `/twaps/{id}/fills`: 1–1000
- `total_count` is null on every endpoint except `/twaps/{id}/fills` (=12 matched message "12 fills"). To paginate fully on the others the SDK must either (a) parse `message`, or (b) page until `data.length < limit`.

### Sort/order

- `/builders/top?sort=…` accepts `volume|fees|builder_fees|fills|users` but **silently accepts bogus values** (echoes in `data.sort`, falls back to volume).
- `/twaps/` and `/twaps/user/{addr}` accept `order=asc|desc`. `asc` ordering exposed epoch-zero sentinels at the front, suggesting the sort key is `startTime` not `twapId`.

### Date formats

- Naive ISO-8601: `2026-05-11T21:33:30` and `2026-05-11T21:33:30.243943`.
- Sentinel: `1970-01-01T00:00:00` for unset start times.
- No epoch-ms anywhere in these endpoints (unlike perp cursors in batch 1).

### Validation

| param | endpoint(s) | behavior |
|---|---|---|
| `timeframe=bogus` | builders | **422** (`Input should be '1h', '24h', '7d' or '30d'`) |
| `sort=bogus` | `/builders/top` | **silent fallback** to volume |
| `status=bogus` | twaps | **422** |
| `limit` out of bounds | all | **422** |
| unknown builder addr | `/builders/{addr}/stats` | **200** with `builderName: null` |
| unknown twap id | `/twaps/{id}` | **404** `{detail: "TWAP ... not found"}` |

## Per-endpoint

### Builders

#### 1. `GET /builders/top`

| Aspect | Value |
|---|---|
| Sample | `builders-top-24h.json`, `builders-top-7d-fees.json` |
| Status | 200, ~1.0–1.4s |
| `data` shape | object `{timeframe, sort, builders: Builder[]}` |
| `Builder` row | `{builder: string (0x), builderName: string\|null, fillCount: int, totalVolume: float, totalFees: float, totalBuilderFees: float, uniqueUsers: int, uniqueCoins: int}` |
| Quirks | `sort=bogus` → 200, silent fallback. `total_count` null. |

#### 2. `GET /builders/stats`

| Aspect | Value |
|---|---|
| Sample | `builders-stats-24h.json` |
| Status | 200, ~0.9s |
| `data` shape | object `{timeframe, current, previous, variations}` |
| `current`/`previous` | `{fillCount, totalVolume, totalFees, totalBuilderFees, uniqueBuilders, uniqueUsers, uniqueCoins}` |
| `variations` | `{fillCountPct, totalVolumePct, totalFeesPct, totalBuilderFeesPct, uniqueBuildersPct, uniqueUsersPct}` — floats, can be null when previous=0 |

#### 3. `GET /builders/stats/all-timeframes`

| Aspect | Value |
|---|---|
| Sample | `builders-stats-all-tf.json` |
| Status | 200, ~1.1s |
| `data` shape | object **keyed by timeframe**: `{"1h": {current, previous, variations}, "24h": {...}, "7d": {...}, "30d": {...}}` |
| Note | Same inner shape as `/builders/stats` minus the `timeframe` key. SDK can model as `Record<'1h'\|'24h'\|'7d'\|'30d', BuilderStatsBlock>`. |

#### 4. `GET /builders/{addr}/stats`

| Aspect | Value |
|---|---|
| Sample | `builder-stats-phantom.json`, `builder-stats-unknown.json` |
| Status | 200 even for unknown addr; first cold call ~4.4s |
| `data` shape | `{builder, builderName: string\|null, timeframe, current, previous, variations, coinBreakdown: CoinBreakdown[]}` |
| `current`/`previous` | same fields as global stats minus `uniqueBuilders` |
| `CoinBreakdown` | `{coin, coinMeaning, fillCount, totalVolume, totalFees, totalBuilderFees, uniqueUsers}` — HIP-3 prefix appears (`xyz:CL`) |

#### 5. `GET /builders/{addr}/users`

| Aspect | Value |
|---|---|
| Sample | `builder-users-phantom.json`, `builder-users-unknown.json` |
| Status | 200 |
| `data` shape | `{timeframe, builder, users: BuilderUser[]}` |
| `BuilderUser` | `{user: string (0x), fillCount, totalVolume, totalFees, totalBuilderFees, uniqueCoins}` |
| Note | No `builderName` echoed; only `builder` address. |

#### 6. `GET /builders/list`

| Aspect | Value |
|---|---|
| Sample | `builders-list.json` |
| Status | 200, ~1.1s, 640 builders returned in one call (no pagination params used or supported) |
| `data` shape | `BuilderEntry[]` — flat list |
| `BuilderEntry` | `{address: string, name: string\|null, referredBy: string\|null, referrerStage: 'ready'\|'needToTrade'\|'needToCreateCode'\|null}` |
| Findings | 422 of 640 have `name: null` (only ~34% are named). `referredBy` null means top-level builder. `referrerStage` enum has 4 values incl. null. |

### TWAPs

#### 7. `GET /twaps/`

| Aspect | Value |
|---|---|
| Sample | `twaps-baseline.json`, `twaps-status-finished.json`, `twaps-coin-btc.json` |
| Status | 200, ~1.0–2.0s |
| `data` shape | `Twap[]` |
| `Twap` row | `{twapId: int, status: string, coin: string, user: string (0x), side: 'A'\|'B', sz: float, executedSz: float, executedNtl: float, minutes: int, reduceOnly: bool, randomize: bool, startTime: ISO, updatedAt: ISO}` |
| `side` | `'A'` (ask/sell) or `'B'` (bid/buy) |
| `total_count` | null. Total in `message: "<N> TWAPs found"`. |

#### 8. `GET /twaps/stats`

| Aspect | Value |
|---|---|
| Sample | `twaps-stats.json`, `twaps-stats-btc-24h.json` |
| Status | 200, ~2.0s |
| `data` shape | `{hours: int, totalTwaps: int, totalExecutedNtl: float, byStatus: StatusBucket[], fills: FillSummary}` |
| `StatusBucket` | `{status, count, totalSz, executedSz, executedNtl, avgMinutes, uniqueUsers, uniqueCoins}` |
| `FillSummary` | `{count, volume, totalFees, uniqueUsers, uniqueTwaps}` |
| Finding | `byStatus` exposes **error-prefixed statuses** ("error: Insufficient margin to place order.", etc.) — undocumented enum members. |

#### 9. `GET /twaps/user/{addr}`

| Aspect | Value |
|---|---|
| Sample | `twaps-user.json`, `twaps-user-finished.json` |
| Status | 200 |
| `data` shape | `Twap[]` — note: same row minus `user` field, plus `executionPct: float` (0–100) |
| Limit cap | 200 |

#### 10. `GET /twaps/{twap_id}`

| Aspect | Value |
|---|---|
| Sample | `twap-detail-1811495.json`, `twap-detail-unknown.json` (404), `twap-detail-zero.json` (404) |
| Status | 200 / 404 `{detail: "TWAP <id> not found"}` |
| `data` shape | `{meta, events: TwapEvent[], fills: FillAggregate}` |
| `meta` | Twap row + `executionPct` |
| `TwapEvent` | `{eventTime: ISO, status, executedSz, executedNtl}` — status-transition log |
| `FillAggregate` | `{fillCount, totalNotional, totalSz, avgPx, minPx, maxPx, totalFees, totalBuilderFees, firstFill, lastFill}` — *aggregate only, not list* |

#### 11. `GET /twaps/{twap_id}/fills`

| Aspect | Value |
|---|---|
| Sample | `twap-fills-1811495.json` |
| Status | 200 |
| `data` shape | `Fill[]` — reuses **perp Fill shape from batch 1** |
| `Fill` row | `{user, coin, coinMeaning, px, sz, side, time, hash, oid, tid, fee, feeToken, builderFee, notional, priorityGas}` |
| `hash` | all-zero (`0x000...000`) — TWAP fills are off-chain |
| `total_count` | **populated** (12) — only endpoint in this batch where it works |
| Limit cap | 1000 |

## Open questions

- The `total_count` inconsistency: only `/twaps/{id}/fills` populates it. Bug or intentional? Could the SDK request a "count-only" mode via a special param? — none documented.
- `/builders/list` returned all 640 rows in one call with no pagination — is there a hard limit, or does it always return all? Worth retesting if the registry grows.
- `referrerStage` semantics — what triggers `needToTrade` vs `needToCreateCode`? Probably from the Hyperliquid referral state machine.
- Error-prefixed TWAP statuses: are these stored as-is in the DB, or generated at query time? If generated, the strings might change without notice — SDK shouldn't pattern-match on them.
- `coin` filter on `/twaps/` accepts plain `BTC` — does it accept HIP-3 prefixed coins like `xyz:CL`? Not tested.
- `/builders/{addr}/users` doesn't seem to expose pagination total or `executionPct`-like fields — and no `offset` was tested. Likely supports `limit` only per swagger.
