# @hypedexer/sdk

> Type-safe TypeScript SDK for the [Hypedexer](https://hypedexer.com) Hyperliquid indexer API — full REST coverage, realtime WebSocket, defensive against every upstream quirk.

[![npm version](https://img.shields.io/npm/v/@hypedexer/sdk.svg?label=%40hypedexer%2Fsdk&color=cb3837&labelColor=333)](https://www.npmjs.com/package/@hypedexer/sdk)
[![npm downloads](https://img.shields.io/npm/dm/@hypedexer/sdk.svg?color=cb3837&labelColor=333)](https://www.npmjs.com/package/@hypedexer/sdk)
[![provenance signed](https://img.shields.io/badge/provenance-signed-brightgreen?labelColor=333)](https://docs.npmjs.com/generating-provenance-statements)
[![types included](https://img.shields.io/badge/types-included-3178c6?labelColor=333)](#typescript)
[![node >= 20.18](https://img.shields.io/badge/node-%3E%3D20.18-3c873a?labelColor=333)](https://nodejs.org)
[![license MIT](https://img.shields.io/badge/license-MIT-blue?labelColor=333)](../../LICENSE)

```bash
pnpm add @hypedexer/sdk
```

---

## Why this SDK

If you've built against `api.hypedexer.com` directly, you've hit them all:

- 3 different response envelopes to unwrap depending on the endpoint.
- Cursor pagination on some routes, offset on others, time-window on liquidations.
- Enums that silently 200 with garbage instead of 422 on bad input.
- Addresses that return "success" with zeroed sentinels on typos.
- FastAPI `detail[]` on 422s, ClickHouse stack traces on 500s, plaintext on 401s.
- A WebSocket that crashes on non-JSON, drops the subprotocol echo, and accepts bogus channels silently.

This SDK collapses all of that behind **one client, one envelope, one iterator, one error tree** — and refuses invalid input client-side before it can round-trip.

### At a glance

|              |                                                                    |
| ------------ | ------------------------------------------------------------------ |
| **Coverage** | 97 REST endpoints + WebSocket firehose (5 channels)                |
| **Resources**| 16 typed handles under `client.*`                                  |
| **Errors**   | 10-class hierarchy, upstream body always preserved                 |
| **Runtime**  | Zero dependencies (`ws` is an *optional* peer dep, lazy-loaded)    |
| **Bundle**   | ESM + CJS dual exports, `sideEffects: false`                       |
| **Tests**    | 501 unit tests + type-regression suite (`expectTypeOf`)            |
| **Supply**   | Published from GitHub Actions with `npm --provenance`              |

---

## Install

```bash
pnpm add @hypedexer/sdk        # or: npm i / yarn add / bun add
```

The WebSocket client uses [`ws`](https://www.npmjs.com/package/ws) on Node. It's an **optional peer dep** — install it only if you plan to use `client.ws`:

```bash
pnpm add ws
```

Calling `client.ws.connect()` without `ws` installed throws a `WebSocketError` with an install hint. The REST surface works fine without it.

---

## Quickstart

```ts
import { createClient, HypedexerError, ValidationError } from '@hypedexer/sdk'

const client = createClient({
  apiKey: process.env.HYPEDEXER_API_KEY!,
  // baseUrl:   'https://api.hypedexer.com',  // optional
  // timeoutMs: 30_000,                       // optional, default 30 s
})

// One page — meta.nextCursor / meta.hasMore surface upstream cursors.
const page = await client.fills.list({ coin: 'BTC', limit: 100 })
console.log(`${page.data.length} fills, hasMore=${page.meta.hasMore}`)

// Or stream the whole result set — iterate() picks cursor / offset /
// time-window paging automatically per resource.
let count = 0
for await (const fill of client.fills.iterate({ coin: 'BTC' })) {
  count += 1
  if (count >= 1_000) break
}

// Typed errors.
try {
  await client.users.overview('not-an-address' as `0x${string}`)
} catch (err) {
  if (err instanceof ValidationError) {
    console.error('bad input:', err.detail[0]?.msg)
  } else if (err instanceof HypedexerError) {
    console.error(`api error ${err.status}:`, err.message)
  }
}
```

### Realtime WebSocket

```ts
const client = createClient({ apiKey: process.env.HYPEDEXER_API_KEY! })

await client.ws.connect()

client.ws.on('completed_trades', ({ items }) => {
  for (const it of items) console.log(it.coin, it.px, it.sz)
})

await client.ws.subscribe('completed_trades')
// … later
await client.ws.disconnect()
```

More: see [`examples/`](../../examples) for six runnable scripts covering fills, user profiles, HIP-3 markets, liquidations, WebSocket, and the error hierarchy.

---

## Architecture

- **One resource per endpoint family.** `client.fills`, `client.hip3`, `client.evm`, … each method maps 1:1 onto a documented endpoint. Sub-resources nest where the upstream nests (`client.hip3.dexs.list`, `client.evm.blocks.transactions`).
- **One envelope shape.** All three upstream families (`APIResponse<T>`, bare arrays, `Hip4Envelope`) collapse into `{ data, meta }`. `meta` faithfully preserves `nextCursor`, `hasMore`, `totalCount`, `executionMs`, HIP-4 `status: 'live' | 'not_yet_live'`, etc. See [PLAN.md §B](../../PLAN.md#b-response-envelope-strategy).
- **One iterator.** `iterate()` (and named variants like `iterateUser`, `iterateRecent`) hides cursor / offset / time-window paging behind an `AsyncIterable<T>`.
- **One error tree.** Every failure is a subclass of `HypedexerError`. The upstream payload is preserved on `.rawBody`, the FastAPI 422 array on `.detail`, the WS close code on `.closeCode`.
- **Client-side defense.** Enums, address shape, and limit caps are validated *before* the request. Bad input becomes `ValidationError` synchronously — never a wasted round-trip and never a silent 200-with-garbage.
- **Zero runtime deps.** No `zod`, no `axios`, no schema runtime. Pure `fetch` + tiny inline assertion helpers.
- **ESM-first, CJS fallback.** Built with `tsup`, declaration files for both. Tree-shakeable.

---

## Resources

The 16 handles exposed by `createClient({ apiKey })`:

| Handle                    | Endpoints | Highlights                                                                                    |
| ------------------------- | --------: | --------------------------------------------------------------------------------------------- |
| `client.fills`            |         6 | Perp + spot fills: `list` / `recent` / `user` / `count` / `spotList` / `spotUser` (+ iterators) |
| `client.analytics`        |         5 | Fills / liquidations / priority-fee stats, gossip leaderboard, daily chart                    |
| `client.overview`         |         8 | 24 h KPI cards, top traders, daily volume + PnL series, coin distribution                     |
| `client.users`            |         5 | Per-user `overview`, `performance`, `coins`, polymorphic `leaderboard`, `active`              |
| `client.completedTrades`  |         3 | `list` (hard-capped at 100), `summary`, per-trade `fills`                                     |
| `client.liquidations`     |         2 | `list` (cursor) + `recent`; `iterate({ order: 'asc' })` is refused (upstream bug)             |
| `client.hip3`             |        18 | `dexs`, `assets`, `auctions`, `fills`, `stats.traders`, `overview`, `snapshots`, `topMovers`, `ohlcv`, `oracleStats`, `leaderboard`, `user(addr).*` |
| `client.hip4`             |        10 | `markets` / `outcomes` (alias), `questions`, `outcomeTokens`, `fills`, `fees`, `settlements`, `feeScales`, `analytics`, `userActions` |
| `client.builders`         |         6 | `top`, `stats`, `statsAllTimeframes`, `addrStats`, `users`, `list`                            |
| `client.twaps`            |         5 | `list`, `stats`, `user`, `get(twapId)`, `fills(twapId)`                                       |
| `client.funding`          |         3 | `predicted`, `history`, `userFunding` (string-encoded `fundingRate`)                          |
| `client.vaults`           |         6 | `list`, `details`, `dailySnapshots`, `equitySnapshots`, `ledger`, `userVaultEquities`         |
| `client.evm`              |        16 | `blocks` (+ `transactions`), `transactions`, `logs`, `transfers`, `bridge`, `stats`, `user`, `hip3.backstop.*` |
| `client.priorityFees`     |         2 | Gossip `status`, `history`, `dedupedHistory` (client-side dedupe by `slot_id`)                |
| `client.info`             |         1 | `info({ type, … })` — typed `/info` dispatcher with 19 known types                            |
| `client.ws`               |  5 chans  | Realtime — see [WebSocket](#websocket)                                                        |

`client.http` is the underlying `HttpClient` — use it for endpoints not yet wrapped, or pass `opts.fetch` for tests.

### Non-obvious patterns

**HIP-3 bare envelope, still normalized into `Page<T>`.**
```ts
const dexs = await client.hip3.dexs.list({ limit: 10 })
//    ^? Page<DexRegistry>
```

**HIP-4 surfaces `status: 'not_yet_live'` instead of pretending the data is empty.**
```ts
const feeScales = await client.hip4.feeScales.list()
if (feeScales.meta.status === 'not_yet_live') {
  console.warn(feeScales.meta.message, 'see', feeScales.meta.testnetDocs)
}
```

**Leaderboards — polymorphic return type narrowed by `by`.**
```ts
const byVolume = await client.users.leaderboard({ by: 'volume', limit: 25 })
//    ^? Page<LeaderboardByVolume>
const byPnl    = await client.users.leaderboard({ by: 'pnl',    limit: 25 })
//    ^? Page<LeaderboardByPnl>
```

**Completed trades — hard-capped client-side at 100.**
The upstream has no server cap and will happily return 70 MB / 48 s responses. The SDK caps at 100 and rejects with `ValidationError` synchronously.
```ts
await client.completedTrades.list({ limit: 500 })
// ValidationError — never touches the network.
```

**EVM transactions — `txHash`/`fromAddr` are empty upstream; use `txKey`.**
```ts
const page = await client.evm.transactions.list({ limit: 5 })
for (const tx of page.data) {
  console.log(tx.txKey, tx.valueWei) // txKey = `${block_number}:${transaction_index}`
}
```

---

## WebSocket

The realtime client is constructed eagerly but holds no socket until `connect()`. The `ws` peer dep is loaded lazily.

```ts
const client = createClient({ apiKey: process.env.HYPEDEXER_API_KEY! })

await client.ws.connect()

const off = client.ws.on('completed_trades', ({ items }) => {
  for (const it of items) console.log(it.coin, it.px, it.sz)
})

client.ws.on('reconnect', ({ attempt }) => console.log('reconnecting #' + attempt))
client.ws.on('error',     (err)          => console.error('ws error:', err))

await client.ws.subscribe('completed_trades')
await client.ws.subscribe('fills_spot')
await client.ws.subscribe('liquidation')

// later
off()
await client.ws.disconnect()
```

| Aspect               | Behaviour                                                                                                                     |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| **Transport**        | Node only. Browser construction throws — upstream drops the subprotocol echo (PLAN §I #19)                                    |
| **Auth**             | Header only. `X-API-Key` on the HTTP upgrade                                                                                  |
| **Heartbeat**        | App-layer ping every 25 s. Configurable via `wsHeartbeatMs`, set `0` to disable                                               |
| **Reconnect**        | Exponential backoff 1 s → 60 s, cap 60 s, reset after a stable 60 s open                                                      |
| **Terminal errors**  | 4xx upgrade → `WSAuthError`; 429 → `RateLimitError` (honours `Retry-After`); 4xxx close code → stops the loop                 |
| **Subscription resync** | Every active subscription is replayed on reopen — no manual re-sub                                                         |
| **Channel allowlist** | `KNOWN_CHANNELS` enforced client-side. Welcome frame's `available_subscriptions` extends it at runtime                       |
| **Outbound discipline** | Every frame is `JSON.stringify`'d — the server crashes on raw strings (PLAN §I #19)                                        |

**5 channels:** `completed_trades`, `fills_spot`, `liquidation`, `hip4_events`, `recent_activity`.

---

## Error handling

Every failure is a subclass of `HypedexerError`. A single `catch (err) { if (err instanceof HypedexerError) … }` covers the tree.

```
HypedexerError                  (abstract base — .status?, .rawBody?, .cause?)
├── AuthError                   401 · bad / missing X-API-Key
├── ValidationError             422 + 400 · .detail[] · .field(name) helper
├── NotFoundError               404 · FastAPI { detail: string }
├── RateLimitError              429 · Retry-After parsed
├── ServerError                 500 / 502 / 503 / 504 / 524 · .rawBody preserved
├── NetworkError                fetch / abort / TLS / DNS / JSON parse
└── WebSocketError              .closeCode? · .reason?
    ├── WSAuthError             4xx upgrade or 4xxx close code
    ├── WSSubprotocolError      1006 (typical subprotocol-echo failure)
    └── WSProtocolError         server-sent { type: 'error' } frame
```

### Common patterns

**Client-side validation fires before the request.** Bad enums, malformed addresses, out-of-range limits all become `ValidationError` synchronously with a populated `.detail`.

```ts
try {
  await client.users.overview('0x123' as `0x${string}`)
} catch (err) {
  if (err instanceof ValidationError) {
    console.error(err.detail[0]?.loc, '—', err.detail[0]?.msg)
    // helper: find the first detail matching a `loc` segment
    const fieldErr = err.field('user')
  }
}
```

**Rate limits surface `Retry-After`.**

```ts
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

**Server errors keep the raw upstream body.**

```ts
try {
  await client.fills.list({ limit: 100 })
} catch (err) {
  if (err instanceof ServerError) {
    console.error('upstream 5xx; rawBody:', String(err.rawBody).slice(0, 200))
  }
}
```

---

## Known upstream quirks the SDK defends

Condensed reference — the full audit with batch citations lives in [PLAN.md §I](../../PLAN.md#i-known-api-bugs--gotchas-sdk-must-defend-or-document). "Posture" is what the SDK does on your behalf.

### Broken endpoints

| #   | Upstream                                                                       | SDK posture                                                                 |
| --: | ------------------------------------------------------------------------------ | --------------------------------------------------------------------------- |
|   2 | `/completed-trades/` has no server `limit` cap (up to 70 MB / 48 s responses)  | Client-side hard cap at 100; larger requests throw `ValidationError`        |
|   4 | `/liquidations/?order=asc` returns a year-2245 corrupt cursor                  | `iterate({ order: 'asc' })` throws; `list({ order: 'asc' })` allowed page 1 |
|  19 | WS subprotocol echo broken — browsers can't connect                            | `wsTransport: 'browser'` throws at construction                             |

### Silent enum fallbacks (200 instead of 422)

| #   | Where                                                                          | SDK posture                                                                 |
| --: | ------------------------------------------------------------------------------ | --------------------------------------------------------------------------- |
|   5 | `top-traders.sort`, `completed-trades.sort_by`, `builders/top.sort`, `hip3/leaderboard.by`, `hip4/markets.coin`, `evm/ledger/transfers.action_type`, `evm/bridge.event_type`, WS subscription type | All enums validated client-side against frozen unions; throw `ValidationError` before sending |
|  14 | `/users/{addr}/overview` returns 200 + zeroed sentinel for bad address (no 422) | SDK validates address pattern client-side first                             |

### Data-shape oddities

| #   | Upstream                                                                       | SDK posture                                                                 |
| --: | ------------------------------------------------------------------------------ | --------------------------------------------------------------------------- |
|   3 | `/completed-trades/{id}/fills` shifted keys (`feeUsdc:"perp"`, `typeTrade:<ISO>`) | Drop bogus fields; re-expose `tradeType: 'perp'` as a constant              |
|   6 | `/hip3/assets.asset_id` always 0                                               | Typed but documented not to use as a join key                               |
|   7 | `/hip3/ohlcv.volume` / `fees` always 0                                         | Documented in JSDoc; pass-through                                           |
|   8 | `/overview/coin-distribution.top_token_liquidated` ignores `coin` filter       | Documented; no SDK fix                                                      |
|   9 | `gossip/leaderboard.address` is an IPv4 not a wallet                           | Renamed to `nodeIp: string` in the typed model                              |
|  10 | `/evm/transactions.tx_hash` and `from_addr` are empty strings                  | Typed `string`; SDK adds derived `txKey: '<block>:<tx>'`                    |
|  11 | `/info` wraps `currentFundingRates` and `vaultList` in `APIResponse` (REST is bare) | `client.info({ type })` unwraps to match the REST counterpart              |
|  12 | HIP-4 `description` is pipe-delimited mini-format                              | Ships `parseHip4Description(s)`; pre-parsed accessors on records            |
|  13 | TWAP status includes `"error: …"` free-text strings                            | Status typed as ``'activated' | 'finished' | 'terminated' | `error: ${string}` `` |
|  16 | `total_count` semantics inconsistent (page size vs global vs null)             | Pass through raw on `meta.totalCount`; never used internally                |
|  17 | `last_activity = "1970-01-01T00:00:00"` and TWAP `startTime` sentinel          | `parseTimestamp` returns `null` for sentinel                                |
|  22 | `hip4/markets?coin=` silently ignored (real filter is `outcome_id`)            | SDK doesn't expose `coin` filter; only `outcomeId`                          |
|  23 | `users/leaderboard` returns polymorphic `data[]` keyed on `by`                 | Discriminated union; one method-overload per `by`                           |
|  24 | `vaultDetails.portfolio[]` is leader-commission history, not positions         | Renamed to `leaderCommissionHistory` in the typed model                     |
|  25 | `vaultLedger` rows: deposit/withdraw determined by `userTo === vaultAddress`   | Synthesizes `kind: 'deposit' | 'withdraw'` field                            |

### WebSocket quirks

| #   | Upstream                                                                       | SDK posture                                                                 |
| --: | ------------------------------------------------------------------------------ | --------------------------------------------------------------------------- |
|  15 | `/completed-trades/<bogus>/fills` returns 200 empty (no 404)                   | Documented; SDK does not synthesize 404                                     |
|  18 | WS silently accepts bogus subscriptions and crashes on raw-string frames       | Channel allowlist (`KNOWN_CHANNELS`); SDK never sends non-JSON              |
|  20 | WS graceful close returns `1011 /origin` instead of `1000`                     | Reconnect logic classifies 1011 as transient                                |
|  21 | `/evm/transactions` `epoch_ms` time filter silently ignored                    | SDK always emits ISO `Z` on EVM endpoints                                   |

### Fixed upstream (kept for reference)

| #   | Upstream                                                                       | Historical SDK posture                                                      |
| --: | ------------------------------------------------------------------------------ | --------------------------------------------------------------------------- |
|   1 | `/fills/spot/*` returned 500 ClickHouse                                        | *Fixed 2026-07-06.* `spotList` / `spotUser` now issue real requests (0.1.0-beta.1) |

---

## TypeScript

- Full `.d.ts` for ESM and CJS.
- Designed against `tsc --strict` with `exactOptionalPropertyTypes: true`. Optional response fields are precisely `T | undefined` or `T | null`, never both unless observed on the wire.
- Tree-shakeable — `sideEffects: false`. Importing one resource won't pull in others.
- Public types exported from the root: `Page<T>`, `Single<T>`, `EnvelopeFamily`, `Hip4Envelope`, `Address`, `Coin`, `Hex`, `Side`, `Wei`, plus per-resource params and row types (see `src/index.ts`).

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

Node `>= 20.18` required.

---

## Contributing

This package lives in the monorepo at [`Hypedexer/hypedexer-sdk`](https://github.com/Hypedexer/hypedexer-sdk). A few non-negotiables:

- **Conventional Commits**, scope `sdk` (or `docs` when doc-only). Subject lowercase, body wrapped at 100 chars.
- **ESM imports carry the `.js` extension** — TypeScript is configured with `--moduleResolution NodeNext`.
- **No AI co-author footers.** Husky rejects `Co-Authored-By: claude/copilot/…` and similar.
- **Lint via biome.** `lint-staged` runs on commit; match existing formatting and import order.
- **All checks must pass:** `pnpm --filter @hypedexer/sdk typecheck && pnpm --filter @hypedexer/sdk test`.

Release cycle:

- `chore(release)` bump on `packages/sdk/package.json` + `CHANGELOG.md`.
- Direct push to `main` (no PR / feature branch in this repo).
- Tag `vX.Y.Z-…` — the [`release.yml`](../../.github/workflows/release.yml) workflow builds, tests, and publishes with npm provenance. Prereleases land under the `beta` dist-tag; stable versions on `latest`.

---

## License

MIT — see [LICENSE](../../LICENSE).
