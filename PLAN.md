# `@hypedexer/sdk` — Architecture Plan

Source-of-truth document derived from the 9-batch API exploration (`exploration/batch-1` … `batch-9`). All design decisions below are anchored to a specific batch finding; no decision is speculative.

Companion documents:
- `TYPES.md` — full TypeScript type blueprint per resource.
- `ENDPOINTS.md` — endpoint inventory matrix (the implementation checklist).

---

## A. Executive summary

The hard facts about the API that drive every architectural decision:

1. **The API has three distinct response envelopes**, not one. `APIResponse<T>` for most endpoints, **bare** `T`/`T[]` for HIP-3 / funding / vaults, and the dedicated `Hip4Envelope` for HIP-4. The SDK cannot ship a single generic transport unwrapper. (batch-1 §APIResponse envelope, batch-4 §Envelope, batch-5 §Envelope, batch-7 §Envelope family)
2. **Two real pagination styles coexist.** Cursor `"<epoch_ms>:<tid>"` is only implemented on perp `/fills/*` and `/liquidations/*`; everything else is offset+limit. Spot fills *declare* cursor fields but always return `null` — they are offset-only in practice. (batch-1 §Pagination, batch-3 §Pagination, batch-4 §Pagination, batch-5 §Pagination)
3. **`total_count` is unreliable.** Sometimes the global count, sometimes the page size, sometimes 0, sometimes `null`. On HIP-3 / HIP-4 / TWAPs/builders it is *never* a real total. The SDK must not expose it as authoritative. (batch-1 §Quirks, batch-3 §APIResponse envelope, batch-6 §Cross-cutting)
4. **There are six distinct error shapes.** 401 plaintext (auth), 422 FastAPI `detail[]`, 404 FastAPI `{detail: string}`, 400 `/info` custom `{error: string}`, 500 ClickHouse leak text on `/spot/*`, and WS `{type:'error', message}`. A single `parseError()` dispatch is required. (batch-1, batch-7, batch-9)
5. **Spot REST is completely broken.** All four `/spot/*` endpoints return 500 with a ClickHouse stack trace; the same is true through `/info`. The only live spot data source is the WebSocket `fills_spot` channel. (batch-7 §Spot, batch-9 §POST /info)
6. **WebSocket auth subprotocol is broken upstream.** Server fails to echo `Sec-WebSocket-Protocol`, so strict clients (`ws`, browsers) reject the upgrade. Only header auth works from Node. Browser support is therefore degraded and must be flagged. (batch-9 §Handshake)
7. **WebSocket has no app-layer heartbeat** and is fronted by Cloudflare with a 100 s idle disconnect. The SDK must send WS-level pings every ~25–30 s. (batch-9 §Transport)
8. **WS server silently accepts bogus subscription types** and silently accepts non-JSON frames (the latter leaking Python tracebacks). Client must validate channel names against the welcome-frame allowlist. (batch-9 §Errors)
9. **Several enum query params silently fall back** instead of 422: `top-traders.sort`, `completed-trades.sort_by`, `builders/top.sort`, `hip3/leaderboard.by`, `hip4/markets.coin` filter, `evm/ledger/transfers.action_type`, `evm/bridge.event_type`. The SDK must client-side validate every enum. (batch-2 §Validation, batch-3 §Validation summary, batch-4 §Validation, batch-5 §Validation, batch-6 §Cross-cutting, batch-8 §Cross-cutting)
10. **Several "valid" responses are actually buggy data.** `/completed-trades/{id}/fills` has shifted keys (`feeUsdc: "perp"`, `typeTrade: <ISO>`), `/hip3/assets.asset_id` is always 0, `/hip3/ohlcv.volume`/`fees` are always 0, `/overview/coin-distribution.top_token_liquidated` ignores `coin` filter, `/liquidations/?order=asc` produces a year-2245 corrupt cursor, `/evm/transactions.tx_hash`/`from_addr` are empty strings, `gossip/leaderboard.address` is an IPv4 not a wallet, HIP-4 `description` is a pipe-delimited mini-format. The SDK normalizes some, refuses others, and documents the rest. (batch-2, batch-3, batch-4, batch-5, batch-8, batch-9)
11. **At least 7 distinct date encodings** are observed: ISO no-TZ µs, ISO no-TZ seconds, ISO `+00:00`, ISO `Z` seconds, ISO `Z` µs, bare `YYYY-MM-DD`, epoch-ms integer, and the HIP-4-specific compact `YYYYMMDD-HHMM` (for `expiry`). Sentinel `1970-01-01T00:00:00` marks "unset". Auto-parsing to `Date` invites TZ guesswork. (batch-1 §Date, batch-3 §Date inventory, batch-4 §Date, batch-5 §Date, batch-6 §Date, batch-7 §Time-unit map)
12. **Numeric encoding is mostly safe JS numbers**, with two real exceptions: funding `fundingRate`/`premium` are strings (`"-0.0000101097"`), and EVM `value_wei` / ledger `amount_raw` are strings. `tid` magnitudes reach 10^15, dangerously close to `Number.MAX_SAFE_INTEGER` — the SDK exposes `tid` as `number` today, with a documented future-bigint flag. (batch-1 §Numeric, batch-7 §Numeric, batch-8 §Numeric)
13. **Coin namespaces are not orthogonal.** `BTC` (perp), `@107` (spot), `xyz:EWY` (HIP-3, namespaced by dex_id), `#NNN` (HIP-4 outcome), `+NNN` (HIP-4 outcome-denominated fee token), and `""` (HIP-4 fallback outcome). A `parseCoin()` helper is mandatory. (batch-1 §Open Q6, batch-4 §Coin, batch-5 §Coin format)
14. **Limit caps vary per endpoint:** 1000 on `/fills/*`, 100 on `/users/*` and `/liquidations/*`, 500 on `/hip3/dexs` and `/twaps/`, 200 on `/twaps/user/*`, 1000 on `/hip4/fills`, 2000 on `/hip4/analytics`, 5000 on funding/vaults, 365 days on `/evm/stats/daily`. `/completed-trades/` has **no server cap** — the SDK must enforce one client-side or risk 70 MB / 48 s responses. (batch-1 §Per-endpoint, batch-3 §Per-endpoint, batch-4, batch-5, batch-6, batch-7, batch-8)
15. **`/info` is a thin dispatcher with its own quirks.** It maps to the same REST handlers but *wraps* `currentFundingRates` and `vaultList` in `APIResponse` even though their REST counterparts return bare arrays. So `/info` is not a 1:1 alias of REST — the envelope can differ. (batch-9 §POST /info)

These 15 facts gate every section that follows.

---

## B. Response envelope strategy

### B.1 The three envelope families (observed)

| Family | Shape | Endpoints |
|---|---|---|
| `APIResponse<T>` | `{success, message, data, total_count, execution_time_ms, next_cursor, has_more}` | perp `/fills/*`, `/analytics/*`, `/overview/*`, `/users/*`, `/completed-trades/*`, `/liquidations/*`, `/twaps/*`, `/builders/*`, `/evm/*`, gossip auction |
| Bare `T` / `T[]` | the model itself | `/hip3/*` (all), `/funding/*`, `/vaults/*` |
| `Hip4Envelope<T>` | `{status: 'live' \| 'not_yet_live', count, data, message?, testnet_docs?}` | `/hip4/*` (all) |

