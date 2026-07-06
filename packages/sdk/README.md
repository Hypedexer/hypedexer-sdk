# @hypedexer/sdk

> TypeScript SDK for the Hypedexer Hyperliquid indexer API.

Type-safe coverage of every REST endpoint + the WebSocket firehose, with
client-side defenses for every known upstream quirk.

<!-- badges: replace once published -->
[![npm](https://img.shields.io/badge/npm-%40hypedexer%2Fsdk-blue)](https://www.npmjs.com/package/@hypedexer/sdk)
[![types](https://img.shields.io/badge/types-included-3178c6)](#typescript)
[![license](https://img.shields.io/badge/license-MIT-green)](../../LICENSE)

- 100 entry points covered (94 REST + the `/info` dispatcher + 5 WS channels).
- One resource handle per endpoint family, three response envelopes unified
  behind a single `Page<T>` / `Single<T>` shape.
- A universal pagination iterator that hides cursor / offset / time-window
  strategies behind a single `for await` loop.
- Typed error hierarchy that preserves the upstream payload (`detail[]` on
  422, `Retry-After` on 429, ClickHouse stack text on 500, WS close codes).
- Zero runtime dependencies. `ws` is an optional peer dep, loaded lazily
  only if you call `client.ws.connect()`.
- ESM-first with a CJS fallback. Node `>= 20.18`. Strict-mode friendly.

---

## Install

```bash
pnpm add @hypedexer/sdk
# or
npm i @hypedexer/sdk
# or
yarn add @hypedexer/sdk
```

The WebSocket client uses the [`ws`](https://www.npmjs.com/package/ws)
package on Node. It is an **optional peer dep** — install it only if you
plan to use `client.ws`:

```bash
pnpm add ws
```

If `client.ws.connect()` is called without `ws` installed, the SDK throws
a `WebSocketError` with a clear install hint. The REST surface works fine
without it.

---

## Quickstart

```ts
import { createClient, HypedexerError, ValidationError } from '@hypedexer/sdk'

const client = createClient({
  apiKey: process.env.HYPEDEXER_API_KEY!,
  // baseUrl: 'https://api.hypedexer.com', // optional override
  // timeoutMs: 30_000,                    // optional, defaults to 30s
})

try {
  // Fetch one page (envelope-aware: meta.nextCursor surfaces upstream cursors).
  const page = await client.fills.list({ coin: 'BTC', limit: 100 })
  console.log(`got ${page.data.length} fills, hasMore=${page.meta.hasMore}`)

  // Or stream the whole result set — `iterate` picks cursor / offset / time-
  // window automatically per resource.
  let count = 0
  for await (const fill of client.fills.iterate({ coin: 'BTC', limit: 100 })) {
    count += 1
    if (count >= 1_000) break
  }
  console.log(`iterated ${count} fills`)
} catch (err) {
  if (err instanceof ValidationError) {
    console.error('client-side validation failed:', err.detail[0]?.msg)
  } else if (err instanceof HypedexerError) {
    console.error(`api error (status=${err.status}):`, err.message)
  } else {
    throw err
  }
}
```

---

## Architecture

- **One resource per endpoint family.** `client.fills`, `client.hip3`,
  `client.evm`, … each method maps 1:1 onto a documented endpoint
  (`packages/sdk/ENDPOINTS.md`). Resource handles nest where the upstream
  surface nests (`client.hip3.dexs.list`, `client.evm.blocks.transactions`).
- **`Page<T>` + meta passthrough.** All three upstream envelope families
  (`APIResponse<T>`, bare arrays, `Hip4Envelope`) collapse into one shape:
  `{ data, meta }`. The `meta` surface preserves what the upstream actually
  said — `nextCursor`, `hasMore`, `totalCount`, `executionMs`, HIP-4
  `status: 'live' | 'not_yet_live'`, etc. See [PLAN.md §B](../../PLAN.md#b-response-envelope-strategy).
- **Typed error hierarchy.** `HypedexerError` with subclasses for auth /
  validation / rate-limit / not-found / server / network / websocket. The
  upstream body is preserved on `.rawBody`, the FastAPI 422 array on
  `.detail`, the WS close code on `.closeCode`.
- **Universal pagination iterator.** `iterate()` (and named variants like
  `iterateUser`, `iterateRecent`) abstracts cursor + offset + time-window
  paging behind one `AsyncIterable`. Useful when you don't want to know
  whether the endpoint exposes `next_cursor` or `offset` or neither.
- **Zero runtime deps except optional `ws`.** No `zod`, no `axios`, no
  schema runtime. Pure `fetch` + lightweight inline assertion helpers
  (`assertAddress`, `assertEnum`, `assertLimit`).
- **ESM-first with a CJS fallback.** Built with `tsup`, dual exports map,
  declaration files for both. Tree-shakeable (`sideEffects: false`).

---

## Resources reference

The 16 handles exposed by `createClient`:

| Handle              | Endpoints | Description                                                                             |
| ------------------- | --------: | --------------------------------------------------------------------------------------- |
| `client.fills`      |         6 | Perp + spot fills: `list`, `iterate`, `recent`, `user`, `count`, `spotList`, `spotUser` |
| `client.analytics`  |         5 | Fills / liquidations / priority-fee stats, gossip leaderboard, daily chart              |
| `client.overview`   |         8 | 24 h KPI cards, top traders, daily volume + PnL series, coin distribution               |
| `client.users`      |         5 | Per-user `overview`, `performance`, `coins`, polymorphic `leaderboard`, `active`        |
| `client.completedTrades` |    3 | `list` (cap 100 client-side), `summary`, per-trade `fills`                              |
| `client.liquidations` |       2 | `list` (cursor) + `recent` (offset); `iterate({ order: 'asc' })` is refused             |
| `client.hip3`       |        18 | `dexs`, `assets`, `auctions`, `fills`, `stats.traders`, `overview`, `snapshots`, `topMovers`, `ohlcv`, `oracleStats`, `leaderboard`, `user(addr).*` |
| `client.hip4`       |        10 | `markets` / `outcomes` aliases, `questions`, `outcomeTokens`, `fills`, `fees`, `settlements`, `feeScales`, `analytics`, `userActions` |
| `client.builders`   |         6 | `top`, `stats`, `statsAllTimeframes`, `addrStats`, `users`, `list`                      |
| `client.twaps`      |         5 | `list`, `stats`, `user`, `get(twapId)`, `fills(twapId)`                                 |
| `client.funding`    |         3 | `predicted`, `history`, `userFunding` (string-encoded `fundingRate`)                    |
| `client.vaults`     |         6 | `list`, `details`, `dailySnapshots`, `equitySnapshots`, `ledger`, `userVaultEquities`   |
| `client.evm`        |        16 | `blocks` (+ `transactions`), `transactions`, `logs`, `transfers`, `bridge`, `stats`, `user`, `hip3.backstop.*` |
| `client.priorityFees` |       2 | Gossip `status`, `history`, `dedupedHistory` (client-side dedupe by `slot_id`)          |
| `client.info`       |         1 | `info({ type, … })` — typed `/info` dispatcher with 19 known types                      |
| `client.ws`         |   5 ch.   | `WSClient` — see [WebSocket](#websocket)                                                |

There is also a `client.http` escape hatch (the underlying `HttpClient`)
for endpoints not yet wrapped, or to swap in `opts.fetch` for tests.

### A handful of non-obvious examples

**HIP-3 — bare upstream envelope, normalized into `Page<T>`.**
The upstream returns a bare array; the SDK still wraps it so iterator and
list shapes match the rest of the surface.

```ts
const dexs = await client.hip3.dexs.list({ limit: 10 })
//    ^? Page<DexRegistry>

const overview = await client.hip3.overview()
//    ^? { data: Hip3Overview, meta: { family: 'bare', ... } }
```

**HIP-4 — surface `status: 'not_yet_live'` instead of pretending the data is empty.**

```ts
const feeScales = await client.hip4.feeScales.list()
if (feeScales.meta.status === 'not_yet_live') {
  console.warn(feeScales.meta.message, '— see', feeScales.meta.testnetDocs)
}
```

**Leaderboards — polymorphic by `by` discriminator.**
The same endpoint returns four distinct row shapes depending on `by`. The
SDK narrows the return type via TypeScript overloads.

```ts
const byVolume = await client.users.leaderboard({ by: 'volume', limit: 25 })
//    ^? Page<LeaderboardByVolume>

const byPnl = await client.users.leaderboard({ by: 'pnl', limit: 25 })
//    ^? Page<LeaderboardByPnl>

const byTrades = await client.users.leaderboard({ by: 'trades', limit: 25 })
//    ^? Page<LeaderboardByTrades>
```

**Completed trades — hard-capped client-side at 100.**
The upstream has no server cap and will happily return a 70 MB / 48 s
response. The SDK enforces a 100-row limit and rejects larger requests
with `ValidationError` before the network call.

```ts
try {
  await client.completedTrades.list({ limit: 500 })
} catch (err) {
  // ValidationError — never reaches the wire.
}
```

**EVM transactions — `txHash` and `fromAddr` are upstream-broken;
`txKey` is the SDK-derived join key.**

```ts
const page = await client.evm.transactions.list({ limit: 5 })
for (const tx of page.data) {
  // tx.txHash and tx.fromAddr are intentionally empty strings on this
  // endpoint (PLAN.md §I #10). Use txKey instead — it's the upstream-stable
  // composite of (block_number, transaction_index).
  console.log(tx.txKey, tx.valueWei) // valueWei is a decimal string
}
```

---

## WebSocket

The realtime client is constructed eagerly but holds no socket until you
call `connect()`. The optional peer dep `ws` is loaded lazily inside
`connect()` so REST-only callers don't pull it in.

```ts
import { createClient } from '@hypedexer/sdk'

const client = createClient({ apiKey: process.env.HYPEDEXER_API_KEY! })

await client.ws.connect()

const off = client.ws.on('completed_trades', (msg) => {
  // msg.channel === 'completed_trades'
  // msg.items: CompletedTradeItem[]
  for (const it of msg.items) console.log(it.coin, it.px, it.sz)
})

client.ws.on('reconnect', ({ attempt }) => {
  console.log('reconnecting, attempt', attempt)
})

client.ws.on('error', (err) => {
  console.error('ws error:', err)
})

await client.ws.subscribe('completed_trades')
await client.ws.subscribe('fills_spot')
await client.ws.subscribe('liquidation')

// later…
off() // unregister this handler
await client.ws.disconnect()
```

Notes:

- **v0.1 is Node-only.** Construction with `wsTransport: 'browser'` throws
  immediately because the upstream server fails to echo
  `Sec-WebSocket-Protocol`, which strict clients (browsers, the `ws`
  library) reject with close code 1006. See PLAN.md §I bug #19.
- **Header auth only.** The API key is sent as `X-API-Key` on the HTTP
  upgrade (the broken subprotocol path is bypassed).
- **Auto-reconnect with backoff.** 1 s → 60 s exponential, reset after a
  stable >60 s connection. 4xxx close codes and 4xx upgrade failures stop
  the loop. Upgrade `429` surfaces as `RateLimitError`.
- **Heartbeat 25 s.** App-layer pings (`ws.ping()`) keep the connection
  open under Cloudflare's ~100 s idle disconnect. Override with
  `wsHeartbeatMs` (set `0` to disable).
- **Subscription resync.** Active subscriptions are replayed automatically
  after a reconnect; you don't need to re-subscribe by hand.
- **5 channels:** `completed_trades`, `fills_spot`, `liquidation`,
  `hip4_events`, `recent_activity`. Channel names are validated against
  `KNOWN_CHANNELS` before being sent — the upstream silently accepts
  bogus types (PLAN.md §I #18).

---

## Error handling

Every API failure surfaces as a subclass of `HypedexerError`:

```
HypedexerError                  (abstract base; .status?, .rawBody?, .cause?)
├── AuthError                   (401 — bad / missing X-API-Key)
├── ValidationError             (422 + 400 — .detail[], .field(name) helper)
├── NotFoundError               (404 — FastAPI {detail: string})
├── RateLimitError              (429 — surfaces from REST and WS upgrade)
├── ServerError                 (500/502/503/504/524 — .rawBody = raw text)
├── NetworkError                (fetch failure / abort / TLS / DNS)
└── WebSocketError              (.closeCode?, .reason?, subclasses below)
    ├── WSAuthError             (4xxx-class handshake)
    ├── WSSubprotocolError      (1006 / "no subprotocol echoed")
    └── WSProtocolError         (server-sent {type:'error'}, raw-string handler)
```

The four most common errors in practice:

**Auth — 401 plaintext.**

```ts
import { AuthError } from '@hypedexer/sdk'

try {
  await client.fills.count()
} catch (err) {
  if (err instanceof AuthError) {
    // err.message: "missing api key" or "invalid api key"
    // err.rawBody: the raw plaintext body
  } else {
    throw err
  }
}
```

**Validation — `.detail[]` from FastAPI.**
The SDK also throws `ValidationError` *before* the request when an enum is
unknown, an address malformed, or a `limit` over the per-endpoint cap. In
that case `err.detail` is a one-element array describing the offending
param.

```ts
import { ValidationError } from '@hypedexer/sdk'

try {
  await client.users.overview('0x123' as `0x${string}`)
} catch (err) {
  if (err instanceof ValidationError) {
    for (const d of err.detail) {
      console.error(d.loc, '—', d.msg)
    }
    // helper: find the first detail matching a loc segment
    const fieldErr = err.field('user')
  }
}
```

**Rate limit — `Retry-After` parsed.**

```ts
import { RateLimitError } from '@hypedexer/sdk'

try {
  await client.fills.list({ coin: 'BTC' })
} catch (err) {
  if (err instanceof RateLimitError) {
    // err.status === 429
    // err.rawBody preserves the upstream body
    // err.cause may carry a parsed Retry-After if present
  }
}
```

**Server — `.rawBody` keeps the upstream response text.**
On any 5xx the SDK surfaces the parsed body (object) or the raw string
via `err.rawBody`, so you can log the ClickHouse trace or the FastAPI
detail without re-parsing.

```ts
import { ServerError } from '@hypedexer/sdk'

try {
  await client.fills.list({ limit: 100 })
} catch (err) {
  if (err instanceof ServerError) {
    console.error('upstream 500; rawBody preview:', String(err.rawBody).slice(0, 200))
  }
}
```

---

## Known upstream quirks the SDK defends

A condensed summary — the full list with batch references and per-bug
rationale lives in [PLAN.md §I](../../PLAN.md#i-known-api-bugs--gotchas-sdk-must-defend-or-document).
"Posture" is what the SDK does on your behalf.

### Broken endpoints

| #   | Upstream                                                                       | SDK posture                                                                 |
| --: | ------------------------------------------------------------------------------ | --------------------------------------------------------------------------- |
|   2 | `/completed-trades/` has no server `limit` cap (responses up to 70 MB / 48 s)  | Client-side hard cap at 100; larger requests throw `ValidationError`        |
|   4 | `/liquidations/?order=asc` returns a year-2245 corrupt cursor                  | `iterate({order:'asc'})` throws; `list({order:'asc'})` allowed for page 1   |
|  19 | WebSocket subprotocol echo broken → browsers can't connect                     | `wsTransport: 'browser'` throws at construction                             |

### Silent enum fallbacks (return 200 instead of 422)

| #   | Where                                                                          | SDK posture                                                                 |
| --: | ------------------------------------------------------------------------------ | --------------------------------------------------------------------------- |
|   5 | `top-traders.sort`, `completed-trades.sort_by`, `builders/top.sort`, `hip3/leaderboard.by`, `hip4/markets.coin`, `evm/ledger/transfers.action_type`, `evm/bridge.event_type`, WS subscription type | All enums validated client-side against frozen unions; throw `ValidationError` before sending |
|  14 | `/users/{addr}/overview` returns 200 + zeroed sentinel for bad address (no 422) | SDK validates address pattern client-side first                            |

### Data-shape oddities

| #   | Upstream                                                                       | SDK posture                                                                 |
| --: | ------------------------------------------------------------------------------ | --------------------------------------------------------------------------- |
|   3 | `/completed-trades/{id}/fills` shifted keys (`feeUsdc:"perp"`, `typeTrade:<ISO>`) | Drop the bogus fields; re-expose `tradeType: 'perp'` as a constant         |
|   6 | `/hip3/assets.asset_id` always 0                                               | Typed but documented not to use as a join key                              |
|   7 | `/hip3/ohlcv.volume`/`fees` always 0                                           | Documented in JSDoc; pass-through                                          |
|   8 | `/overview/coin-distribution.top_token_liquidated` ignores `coin` filter       | Documented; no SDK fix                                                     |
|   9 | `gossip/leaderboard.address` is an IPv4 not a wallet                           | Renamed to `nodeIp: string` in the typed model                             |
|  10 | `/evm/transactions.tx_hash` and `from_addr` are empty strings                  | Typed `string` but documented; SDK adds derived `txKey: '<block>:<tx>'`    |
|  11 | `/info` wraps `currentFundingRates` and `vaultList` in `APIResponse` (REST is bare) | `client.info({type})` unwraps to match the REST counterpart                |
|  12 | HIP-4 `description` is pipe-delimited mini-format                              | Ships `parseHip4Description(s)`; pre-parsed accessors on records           |
|  13 | TWAP status includes `"error: …"` free-text strings                            | Status typed as `'activated' \| 'finished' \| 'terminated' \| \`error: ${string}\`` |
|  16 | `total_count` semantics inconsistent (page size vs global vs null)             | Pass through raw on `meta.totalCount`; never used internally               |
|  17 | `last_activity = "1970-01-01T00:00:00"` and TWAP `startTime` sentinel         | `parseTimestamp` returns `null` for sentinel                               |
|  22 | `hip4/markets?coin=` silently ignored (real filter is `outcome_id`)            | SDK doesn't expose `coin` filter; only `outcomeId`                          |
|  23 | `users/leaderboard` returns polymorphic `data[]` keyed on `by`                 | Discriminated union; one method-overload per `by`                          |
|  24 | `vaultDetails.portfolio[]` is leader-commission history, not positions         | Renamed to `leaderCommissionHistory` in the typed model                    |
|  25 | `vaultLedger` rows: deposit/withdraw determined by `userTo === vaultAddress`   | Synthesizes `kind: 'deposit' \| 'withdraw'` field                          |

### WebSocket quirks

| #   | Upstream                                                                       | SDK posture                                                                 |
| --: | ------------------------------------------------------------------------------ | --------------------------------------------------------------------------- |
|  18 | WS silently accepts bogus subscriptions and crashes on raw-string frames       | Channel allowlist (`KNOWN_CHANNELS`); SDK never sends non-JSON              |
|  20 | WS graceful close returns `1011 /origin` instead of `1000`                     | Reconnect logic classifies 1011 as transient                                |
|  21 | `/evm/transactions` `epoch_ms` time filter silently ignored                    | SDK always emits ISO `Z` on EVM endpoints                                   |
|  15 | `/completed-trades/<bogus>/fills` returns 200 empty (no 404)                   | Documented; SDK does not synthesize 404                                     |

---

## TypeScript

- Ships full `.d.ts` for ESM and CJS.
- Designed against `tsc --strict` with `exactOptionalPropertyTypes: true`.
  All optional response fields are precisely `T | undefined` or `T | null`
  per the upstream contract, never both unless observed.
- Tree-shakeable (`sideEffects: false` in `package.json`). Importing a
  single resource won't pull in unrelated ones.
- Public types are exported from the root entry — `Page<T>`, `Single<T>`,
  `EnvelopeFamily`, `Hip4Envelope`, `Address`, `Coin`, `Hex`, `Side`,
  `Wei`, plus per-resource params and row types (see
  `packages/sdk/src/index.ts`).

`import` works as you'd expect:

```ts
import {
  createClient,
  parseCoin,
  parseHip4Description,
  ValidationError,
  type Page,
  type Fill,
  type LeaderboardByVolume,
} from '@hypedexer/sdk'
```

Node `>= 20.18` is required.

---

## Contributing

This package lives in the monorepo at
[`hypedexer/hypedexer-sdk`](https://github.com/hypedexer/hypedexer-sdk).
See `CONTRIBUTING.md` (or the repository's root README) for the dev
workflow. A few non-negotiables:

- **Conventional Commits**, scope `sdk` (or `docs` when the change is
  doc-only). Body lines are capped at 100 chars by commitlint.
- **ESM imports must carry the `.js` extension.** TypeScript is configured
  with `--moduleResolution NodeNext`.
- **No AI co-author footers.** The Husky `commit-msg` hook rejects
  `Co-Authored-By: claude/copilot/...` and similar.
- **Lint via biome.** `lint-staged` runs on commit; match the existing
  formatting and import order.
- **Tests must pass:** `pnpm --filter @hypedexer/sdk test` and
  `pnpm --filter @hypedexer/sdk typecheck`.

---

## License

MIT — see [LICENSE](../../LICENSE).
