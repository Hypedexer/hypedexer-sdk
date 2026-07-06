# AGENTS.md — @hypedexer/sdk

Implementation guide for AI coding agents integrating `@hypedexer/sdk` into a codebase. Read this before writing code — it captures the API shape, common patterns, gotchas, and security posture so you produce working code on the first pass.

For agents modifying the SDK itself, see the repository-root [`AGENTS.md`](https://github.com/Hypedexer/hypedexer-sdk/blob/main/AGENTS.md).

---

## What this SDK is

TypeScript SDK for the Hypedexer Hyperliquid indexer API. Type-safe wrapper over ~97 REST endpoints + a realtime WebSocket for 5 channels.

- Node ≥ 20.18. Zero runtime deps (`ws` is an *optional* peer dep — install only for WebSocket).
- ESM-first, CJS fallback. `sideEffects: false`, tree-shakeable.
- Published with npm provenance (verifiable at sigstore).

---

## 1. First call

```ts
import { createClient } from '@hypedexer/sdk'

const client = createClient({
  apiKey: process.env.HYPEDEXER_API_KEY!,   // required
  // baseUrl:   'https://api.hypedexer.com', // optional
  // timeoutMs: 30_000,                      // optional, per-request
})

const page = await client.fills.list({ coin: 'BTC', limit: 100 })
console.log(page.data.length, page.meta.hasMore, page.meta.nextCursor)
```

Every response is `Page<T>` (list-shaped) or `Single<T>` (record-shaped):

```ts
type Page<T>   = { data: T[]; meta: PageMeta }
type Single<T> = { data: T | null; meta: PageMeta }
```

`meta` faithfully preserves upstream: `nextCursor`, `hasMore`, `totalCount`, `executionMs`, HIP-4 `status: 'live' | 'not_yet_live'`. Never hardcode a fallback for these; check `meta` and act.

---

## 2. Client handles — where to find what

```ts
client.fills            // /fills/* — perp + spot fills
client.analytics        // /analytics/* — stats
client.overview         // /overview/* — 24 h KPI cards
client.users            // /users/* — per-user overview, coins, leaderboard, active
client.completedTrades  // /completed-trades/* — trade rollups (hard-capped at 100)
client.liquidations     // /liquidations/* — cursor + recent
client.hip3             // /hip3/* — subdexs, assets, auctions, snapshots, ohlcv, oracle, user
client.hip4             // /hip4/* — prediction markets (markets, questions, outcomeTokens, fills, fees, settlements, feeScales, analytics, userActions)
client.builders         // /builders/* — perp builders
client.twaps            // /twaps/* — TWAP orders + fills
client.funding          // /funding/* — predicted / history / user funding
client.vaults           // /vaults/* — vault registry + ledger
client.evm              // /evm/* — HyperEVM blocks / txs / logs / bridge / stats / user
client.priorityFees     // /priority-fees/* — gossip status + history
client.info             // /info — typed POST dispatcher (Hyperliquid public info)
client.ws               // realtime — see §5
client.http             // escape hatch: raw HttpClient for unwrapped endpoints
```

Handles are typed — `client.hip3.dexs.list()`, `client.hip3.assets.get(ticker)`, `client.hip3.user(addr).overview()`. Rely on IntelliSense. If a method doesn't autocomplete, it doesn't exist — don't invent it.

---

## 3. Pagination — always use `iterate()` for multi-page walks

Three upstream pagination shapes are unified behind `iterate()` and named variants:

```ts
// Cursor-paginated (most endpoints):
for await (const fill of client.fills.iterate({ coin: 'BTC', limit: 1000 })) {
  // fill: Fill
  if (someStopCondition) break
}

// Named variants exist where the endpoint splits fresh-tail vs full history:
for await (const fill of client.fills.iterateRecent()) { /* /fills/recent */ }
for await (const fill of client.fills.iterateUser(address, { timeRange: '24h' })) { /* /fills/user/{addr} */ }
```

**Always cap the loop.** No global iteration budget. In production, count rows or wall-clock and `break` explicitly.

For single-page reads use `.list(...)` and check `meta.hasMore` yourself:

```ts
const first = await client.liquidations.list({ coin: 'xyz:AAPL', limit: 100 })
if (first.meta.hasMore && first.meta.nextCursor) {
  const next = await client.liquidations.list({ coin: 'xyz:AAPL', limit: 100, cursor: first.meta.nextCursor })
}
```

---

## 4. Error handling — one hierarchy, always narrow

Every failure is a subclass of `HypedexerError`.

```ts
import {
  HypedexerError,
  AuthError,         // 401
  ValidationError,   // 422 + 400 + SDK-side pre-request validation
  NotFoundError,     // 404
  RateLimitError,    // 429; check err.rawBody / err.cause for Retry-After
  ServerError,       // 500 / 502 / 503 / 504 / 524
  NetworkError,      // fetch failure / abort / TLS / JSON parse
  WebSocketError,    // .closeCode?, .reason?
  WSAuthError,       // 4xx upgrade or 4xxx close code
  WSSubprotocolError,// 1006 after welcome
  WSProtocolError,   // server-sent { type: 'error' } frame
} from '@hypedexer/sdk'

try {
  await client.users.overview(userAddress)
} catch (err) {
  if (err instanceof ValidationError) {
    // err.detail: ValidationDetail[] — pinpointed field errors
    // err.field(name): find the first detail whose loc matches
    console.error(err.detail[0]?.loc, err.detail[0]?.msg)
  } else if (err instanceof RateLimitError) {
    // back off; err.rawBody preserves upstream body
  } else if (err instanceof HypedexerError) {
    // catch-all — status?, rawBody?, cause?
  } else {
    throw err
  }
}
```

**Client-side validation fires BEFORE the request.** Bad enums, malformed addresses, out-of-range limits become `ValidationError` synchronously — no wasted round-trip. Never bypass this by hitting `client.http.request(...)` unless you know exactly why.

---

## 5. WebSocket — Node only, lazy-loaded

`ws` is an **optional peer dep**. Install `pnpm add ws` alongside `@hypedexer/sdk` if you plan to use `client.ws`. Without `ws`, the REST surface still works.

```ts
const client = createClient({ apiKey: process.env.HYPEDEXER_API_KEY! })

client.ws.on('open',     ()              => console.log('ws open'))
client.ws.on('close',    ({ code })      => console.log('ws close', code))
client.ws.on('reconnect',({ attempt })   => console.log('reconnect #' + attempt))
client.ws.on('error',    (err)           => console.error('ws error:', err.name, err.message))

client.ws.on('completed_trades', ({ items }) => {
  for (const it of items) console.log(it.coin, it.px, it.sz)
})

await client.ws.connect()
await client.ws.subscribe('completed_trades')
await client.ws.subscribe('fills_spot')
await client.ws.subscribe('liquidation')

// … later
await client.ws.unsubscribe('completed_trades')
await client.ws.disconnect()
```

**5 valid channels:** `completed_trades`, `fills_spot`, `liquidation`, `hip4_events`, `recent_activity`. Any other string throws `ValidationError` at `subscribe()` time — do not attempt to hit the server with a bogus channel to "test" it (the server silently accepts and never streams).

**Node only.** Constructing with `wsTransport: 'browser'` throws immediately (upstream subprotocol quirk, PLAN §I #19). For browsers, either proxy through your backend or wait for upstream fix.

**Reconnect is automatic**: exponential 1 s → 60 s, cap 60 s, reset after 60 s stable. 4xxx close codes and 4xx upgrades stop the loop and surface as `WSAuthError`. `429` upgrade surfaces as `RateLimitError` and honours `Retry-After`. Subscriptions are automatically replayed on reopen — never re-subscribe manually after a reconnect.

---

## 6. Non-obvious defensive patterns you get for free

The SDK defends against 25 documented upstream quirks. The ones most likely to bite an agent:

| Pattern | Rule |
|---|---|
| **Limit caps** | `completedTrades.list` capped at 100 client-side (server has no cap; 70 MB / 48 s responses are possible). Do NOT pass higher — you get `ValidationError`. |
| **Enum enforcement** | `top-traders.sort`, `builders/top.sort`, `hip3/leaderboard.by`, `completed-trades.sort_by`, `evm/ledger/transfers.action_type`, `evm/bridge.event_type`, WS `type` — all validated against frozen unions. Server otherwise silently returns 200 with garbage. |
| **Address validation** | Every `address`/`user` param is `Address` branded. `assertAddress` runs synchronously — server otherwise returns 200 + zeroed sentinels. |
| **Ascending liquidations** | `client.liquidations.iterate({ order: 'asc' })` throws — upstream cursor corrupts to year 2245. Use default `desc` for iteration. |
| **HIP-4 not yet live** | Check `page.meta.status === 'not_yet_live'` before assuming empty data means "no matches." |
| **HIP-3 fills, HIP-3 ohlcv** | `volume`, `fees` are 0 upstream — typed but documented. Do not rely on them for revenue calcs. |
| **EVM tx hash** | `tx.tx_hash` and `tx.from_addr` are empty strings upstream. Use `tx.txKey` (`${block_number}:${transaction_index}`) as the SDK-synthesized join key. |
| **Funding rate precision** | Comes as a decimal string. Parse via `parseFundingRate(s)` (returns `number` in v0.1). Do NOT cast directly to `number`. |
| **Wei-class values** | `value_wei`, `amount_raw` come as strings. Parse via `toBigInt(s)`. Direct `Number(s)` loses precision for large values. |
| **Vault ledger direction** | Deposit vs withdraw is determined server-side by `userTo === vaultAddress`. The SDK synthesizes `kind: 'deposit' | 'withdraw'` — use that field. |
| **TWAP status** | May be `'error: …'` free-text string in addition to the enum. Type is ``'activated' \| 'finished' \| 'terminated' \| `error: ${string}` ``. |
| **`/info` dispatch** | Two payload types (`currentFundingRates`, `vaultList`) are wrapped upstream in `APIResponse` while the rest is bare. `client.info({ type })` unwraps consistently — do not double-unwrap. |
| **HIP-4 markets alias** | `client.hip4.markets` and `client.hip4.outcomes` hit the same upstream data. Pick one. |

---

## 7. Time and number encoding

- **Timestamps** — Hypedexer uses ISO strings without timezone (µs precision, e.g. `"2026-07-06T14:52:15"`) OR epoch milliseconds. Parse via `parseTimestamp(value, 'iso' | 'epochMs')` which returns `Date | null`. Returns `null` on the sentinel `"1970-01-01T00:00:00"` — do not treat this as valid.
- **Query time params** — pass `Date` / `number` / `string`. SDK encodes to ISO Z or epoch ms depending on the endpoint (§I bug #21).
- **Coins** — strings like `"BTC"`, `"@107"` (spot handle), `"xyz:AAPL"` (HIP-3 namespaced). Parse structure with `parseCoin(s): ParsedCoin`.

---

## 8. Escape hatches

**Raw REST call** when a new endpoint isn't yet wrapped:

```ts
const raw = await client.http.request<{ success: boolean; data: unknown[] }>({
  method: 'GET',
  path: '/new/endpoint',
  query: { limit: 10 },
})
```

You lose typing and envelope handling. Prefer opening an issue or a PR adding the wrapper.

**Custom `fetch`** (for tests / instrumentation):

```ts
const client = createClient({
  apiKey: 'test',
  fetch: myMockFetch as unknown as typeof fetch,
})
```

---

## 9. TypeScript notes

- Public types re-exported from the root entry: `Page`, `Single`, `Address`, `Coin`, `Hex`, `Side`, `Wei`, all per-resource params (`FillsListParams`, `LiquidationsRecentParams`, …), all row types (`Fill`, `Liquidation`, `Hip3Fill`, `LeaderboardByVolume`, `LeaderboardByPnl`, `LeaderboardByTrades`, …).
- Strict-mode aware. Designed against `--strict` + `--exactOptionalPropertyTypes`.
- Do NOT re-declare types with `interface Fill { … }` shadowing the SDK. Import them.

```ts
import type { Page, Fill, LeaderboardByVolume } from '@hypedexer/sdk'
```

---

## 10. Security posture — what YOU are responsible for

The SDK does not persist your key. It does not log it. But:

- **`apiKey` handling.** Source it from environment. Do NOT hardcode. Do NOT log the client (`util.inspect(client)` reveals it as a class field). Rotate the key on any suspected leak — the Hypedexer dashboard lets you generate a new one and revoke the old.
- **`baseUrl` is a trust boundary.** The SDK will send your `apiKey` to whatever host `baseUrl` names. Never accept `baseUrl` from user input — treat it as developer configuration only.
- **`err.rawBody` may echo hostile content** if `baseUrl` points somewhere untrusted. Slice or truncate before logging.
- **No response size cap.** A hostile upstream could return huge JSON and OOM the caller. Trust your `baseUrl`; set `timeoutMs` low enough that runaway requests abort.
- **`iterate()` has no global cap.** In production, cap by row count or wall-clock and `break`.
- **WS frames.** The underlying `ws` library defaults to 100 MB max message size — reasonable but not tuned in this SDK. If you use `client.ws` against untrusted upstreams, configure `ws` directly is not exposed; open an issue.

---

## 11. Full worked example

Fetching a user's recent perp fills and streaming their liquidations live:

```ts
import { createClient, HypedexerError, ValidationError, type Fill } from '@hypedexer/sdk'

const client = createClient({ apiKey: process.env.HYPEDEXER_API_KEY! })
const user = '0x3f6940CbddF3BCfe1B1B6290dcbbeBF7d9b55943' as `0x${string}`

async function main() {
  // 1) Recent perp fills — cursor-paginated iterate with a hard cap.
  const fills: Fill[] = []
  try {
    for await (const fill of client.fills.iterateUser(user, { timeRange: '24h' })) {
      fills.push(fill)
      if (fills.length >= 500) break
    }
  } catch (err) {
    if (err instanceof ValidationError) {
      console.error('bad params:', err.detail[0]?.msg)
      return
    }
    if (err instanceof HypedexerError) {
      console.error('api', err.status, err.message)
      return
    }
    throw err
  }

  console.log(`fetched ${fills.length} recent fills`)

  // 2) Stream liquidations for the same user.
  client.ws.on('liquidation', ({ items }) => {
    for (const l of items) {
      // narrow to items involving `user`
      console.log(l.time, l.coin, l.liq_dir, l.notional_total)
    }
  })
  client.ws.on('error', (err) => console.error('ws error:', err.name, err.message))

  await client.ws.connect()
  await client.ws.subscribe('liquidation')

  process.on('SIGINT', async () => {
    await client.ws.disconnect()
    process.exit(0)
  })
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
```

---

## References

- [Full README](https://github.com/Hypedexer/hypedexer-sdk#readme) — badges, install, quickstart, resource table, quirks reference.
- [`packages/sdk/CHANGELOG.md`](https://github.com/Hypedexer/hypedexer-sdk/blob/main/packages/sdk/CHANGELOG.md) — version history.
- [`examples/`](https://github.com/Hypedexer/hypedexer-sdk/tree/main/examples) — six runnable scripts.
- [Hypedexer docs](https://docs.hypedexer.com) — the underlying REST API.