### B.2 `/info` adds a fourth wrinkle

`POST /info` (batch-9) re-wraps some bare-REST endpoints (`currentFundingRates`, `vaultList`) in `APIResponse<T>` while preserving the spot 500. So `client.info('vaultList')` returns a different *envelope* shape than `client.vaults.list()` despite querying the same underlying data.

### B.3 Decision: pass-through with discriminated metadata

The SDK does **not** force-normalize envelopes. Each resource method returns the canonical `data` payload directly (so `client.fills.list()` returns `Fill[]`, not `{data: Fill[], ...}`), and exposes envelope metadata via a sibling property on the return value:

```ts
interface Page<T> {
  data: T[]
  meta: {
    family: 'apiResponse' | 'bare' | 'hip4'
    message?: string             // server-supplied (APIResponse, Hip4)
    executionMs?: number          // from APIResponse
    totalCount?: number | null    // raw — see B.4
    nextCursor?: string | null    // when cursor pagination applies
    hasMore?: boolean | null
    status?: 'live' | 'not_yet_live'  // hip4 only
    testnetDocs?: string              // hip4 only
  }
}
```

Single-record endpoints (`fills.count()`, `users.overview(addr)`, `twaps.get(id)`, `vaults.details(addr)`, gossip status) return `{data: T, meta}` — same shape, scalar `data`.

**Why pass-through, not auto-normalize:** the envelopes carry signal the SDK cannot reliably synthesize. `Hip4Envelope.status === 'not_yet_live'` is materially different from `data: []` — collapsing it to a bare array hides the fact that the feature is gated, not empty. `next_cursor` only exists on certain `APIResponse<T>` endpoints; promoting it to all of them would be a lie. Pass-through with typed metadata is honest and lets the iterator helper (§D) do envelope-aware work without putting envelope ceremony in user code.

### B.4 `total_count` is `number | null`, never coerced

`total_count` is exposed raw. The SDK documents per-method whether it's meaningful (e.g. `liquidations.list({coin})` returns a real total; `liquidations.list()` returns null). It is *never* used internally for iterator termination.

---

## C. Error model

### C.1 Observed error shapes (final inventory)

| Source | Status | Body | Trigger |
|---|---|---|---|
| auth plaintext | 401 | `"missing api key"` / `"invalid api key"` | bad/no `X-API-Key` (batch-1) |
| FastAPI string detail | 404 | `{"detail":"Block N not found"}` | unknown resource (batch-4, batch-7, batch-8) |
| FastAPI array detail | 422 | `{"detail":[{type,loc,msg,input,ctx}]}` | param validation (batches 1–8) |
| `/info` custom | 400 | `{"error":"Unknown type: …"}` / `{"error":"JSON body required"}` | bad info dispatcher input (batch-9) |
| ClickHouse leak | 500 | plaintext stack | `/spot/*` REST + `/info` spot types (batch-7, batch-9) |
| CF timeout | 524 | HTML | `tradeList`, `twapList` via `/info` cold (batch-9) |
| WS error frame | n/a | `{"type":"error","message":"…"}` | bad method/raw frame (batch-9) |
| WS close codes | n/a | 1006, 1011, 4xx | handshake / disconnect (batch-9) |
| HTTP 429 on WS upgrade | 429 | plaintext | rapid reconnects (batch-9) |

### C.2 Exception hierarchy

```
HypedexerError                  (abstract base; carries .status?, .rawBody?)
├── AuthError                   (401)
├── ValidationError             (422 — exposes .detail[])
├── NotFoundError               (404)
├── RateLimitError              (429; also surfaces from WS upgrade)
├── ServerError                 (500/502/503/504/524 — surfaces ClickHouse text as .rawBody)
├── NetworkError                (fetch failure / abort / TLS / DNS)
└── WebSocketError              (.closeCode?, .reason?, subclasses below)
    ├── WSAuthError             (4xx-class handshake)
    ├── WSSubprotocolError      (1006 / "no subprotocol echoed")
    └── WSProtocolError         (server-sent {type:'error'}, raw-string handler)
```

Every error preserves:
- `status: number | undefined`
- `rawBody: string | object | undefined` — the original payload (plaintext or parsed JSON)
- `cause?: unknown` — the underlying `Error`, when applicable

`ValidationError` additionally exposes `detail: Array<{type, loc, msg, input?, ctx?}>` and a `.field(name)` helper that finds the first detail with `loc.includes(name)`.

### C.3 Error parser dispatch

```ts
function parseError(status: number, contentType: string, body: string): HypedexerError
```

Dispatch order:
1. `status === 401` → `AuthError(body)` (body is plaintext).
2. `status === 422` and `body` JSON with array `detail` → `ValidationError`.
3. `status === 404` and `body` JSON with string `detail` → `NotFoundError`.
4. `status === 400` and `body` JSON with `error` string → `ValidationError` (from `/info` dispatcher) with a normalized `.detail`.
5. `status === 429` → `RateLimitError`.
6. `status >= 500` → `ServerError(body)`. Body may be plaintext (spot ClickHouse) or HTML (CF 524).
7. Fallback → `NetworkError`.

WS errors are constructed inline by the WS client (`WSProtocolError` from `type:'error'` frames, `WSSubprotocolError` from 1006 + missing protocol header, `WSAuthError` from upgrade 401, `RateLimitError` from upgrade 429).

---

## D. Pagination strategy

### D.1 Observed styles

| Style | Endpoints |
|---|---|
| Cursor `"<epoch_ms>:<tid>"` (`next_cursor`+`has_more`) | `/fills/`, `/fills/recent`, `/fills/user/{addr}`, `/liquidations/`, `/liquidations/recent` |
| Offset + limit | every other list endpoint (~80% of the surface) |
| No total ever | HIP-3 (every endpoint), HIP-4 (every endpoint), TWAPs/builders list (except `/twaps/{id}/fills`) |
| Time-window (no offset) | `/funding/fundingHistory`, `/vaults/*Snapshots` — page by decrementing `endTime` to the oldest row's `time` |

### D.2 Public surface

Each list resource exposes two methods:

```ts
list(params): Promise<Page<Item>>
iterate(params): AsyncIterable<Item>
```

- `list()` returns one page + `meta` (see §B.3). For cursor endpoints `meta.nextCursor`/`meta.hasMore` are populated; for offset endpoints they are not but `data.length` vs `limit` is sufficient for the caller to derive "has more".
- `iterate()` is the universal lazy iterator. Internally it dispatches:
  - **Cursor-style**: `params.cursor = page.meta.nextCursor` until `meta.hasMore === false || meta.nextCursor == null`.
  - **Offset-style**: `params.offset += params.limit` until `page.data.length < params.limit`.
  - **Time-window-style** (funding, vaults): `params.endTime = oldest(page).time - 1` until `page.data.length === 0`.

The iterator hides which strategy is in play. Concrete pagination strategy is bound at the resource layer (a `PaginationKind` enum on each endpoint descriptor — see `ENDPOINTS.md`).

### D.3 Client-side caps

Per `ENDPOINTS.md`, every list method asserts `limit ≤ documented cap` at call time, throwing `ValidationError` before the network call. This is **load-bearing for `/completed-trades/`**, which has no server cap (batch-3): we hard-cap at 100 there.

### D.4 Cursor refusal: `/liquidations/?order=asc`

Per batch-3: `order=asc` produces `"20911751377956:0"` (year 2245) and stalls deep paging. `liquidations.list({order: 'asc'})` is accepted on the first page only; `iterate({order: 'asc'})` throws a `ValidationError` immediately documenting the upstream bug. `order: 'desc'` (the default) works correctly.

### D.5 Spot cursor lie

`/fills/spot/*` returns `next_cursor: null, has_more: null` even when more rows exist (batch-1). The SDK ignores those fields entirely for spot and treats `total_count` as page size, deriving `hasMore = data.length === limit`.

---

## E. Date/time strategy

### E.1 Full inventory of observed encodings

| # | Encoding | Example | Where |
|---|---|---|---|
| 1 | ISO no TZ, µs | `2026-05-11T15:22:49.398000` | fills `time`, users, completed-trades, hip3 µs fields |
| 2 | ISO no TZ, seconds | `2026-05-11T15:46:11` | liquidations `time`, hip3 sec fields, evm core |
| 3 | ISO with `+00:00`, µs | `2026-05-11T15:24:14.018991+00:00` | `/fills/count.data.timestamp` |
| 4 | ISO with `Z`, seconds | `2026-05-11T14:40:32Z` | analytics stats `time_range` |
| 5 | ISO with `Z`, µs | `2026-05-10T15:40:43.737038Z` | liquidations stats `time_range`, hip3 `auction_end_at` |
| 6 | Bare `YYYY-MM-DD` | `2026-05-02` | daily series (volume, pnl, prio-chart, fees `date`, vault `day`, evm `stats/daily.day`) |
| 7 | Epoch ms (integer) | `1778521680500` | funding `time`, vault `time`/`createTime`/`snapshotTime`, liquidation `time_ms`, hip4 fill `time_ms` |
| 8 | HIP-4 compact `YYYYMMDD-HHMM` | `20260512-0600` | HIP-4 outcome `expiry` |
| 9 | Sentinel | `1970-01-01T00:00:00` | "unset" — user.last_activity when no fills, TWAP startTime on stale |

### E.2 Decision: keep response timestamps as raw strings; expose typed accessors

Auto-parsing every field to `Date` invites three real bugs: (a) naive ISO #1 and #2 lose TZ information unless we assume UTC (defensible per cross-batch evidence but not promised by the API), (b) bare `YYYY-MM-DD` #6 collapses to a midnight-local or midnight-UTC `Date` and downstream charting libraries disagree, (c) the sentinel #9 silently becomes `new Date('1970-01-01T00:00:00')` which compares equal to a legitimate epoch-0 value.

The SDK therefore:
1. Response fields retain their raw string/number representation on the typed object (`time: string` or `time_ms: number` per endpoint).
2. A `time()` helper on every record returns `Date | null`. Sentinel `1970-01-01T00:00:00` and `0` map to `null`. Epoch-ms is treated as ms-since-epoch. Naive ISO (formats #1, #2) is treated as **UTC** (documented; matches every cross-check from `+00:00`/`Z`-suffixed counterparts of the same fields). `YYYY-MM-DD` (format #6) maps to UTC midnight. Format #8 (HIP-4 compact) gets a dedicated parser `parseHip4Expiry(s): Date | null`.
3. A single internal `parseTimestamp(value: string | number, mode: 'iso' | 'epochMs' | 'date' | 'hip4Expiry')` does the work, dispatched per endpoint.

Rationale: zero foot-guns for users who just want a string for display, opt-in `Date` for users who need to compute, and per-endpoint `mode` choice in the SDK rather than format-sniffing per value.

### E.3 Request-time inputs: accept `Date | number | string`, emit per-endpoint shape

Time-window REQUEST params are even more inconsistent than responses:

| Param style | Endpoints |
|---|---|
| `start_time` / `end_time` ISO snake_case | fills, analytics, users, completed-trades, liquidations, evm (ISO with `Z` works; epoch-ms is silently ignored on evm per batch-8) |
| `startTime` / `endTime` epoch-ms camelCase | funding, vaults |
| `start` / `end` ISO (sometimes epoch-ms accepted) | hip3, hip4, twaps |

The SDK input layer accepts `Date | number | string` on every time field; an internal `encodeTime(value, target: 'isoSnake' | 'epochCamel' | 'isoBare')` emits the right wire shape per endpoint, configured by the endpoint descriptor in `ENDPOINTS.md`.

---

## F. Numeric encoding strategy

### F.1 Defaults

- All numeric fields default to TypeScript `number`. This is correct for every aggregate, price, size, fee, gas, block_number, nonce-as-int53, and tid (today; see F.3).

### F.2 Strings (kept as string)

- `fundingRate`, `premium` on `/funding/*` and on `/info currentFundingRates` (batch-7, batch-9) — preserve precision per Hyperliquid convention.
- `value_wei` on `/evm/transactions` (batch-8) — bigint-class.
- `amount_raw` on `/evm/ledger/transfers` and `/evm/user/{addr}/ledger-events` (batch-8) — bigint-class.

The SDK ships a `Wei` opaque-string type alias (`Wei = string & { __wei: true }`) and two helpers:

```ts
function toBigInt(value: Wei | string): bigint
function toNumber(value: Wei | string): number   // throws if loss-of-precision
```

Funding rates are typed as `string` (not `Wei`) and the SDK exposes `parseFundingRate(s): number` and `parseFundingRate(s, mode: 'bigDecimal'): BigDecimal` (the latter punted to v0.2; v0.1 returns `number`).

### F.3 `tid` and other large integers

`tid` reaches ~10^15 (batch-1), still safely under `Number.MAX_SAFE_INTEGER` (~9.007 × 10^15). The SDK exposes `tid: number` in v0.1 but documents the safety margin. A future `client.experimental.bigintIds = true` flag is reserved for when the API team confirms `tid` will eventually exceed 2^53; until then, switching transport types would be churn for zero current benefit.

`oid` magnitudes are well below `tid`. Same treatment.

EVM `nonce` reaches `1778535277015000` (~1.78 × 10^15) per batch-8 — still safe, same documented note.

### F.4 Booleans encoded as `0 | 1`

`isLiquidation`, `is_system_tx`, `success` (on `/evm/transactions`), `is_liquidation` (hip3 fills), `crossed`, `settled` (hip4): all integer 0/1. SDK transforms to `boolean` at the response boundary; raw value is not preserved (no observed `2`/`null`/`null` case across batches).

---

## G. Coin namespace handling

### G.1 Observed namespaces

| Form | Where | Meaning |
|---|---|---|
| `BTC` | perp fills | bare perp coin |
| `@107` | spot fills, hip4 outcome-token | spot index reference |
| `xyz:EWY`, `cash:MSFT`, `km:BTC`, etc. | hip3 everywhere, twaps coin filter, perp fills (mixed) | `<dex_id>:<TICKER>` |
| `#NNN` | hip4 outcomes/fills | outcome token id |
| `+NNN` | hip4 fills `feeToken` | outcome-denominated fee token |
| `""` (empty string) | hip4 fallback outcomes (`outcome_id: 0`) | meta/aggregate row |
| `coinMeaning` (parallel field) | perp/spot fills, completed-trades-fills, builders coin-breakdown | resolved human name, e.g. `@107 → HYPE` |

### G.2 Decision: `Coin = string`, plus a parser helper

```ts
type Coin = string

type ParsedCoin =
  | { kind: 'perp'; ticker: string }                              // "BTC"
  | { kind: 'spot'; index: number }                               // "@107"
  | { kind: 'hip3'; dex: string; ticker: string }                 // "xyz:EWY"
  | { kind: 'hip4-outcome'; outcomeId: number }                   // "#290"
  | { kind: 'hip4-outcome-fee'; outcomeId: number }               // "+290"
  | { kind: 'hip4-fallback' }                                     // ""
  | { kind: 'unknown'; raw: string }

function parseCoin(coin: Coin): ParsedCoin
function formatCoin(parsed: ParsedCoin): Coin   // inverse, for filter building
```

`parseCoin` is dispatch-by-prefix: `''` → `hip4-fallback`; `'@'` → spot; `'#'` → hip4-outcome; `'+'` → hip4-outcome-fee; contains `:` → hip3; otherwise → perp. Future namespaces fall to `unknown` so callers can detect drift.

`Coin` remains a plain `string` so users can pass literals without ceremony.

---

## H. WebSocket strategy

### H.1 Confirmed channels (batch-9 welcome frame)

```
completed_trades, fills_spot, recent_activity, liquidation, hip4_events
```

Note: `liquidation` is singular. `recent_activity` is a multiplexed firehose where each item has a `stream` discriminator (observed values: `completed_trades`, `fills_spot`).

### H.2 Auth and transport

- Server: header auth only (`X-API-Key` or `Authorization: Bearer`). Subprotocol auth (`Sec-WebSocket-Protocol: apikey.<key>`) is the only browser-usable form but is broken upstream (server doesn't echo back the protocol → `ws` / browser clients abort with 1006).
- Decision: SDK ships a Node-first WS client. A `transport: 'browser'` option **throws on construction** with a clear message until the server fix is shipped. (This avoids silent 1006 failures that look like network noise.)
- 429 on rapid handshake retries → `RateLimitError`; the connect loop respects `Retry-After` if present, else backs off 5 s.

### H.3 Heartbeat and reconnect

- WS-level ping every 25 s (Cloudflare disconnects at ~100 s idle).
- Reconnect exponential backoff: 1 s → 2 s → 4 s → 8 s → 16 s, capped at 60 s. Reset to 1 s after a connection stays open >60 s.
- Close codes 1006 (transient) and 1011 (server-side handler error, observed on graceful close) are treated as retryable. 4xxx codes (auth) surface as `WSAuthError` and stop the loop.

### H.4 Client-side subscription allowlist

Server silently accepts bogus channels (`not_a_real_channel` → `subscription_added`). The SDK ships a frozen `KNOWN_CHANNELS` set (the welcome list) and rejects subscribe calls to anything not in it with `ValidationError`. The welcome frame is parsed on connect to detect drift; if a new channel appears, a console warning is emitted (still accepted client-side so users aren't blocked).

### H.5 Subscription resync on reconnect

Client-side `Map<string, Subscription>` keyed by `${type}|user=${user ?? '*'}`. On every reopen, all stored subscribes are replayed before the resolve. Unsubscribe removes from the map.

### H.6 Message shape and typed dispatcher

Wire shape (batch-9):

```ts
type Push = { type: ChannelName; count: number; data: unknown[] }
type Control =
  | { type: 'welcome'; available_methods: string[]; available_subscriptions: string[] }
  | { type: 'subscriptions_list'; active_subscriptions: string[] }
  | { type: 'subscription_added'; subscription: { type: string; user?: string }; active_subscriptions: string[] }
  | { type: 'subscription_removed'; subscription: { type: string }; active_subscriptions: string[] }
  | { type: 'error'; message: string }
```

Note: WS push shape is **not** the REST envelope. The SDK normalizes it to `{channel, count, items}` and per-channel narrows `items` to the right element type (reusing `Fill`, `CompletedTradeFill`, `Liquidation`, `Hip4Event`).

Public surface:

```ts
client.ws.connect(): Promise<void>
client.ws.disconnect(): Promise<void>
client.ws.on('completed_trades', (msg: WSCompletedTradesMessage) => void)
client.ws.on('fills_spot',       (msg: WSFillsSpotMessage) => void)
client.ws.on('liquidation',      (msg: WSLiquidationMessage) => void)
client.ws.on('hip4_events',      (msg: WSHip4EventsMessage) => void)
client.ws.on('recent_activity',  (msg: WSRecentActivityMessage) => void)
client.ws.subscribe('completed_trades', { user?: Address })
client.ws.unsubscribe('completed_trades', { user?: Address })
client.ws.listSubscriptions(): Promise<string[]>
client.ws.on('error', (e: WebSocketError) => void)
client.ws.on('reconnect', (info: { attempt: number }) => void)
```

### H.7 `fills_spot` is the only spot data source

Per batch-7 / batch-9, all `/spot/*` REST + `/info` spot types return 500. The SDK documents `fills_spot` as the canonical spot path. `client.spot.fills.*` REST methods are present, typed, and immediately throw `ServerError` until the upstream ClickHouse breakage is fixed.

---

## I. Known API bugs / gotchas (SDK must defend or document)

Inventory consolidated across batches, with the SDK's posture:

| # | Bug | Batch | SDK posture |
|---|---|---|---|
| 1 | `/spot/*` REST returns 500 ClickHouse | 7, 9 | Methods throw `ServerError` immediately on call (no network round-trip wasted). Recommend `client.ws.subscribe('fills_spot')` in error message. |
| 2 | `/completed-trades/` has no server `limit` cap | 3 | Hard-cap at 100 client-side; reject larger with `ValidationError`. |
| 3 | `/completed-trades/{id}/fills` has shifted keys (`feeUsdc: "perp"`, `typeTrade: <ISO>`) | 3 | Drop these two fields from the typed model. Re-expose as `tradeType: 'perp'` (constant for now) and *omit* feeUsdc until backend fix. |
| 4 | `/liquidations/?order=asc` corrupt cursor | 3 | `iterate({order: 'asc'})` throws. `list({order: 'asc'})` accepts (first page only). |
| 5 | Silent enum fallbacks: `top-traders.sort`, `completed-trades.sort_by`, `builders/top.sort`, `hip3/leaderboard.by`, `hip4/markets.coin` filter, `evm/ledger/transfers.action_type`, `evm/bridge.event_type`, WS subscription type | 2, 3, 4, 5, 6, 8, 9 | All enums validated client-side against frozen typed unions; throw `ValidationError` before sending. |
| 6 | `/hip3/assets.asset_id` is always 0 | 4 | Type as `assetId: number` but document "currently always 0; do not use as a join key". |
| 7 | `/hip3/ohlcv.volume`/`fees` always 0 | 4 | Document in JSDoc; pass-through. |
| 8 | `/overview/coin-distribution.top_token_liquidated` ignores `coin` filter | 2 | Document; no SDK fix. |
| 9 | `gossip/leaderboard.address` is an IPv4 not a wallet | 2, 9 | Rename to `nodeIp: string` in the typed model; provide raw `address` only on the raw-pass-through escape hatch. |
| 10 | `/evm/transactions.tx_hash` and `from_addr` are empty strings | 8 | Type as `string` but document empty-string semantics; expose `txKey: \`${blockNumber}:${txIndex}\`` derived field. |
| 11 | `/info` wraps `currentFundingRates` and `vaultList` in `APIResponse` but the REST counterparts are bare | 9 | When using `client.info({type: 'currentFundingRates'})`, unwrap to match `client.funding.current()` return type. The `info` method dispatches to the same handler internally for these two types. |
| 12 | HIP-4 `description` is pipe-delimited (`class:priceBinary\|underlying:BTC\|expiry:20260512-0600\|targetPrice:80813\|period:1d`) | 5 | Ship `parseHip4Description(s): {class?, underlying?, expiry?, targetPrice?, priceThresholds?, period?}` and expose pre-parsed accessors on `Question` / `Outcome`. |
| 13 | TWAP status enum incomplete — real values include `"error: Insufficient margin to place order."`, `"error: …"` strings | 6 | Type as `'activated' \| 'finished' \| 'terminated' \| \`error: ${string}\``. |
| 14 | `users/{addr}/overview` returns 200 + zeroed sentinel for bad address (no 422) | 3 | SDK validates address pattern client-side before sending. Same on `/overview/coin-distribution`. |
| 15 | `/completed-trades/<bogus>/fills` returns 200 empty (no 404) | 3 | Document; do not synthesize 404. |
| 16 | `total_count` semantics inconsistent (page size vs global vs null) | all | Pass through raw; never used internally. |
| 17 | `last_activity = "1970-01-01T00:00:00"` and TWAP `startTime` sentinel | 3, 6 | `time()` helper returns `null` for sentinel. |
| 18 | WS server silently accepts bogus subscriptions and crashes on raw-string frames | 9 | Client allowlist; SDK never sends non-JSON. |
| 19 | WS subprotocol echo broken → browsers can't connect | 9 | `transport: 'browser'` throws on construction. |
| 20 | WS graceful close returns `1011 /origin` instead of `1000` | 9 | Reconnect logic classifies 1011 as transient. |
| 21 | `/evm/transactions` `epoch_ms` silently accepted (ignored) on time filter | 8 | Always emit ISO `Z` on evm endpoints. |
| 22 | `hip4/markets?coin=` silently ignored (filter is `outcome_id`) | 5 | SDK doesn't expose `coin` filter on this method; only `outcomeId`. |
| 23 | `users/leaderboard` returns polymorphic `data[]` keyed on `by` | 3 | Discriminated union; one method per `by`. |
| 24 | `vaultDetails.portfolio[]` is leader-commission history, not positions | 7 | Rename to `leaderCommissionHistory` in the typed model. |
| 25 | `vaultLedger` rows: deposit/withdraw determined by `userTo === vaultAddress` | 7 | Synthesize `kind: 'deposit' \| 'withdraw'` field. |

---

## J. Package layout

Mimics `@usdh-kit/sdk`: ESM-first dual cjs/esm, tsup, biome, vitest, zero runtime deps (just one optional `ws` for Node WebSocket; browsers use native `WebSocket`).

```
hypedexer-sdk/
├── package.json                 # name: @hypedexer/sdk, type: module, dual exports
├── tsconfig.json                # extends ../../tsconfig.base.json (matches usdh-kit)
├── tsup.config.ts               # entry: src/index.ts, format: [esm, cjs], dts, treeshake safest
├── biome.json                   # match usdh-kit
├── vitest.config.ts             # node, no jsdom
├── README.md
└── src/
    ├── index.ts                 # public re-exports only
    ├── client.ts                # createClient() factory, top-level facade
    ├── errors.ts                # HypedexerError + subclasses (see C.2)
    ├── transport/
    │   ├── http.ts              # fetch-based, applies API key, dispatches parseError on non-2xx
    │   ├── envelopes.ts         # unwrap APIResponse / Hip4Envelope / bare per descriptor
    │   ├── error-parser.ts      # the parseError() function from C.3
    │   ├── pagination.ts        # iterate() universal helper for cursor/offset/time-window
    │   ├── time.ts              # parseTimestamp, encodeTime, parseHip4Expiry
    │   ├── coin.ts              # parseCoin, formatCoin
    │   ├── numbers.ts           # toBigInt, toNumber, parseFundingRate
    │   └── ws.ts                # WSClient class (connect, reconnect, heartbeat, dispatcher)
    ├── resources/
    │   ├── fills.ts             # /fills/, /fills/recent, /fills/user, /fills/count, /fills/spot/*
    │   ├── analytics.ts         # /analytics/*
    │   ├── overview.ts          # /overview/*
    │   ├── users.ts             # /users/{addr}/*, /users/leaderboard (polymorphic), /users/active
    │   ├── completed-trades.ts  # /completed-trades/, /summary, /{id}/fills
    │   ├── liquidations.ts      # /liquidations/, /recent
    │   ├── hip3.ts              # /hip3/* (bare envelope)
    │   ├── hip4.ts              # /hip4/* (Hip4Envelope) + parseHip4Description
    │   ├── builders.ts          # /builders/*
    │   ├── twaps.ts             # /twaps/* + status union with error-prefix template literal
    │   ├── funding.ts           # /funding/* (bare envelope)
    │   ├── vaults.ts            # /vaults/* (bare envelope) + leaderCommissionHistory rename
    │   ├── spot.ts              # /spot/* — stubs that throw ServerError today
    │   ├── evm.ts               # /evm/*  (16 endpoints)
    │   ├── priority-fees.ts     # /hip3/priority-fees/gossip/*  (status, history, dedupedHistory)
    │   └── info.ts              # POST /info dispatcher (discriminated union)
    ├── types/
    │   ├── common.ts            # Address, Coin, Hex, Wei, Page<T>, Meta, Side, FillBase
    │   ├── fill.ts              # Fill, SpotFill, AnyFill (discriminated on typeTrade)
    │   ├── trade.ts             # Trade, TradesSummary, TradeFill (sanitized)
    │   ├── liquidation.ts
    │   ├── hip3.ts              # DexRegistry, AssetConfig, Auction, AuctionHistory, LiveSnapshot, OhlcvBar, OracleStats1m, Hip3Fill, TraderStats, LeaderboardEntry, UserHip3Overview, UserCoinStats
    │   ├── hip4.ts              # Hip4Envelope, Outcome, Question, OutcomeToken, Hip4Fill, Hip4Fee, Settlement, Hip4Analytics, ParsedDescription
    │   ├── builder.ts
    │   ├── twap.ts              # TwapStatus = 'activated'|'finished'|'terminated'|`error: ${string}`
    │   ├── funding.ts
    │   ├── vault.ts             # VaultSummary, VaultDetails, VaultDailySnapshot, VaultEquitySnapshot, VaultLedgerTx
    │   ├── evm.ts
    │   ├── analytics.ts         # FillsStatsData, PriorityFeesStatsData, LiquidationsStatsData, KpiCard<T>, GossipLeaderboardEntry (nodeIp)
    │   ├── info.ts              # InfoRequest union, type-to-return map
    │   └── ws.ts                # WSChannel union, WSMessage<C>, control + push types
    └── internal/
        ├── address.ts           # eth-address regex + normalizeAddress
        ├── url.ts               # safe path-segment encoding (handles `trade_<coin>_<hex>` with `:`)
        └── assert.ts            # small invariant helpers, replaces zod for v0.1
```

Notes on the layout:
- One file per resource. No barrel files inside `resources/` — `index.ts` re-exports each named export individually (per usdh-kit convention).
- `transport/` is the cross-cutting layer. `resources/` is endpoint surface. `types/` is pure declarations.
- No `zod` / `valibot` runtime dependency in v0.1; lightweight assertion helpers in `internal/assert.ts`. Justified by usdh-kit's "zero runtime deps where possible" line.
- `ws` is an **optional peer dep** in `package.json` (peerDependenciesMeta.ws.optional = true). Browser builds use the global `WebSocket`. Node uses `import('ws')` lazily inside `transport/ws.ts`.

---

## K. Public API surface (DX preview)

```ts
import { createClient, parseCoin, parseHip4Description } from '@hypedexer/sdk'
import { ValidationError, ServerError, RateLimitError, WSAuthError } from '@hypedexer/sdk'

// 1. Construct
const hp = createClient({
  apiKey: process.env.HYPEDEXER_API_KEY!,
  baseUrl: 'https://api.hypedexer.com',     // optional
  fetch: globalThis.fetch,                  // optional override
  timeoutMs: 30_000,                        // default 30s
  // transport: 'node' | 'browser' (default: 'node')
})

// 2. APIResponse envelope — fills (cursor pagination)
const page = await hp.fills.list({ coin: 'BTC', limit: 100 })
//    ^? Page<Fill>
page.data[0].px           // number
page.data[0].time         // string (ISO no TZ)
page.data[0].coin         // "BTC"
page.meta.nextCursor      // "1778513002104:444284598976375" | null
page.meta.hasMore         // true | false

for await (const fill of hp.fills.iterate({ coin: 'BTC', limit: 100 })) {
  console.log(fill.tid, fill.px)
}

// 3. Single record
const { data: count } = await hp.fills.count()
//             ^? { count: number; timestamp: string; execution_time_ms: number }

// 4. Spot fills — only via WebSocket today (REST throws)
try {
  await hp.spot.fills.list()
} catch (e) {
  if (e instanceof ServerError) {
    console.log('Spot REST is down; subscribe to ws fills_spot instead.')
  }
}

// 5. Bare envelope — HIP-3
const dexs = await hp.hip3.dexs.list({ limit: 10 })
//    ^? Page<DexRegistry>          (data is bare upstream; SDK still wraps in Page)
const overview = await hp.hip3.overview()
//    ^? { data: Hip3Overview, meta: {...} }

// 6. Hip4Envelope — also wrapped in Page<T>; meta.status surfaces 'not_yet_live'
const feeScales = await hp.hip4.feeScales.list()
if (feeScales.meta.status === 'not_yet_live') {
  console.log(feeScales.meta.message, feeScales.meta.testnetDocs)
}

// 7. Hip4 description parser
const q = (await hp.hip4.questions.list({ limit: 1 })).data[0]
const parsed = parseHip4Description(q.description)
parsed.underlying   // "BTC"
parsed.expiry       // Date | null (decoded from YYYYMMDD-HHMM)

// 8. Time inputs — Date | number | string all accepted
await hp.liquidations.list({
  startTime: new Date('2026-05-10'),
  endTime: Date.now(),
  coin: 'ETH',
})

// 9. Cursor refusal: ascending iterate on liquidations
try {
  for await (const _ of hp.liquidations.iterate({ order: 'asc' })) { /* ... */ }
} catch (e) {
  if (e instanceof ValidationError) {
    e.detail[0].msg   // "order=asc cannot be paginated: upstream cursor is corrupt for old rows"
  }
}

// 10. Polymorphic leaderboard — discriminated union
const lbVolume = await hp.users.leaderboard({ by: 'volume', limit: 10 })
//    ^? Page<LeaderboardByVolume>
const lbPnl = await hp.users.leaderboard({ by: 'pnl' })
//    ^? Page<LeaderboardByPnl>     // type narrows on by

// 11. Funding — string-encoded rates
const rates = await hp.funding.predicted()
//    ^? Page<FundingRate>
const r = rates.data.find(x => x.coin === 'BTC')!
r.fundingRate            // "0.0000125" (string)
parseFundingRate(r.fundingRate)   // 0.0000125 (number)

// 12. Wei strings
const txs = await hp.evm.transactions.list({ limit: 5 })
const tx = txs.data[0]
tx.valueWei              // "1000000000000000000" (string)
toBigInt(tx.valueWei)    // 1000000000000000000n
tx.txHash                // "" — known empty per batch-8
tx.fromAddr              // "" — known empty per batch-8
tx.txKey                 // "34849600:0" derived

// 13. Coin parsing
parseCoin('BTC')         // { kind: 'perp', ticker: 'BTC' }
parseCoin('@107')        // { kind: 'spot', index: 107 }
parseCoin('xyz:EWY')     // { kind: 'hip3', dex: 'xyz', ticker: 'EWY' }
parseCoin('#290')        // { kind: 'hip4-outcome', outcomeId: 290 }
parseCoin('+290')        // { kind: 'hip4-outcome-fee', outcomeId: 290 }
parseCoin('')            // { kind: 'hip4-fallback' }

// 14. Time helper on response records
const fill = (await hp.fills.recent({ limit: 1 })).data[0]
fill.time                // "2026-05-11T15:22:49.398000" (string)
fill.time$               // Date(2026-05-11T15:22:49.398Z)  — `$` suffix for typed getter, opt-in

// 15. Error handling
try {
  await hp.users.overview('0x123' as Address)   // pattern-fails client-side
} catch (e) {
  if (e instanceof ValidationError) e.detail[0].msg
}

// 16. /info dispatcher (escape hatch)
const r2 = await hp.info({ type: 'currentFundingRates' })
//    ^? FundingRate[]  — SDK unwraps the APIResponse wrap that /info applies, to match REST

// 17. WebSocket
await hp.ws.connect()
hp.ws.on('completed_trades', (msg) => {
  msg.channel              // 'completed_trades'
  msg.count                // number
  msg.items.forEach(item => console.log(item.coin, item.px))
})
hp.ws.on('fills_spot', (msg) => {
  msg.items[0].coinMeaning   // resolved name
})
hp.ws.on('recent_activity', (msg) => {
  for (const it of msg.items) {
    if (it.stream === 'completed_trades') {
      // narrowed to CompletedTradeItem
    }
  }
})
await hp.ws.subscribe('completed_trades', { user: '0xcee1...' })
await hp.ws.subscribe('liquidation')

// 18. WS error/reconnect events
hp.ws.on('error', (e) => {
  if (e instanceof WSAuthError) {
    /* won't retry */
  } else if (e instanceof RateLimitError) {
    /* 429 on upgrade */
  }
})
hp.ws.on('reconnect', ({ attempt }) => {
  console.log('reconnect attempt', attempt)
})

// 19. Builders — polymorphic data shape
const top = await hp.builders.top({ timeframe: '24h', sort: 'volume', limit: 10 })
top.data.timeframe         // "24h"
top.data.builders[0].builderName    // string | null

// 20. TWAP detail composite
const twap = await hp.twaps.get(1811495)
twap.data.meta.executionPct        // 0..100
twap.data.events[0].status         // string (incl. error: prefix)
twap.data.fills.fillCount          // FillAggregate

// 21. TWAP status union covers error-prefixed strings
const tw = twap.data.meta
if (tw.status.startsWith('error:')) {
  console.log('twap failed:', tw.status)
}

// 22. Daily-volume vs daily-pnl asymmetry
const dv = await hp.overview.dailyVolume10d({ user: '0xf5d8...' })
//   ^? Page<{ date: string; volume: number }>
const dp = await hp.overview.dailyPnl10d()
//   ^? Page<{ date: string; coin: Coin; pnl: number }>

// 23. Gossip leaderboard — IPv4 not wallet
const gossip = await hp.priorityFees.gossipLeaderboard({ limit: 10 })
gossip.data[0].nodeIp        // "54.64.2.87"   (renamed from address)

// 24. Vault helpers
const vaultTxs = await hp.vaults.ledger({ vaultAddress: '0xdf...' })
vaultTxs.data[0].kind         // 'deposit' | 'withdraw' (synthesized)

// 25. Time-window iteration for vault snapshots
for await (const snap of hp.vaults.equitySnapshots.iterate({ vaultAddress: '0xdf...' })) {
  // SDK pages by decrementing endTime under the hood
}

// 26. KPI cards — generic variation envelope
const at = await hp.overview.activeTraders24h()
at.data.value           // number
at.data.variationPct    // number

// 27. EVM block transactions
const block = await hp.evm.blocks.get(34849600)
const blockTxs = await hp.evm.blocks.transactions(34849600)

// 28. Hip3 backstop
const health = await hp.evm.hip3.backstop.health.list()
const km = await hp.evm.hip3.backstop.health.get('km')

// 29. Multiple WS subscriptions, then list
await hp.ws.subscribe('liquidation')
await hp.ws.subscribe('hip4_events')
const active = await hp.ws.listSubscriptions()

// 30. Graceful shutdown
await hp.ws.disconnect()
```

---

## L. Implementation roadmap

Each step is ~1–3 h. Acceptance criteria are explicit.

1. **Scaffold package.** Copy `@usdh-kit/sdk` `package.json` / `tsconfig.json` / `tsup.config.ts` / `biome.json` / `vitest.config.ts`. Rename to `@hypedexer/sdk`. Add `ws` as optional peer dep. *Accepts: `pnpm build` produces `dist/index.js` (ESM) + `dist/index.cjs` + `dist/index.d.ts` from an empty `src/index.ts`.*
2. **Error hierarchy (`src/errors.ts`).** Implement `HypedexerError` + 8 subclasses (§C.2). *Accepts: unit tests construct each class with status + rawBody and verify `instanceof` chains.*
3. **Error parser (`src/transport/error-parser.ts`).** Dispatch per §C.3. *Accepts: 6 unit tests covering 401 plaintext, 422 array detail, 404 string detail, 400 `/info` `{error}`, 500 ClickHouse plaintext, 524 HTML.*
4. **HTTP transport (`src/transport/http.ts`).** `request(method, path, params?, body?)` with `X-API-Key`, AbortController timeout, JSON / plaintext decoding, error dispatch. *Accepts: integration test against `/fills/?limit=5` and `?limit=99999` (asserts ValidationError with `.detail[0].ctx.le === 1000`).*
5. **Envelope unwrapping (`src/transport/envelopes.ts`).** `unwrap(raw, family: 'apiResponse' | 'bare' | 'hip4'): Page<T>`. *Accepts: tests across 3 captured samples (`fills-baseline.json`, hip3 `02_overview.json`, hip4 `fills_limit_5.json`).*
6. **Time helpers (`src/transport/time.ts`).** `parseTimestamp`, `encodeTime`, `parseHip4Expiry`, sentinel handling. *Accepts: tests for each of the 9 encoding variants in §E.1.*
7. **Coin helpers (`src/transport/coin.ts`).** `parseCoin`, `formatCoin`. *Accepts: tests over 8 coin examples from §G.1.*
8. **Number helpers (`src/transport/numbers.ts`).** `toBigInt`, `toNumber`, `parseFundingRate`. *Accepts: round-trip tests; precision-loss throws.*
9. **Pagination helpers (`src/transport/pagination.ts`).** `iterate({mode, ...})` for cursor / offset / time-window. *Accepts: tests against captured pages (`fills-page1.json` → `fills-page2.json` cursor flow; `hip3` offset; `funding-history-btc.json` time-window).*
10. **Common types (`src/types/common.ts`).** `Address`, `Coin`, `Hex`, `Wei`, `Side = 'A' | 'B'`, `Page<T>`, `Meta`. *Accepts: type-only tests via `tsd` or `expectTypeOf`.*
11. **Fills resource.** Endpoints: `/fills/`, `/fills/recent`, `/fills/user/{addr}`, `/fills/count`, `/fills/spot/`, `/fills/spot/user/{addr}`. Per §J. Cursor for perp; offset for spot; `total_count`-as-page-size guard on spot. *Accepts: 5 integration tests across `list`, `iterate`, `count`, `user`, spot offset.*
12. **Analytics + Overview resources.** Discriminated `KpiCard<T>`, `daily-*` series typed with `date: string` (not Date), `coin-distribution` with client-side address validation. *Accepts: 12 integration tests covering each endpoint.*
13. **Users + Completed-trades + Liquidations resources.** Polymorphic `leaderboard.by`, `liquidations.iterate({order:'asc'})` refusal, `/completed-trades/?limit` hard-cap at 100, `TradeFill` sanitized (drops `feeUsdc`/`typeTrade` shifted fields). *Accepts: 8 integration tests; one verifies the shifted-keys field is absent from `TradeFill`.*
14. **HIP-3 resource (bare envelope).** All 14 endpoints from batch-4. `/hip3/leaderboard.by` client-side validated. *Accepts: 14 integration tests (one per endpoint).*
15. **HIP-4 resource (Hip4Envelope).** All 10 endpoints from batch-5. `parseHip4Description` helper. `markets.coin` filter omitted from typed surface. *Accepts: 10 integration tests + 1 parser test.*
16. **Builders + TWAPs resources.** TWAP status template-literal union, error-prefix detection, builder `coinBreakdown` reuses hip3 dex prefix. *Accepts: 11 integration tests.*
17. **Funding + Vaults (bare envelope) + Spot (stubs).** Spot methods throw `ServerError` on call (no fetch). Funding+vault time-window iteration. `vaultLedger.kind` synthesized. *Accepts: 4 funding tests, 6 vault tests, 4 spot stub tests verifying immediate throw.*
18. **EVM resource.** All 16 endpoints. `txHash`/`fromAddr` typed as `string` with empty-string aware accessors. Boolean coercion on `success`/`is_system_tx`/`is_liquidation`. *Accepts: 16 integration tests.*
19. **Priority-fees / gossip resource.** Rename `address → nodeIp`. `dedupedHistory()` helper that collapses by `(slotId, startTime)`. *Accepts: 3 integration tests including dedupe.*
20. **`/info` dispatcher.** Discriminated union of 19+ `type` values per batch-9 table. Unwrap `currentFundingRates` + `vaultList` to match REST. *Accepts: 6 integration tests including the unwrap behavior and the `400 {error}` mapping.*
21. **WebSocket transport (`src/transport/ws.ts`).** Node-only in v0.1 (`transport: 'browser'` throws). Header auth, ping every 25 s, exponential backoff reconnect, subscription resync, client-side channel allowlist, typed dispatcher. *Accepts: integration tests for connect, welcome parse, subscribe/unsubscribe, reconnect under simulated drop, bogus-channel rejection.*
22. **Top-level client (`src/client.ts`).** `createClient(config): HypedexerClient` wiring all resources + `ws` + `info`. *Accepts: smoke test instantiating + calling one method per resource.*
23. **Public index (`src/index.ts`).** Named re-exports only. *Accepts: `tsd` test verifying public surface.*
24. **README + JSDoc pass.** Document every known bug from §I in JSDoc on the relevant method. *Accepts: doc coverage check; manual review.*

---

## M. `/info` vs REST decision

Per batch-9, `POST /info` is a valid Hyperliquid-style dispatcher mapping a discriminated `type` field to the same underlying handlers used by the REST endpoints. The SDK exposes both:

- **REST methods are the primary surface.** They are typed per resource, return typed `Page<T>` shapes, and don't need an out-of-band envelope-rewrap quirk.
- **`client.info({type, ...params})`** is a thin escape-hatch wrapper. It accepts the discriminated-union `InfoRequest`, dispatches to the same internal handlers as the REST methods, and returns the same typed payload that the REST equivalent would return. For the two known divergences (`currentFundingRates`, `vaultList`) the SDK unwraps the `APIResponse` that `/info` adds, so the return type stays aligned with REST.
- **Errors are different.** `info()` callers see the `{error: string}` shape (mapped to `ValidationError` with synthesized `detail[]`) on bogus types or empty bodies. The wrapper documents this.
- **Why keep `info()`?** Users coming from Hyperliquid's own `info` API expect that surface. Plus it serializes nicely (one POST body) for proxy/cache layers.

Internally, both paths share the same handlers and response decoders — `info()` is implemented in `src/resources/info.ts` and delegates to the appropriate resource method, not the other way around. This keeps the typing tight and avoids two code paths to debug.

---

## N. Open API issues to file with maintainers

In priority order, with batch references:

1. **`/spot/*` REST endpoints all return 500 with ClickHouse stack** ("Unknown table expression identifier 'hl_spot_tokens'"). Blocks spot REST entirely. Also affects `/info` types `spotTokenList` / `spotPairList`. (batch-7, batch-9)
2. **WebSocket subprotocol auth (`Sec-WebSocket-Protocol: apikey.<key>`) is not echoed back** in the 101 response, so strict clients including browsers fail handshake with 1006. Header auth works but is browser-incompatible. (batch-9)
3. **`/completed-trades/` has no `limit` cap** — a `limit=99999` returns 70 MB / 48 s. Add server-side `limit: 1..100`. (batch-3)
4. **`/completed-trades/{id}/fills` item rows have shifted keys**: `feeUsdc` contains the string `"perp"` and `typeTrade` contains an ISO timestamp. Almost certainly a positional-zip bug in the response serializer. (batch-3)
5. **`/liquidations/?order=asc` produces a cursor `"20911751377956:0"` (year 2245)** and stalls deep paging. Suspect a corrupt `time_ms` on the oldest row leaks into the cursor builder. (batch-3)
6. **Silent enum fallback** on `/overview/top-traders-24h?sort=`, `/completed-trades/?sort_by=`, `/builders/top?sort=`, `/hip3/leaderboard?by=`, `/hip4/markets?coin=`, `/evm/ledger/transfers?action_type=`, `/evm/bridge/events?event_type=`, WS `subscribe.subscription.type`. Should 422 like `/users/leaderboard?by=` does. (batch-2, batch-3, batch-4, batch-5, batch-6, batch-8, batch-9)
7. **`/hip3/assets.asset_id` is always 0** — placeholder or bug? Makes `?asset_id=` filter on `/hip3/oracle/stats` unusable. (batch-4)
8. **`/hip3/ohlcv.volume` and `.fees` are always 0** despite non-zero `trades`. (batch-4)
9. **`/overview/coin-distribution.top_token_liquidated` ignores `coin` filter** (returns global `BTC` even when filtering by `ETH`). (batch-2)
10. **`/evm/transactions.tx_hash` and `from_addr` are empty strings** in every observed row. (batch-8)
11. **`gossip/leaderboard.address` is an IPv4 not a wallet** but the response message says "wallets". Rename or document. (batch-2, batch-9)
12. **`/info` wraps `currentFundingRates` and `vaultList` in `APIResponse`** even though the REST counterparts are bare. Inconsistent envelope policy. (batch-9)
13. **HIP-4 `description` is pipe-delimited key:value** instead of a structured JSON object. Cumbersome to consume and impossible to validate. (batch-5)
14. **TWAP `status` enum on `/twaps/?status=` cannot retrieve error-status TWAPs as a class** (real values include `"error: Insufficient margin to place order."`). Add an `error` alias or expose a `status_class` field. (batch-6)
15. **`/users/{addr}/overview` returns 200 + zeroed sentinel** for malformed addresses; same on `/overview/coin-distribution`. `/fills/user/{addr}` 422s on the same input. Inconsistent. (batch-2, batch-3)
16. **`total_count` is unreliable** across the API — sometimes global, sometimes page size, sometimes null. Document the per-endpoint invariant (or fix). (every batch)
17. **`execution_time_ms: null`** on `/completed-trades/*` and `/completed-trades/summary` — parity break with the rest of `APIResponse`. (batch-3)
18. **WS server silently accepts bogus subscription types**. (batch-9)
19. **WS handler crashes on non-JSON frames** with `'str' object has no attribute 'get'` — leaks Python internals. (batch-9)
20. **WS graceful client close returns `1011 /origin`** instead of echoing 1000. (batch-9)
21. **`/info` `400 {error: …}` error shape** differs from FastAPI `{detail: …}` used by every other 4xx. Standardize. (batch-9)
22. **HIP-4 `outcome_id=0` (fallback) has `coin: ""`** and accumulates real volume (`total_fills: 41163`). What does the trading flow look like for an empty-coin outcome? (batch-5)
23. **HIP-4 settlement duplicates** — same outcome settles twice in adjacent blocks. Re-settlement or data quirk? (batch-5)
24. **`vaultDetails.portfolio[]` is leader-commission history, not positions** — misleading name. (batch-7)
25. **`/funding/userFunding`, `/vaults/userVaultEquities` return `[]` for every tested user.** Need a known data source to verify shape. (batch-7)
