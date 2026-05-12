# Batch 9 — Priority Fees + /info + WebSocket

Final exploration batch. Covers the gossip auction endpoints, the unified
`POST /info` dispatcher, and a full WebSocket session.

Raw samples: `samples/batch-9/`
WS session log: `samples/batch-9/ws-session.jsonl` (129 lines)

---

## Summary — 5 key SDK takeaways

1. **WebSocket auth: only header-based works from Node/curl** — subprotocol auth
   (`Sec-WebSocket-Protocol: apikey.<key>`) is the only browser-usable form, but the
   server **does not echo the subprotocol back** in the 101 response, so strict
   clients (`ws`, browsers) reject the handshake with `1006 / Server sent no
   subprotocol`. Headers (`X-API-Key` or `Authorization: Bearer`) work cleanly.
   **This is an upstream bug the SDK should call out** — and means a browser SDK
   cannot use this WS as-is until the server is fixed. See "WebSocket / Auth"
   below.

2. **WS channels list discovered via `welcome` message**, not swagger:
   `completed_trades`, `fills_spot`, `recent_activity`, `liquidation`,
   `hip4_events`. Swagger only documents `completed_trades`. `recent_activity` is
   a multiplexed firehose that re-emits other channels with an added `stream`
   field. **Note channel name `liquidation` (singular)** — not `liquidations`.

3. **`POST /info` is a real, useful unified dispatcher**: it preserves the same
   envelope as the underlying REST endpoint (so the 3 envelope families still
   come through — spot endpoints still 500, e.g.), errors are *custom* and
   different from REST: `400 {"error":"Unknown type: ..."}` on bogus type,
   `422 {"detail":[...]}` (FastAPI shape) on missing required field, `400
   {"error":"JSON body required"}` on empty or non-JSON body. **SDK can map
   every REST helper through `/info` for free**, but it doesn't normalize
   envelopes, so the typed return remains per-action.

4. **Gossip auction returns IPv4 addresses for `winner`**, confirming the
   batch-2 finding. The `winner` query param accepts the same IPv4 string (not
   wallet). Slot range strictly 0-4 (422 on 5).

5. **WS subscriptions are silently permissive**: subscribing to a bogus type
   (`not_a_real_channel`) returns `subscription_added status:active` — no error.
   The SDK must validate channel names client-side. Also, **non-JSON frames
   crash the server handler**: `{"type":"error","message":"'str' object has no
   attribute 'get'"}` — leaky Python internals. SDK should never send non-JSON.

---

## Cross-cutting observations (final, all 9 batches)

### Final envelope/transport map

| Family | Envelope | Example endpoints | Notes |
|---|---|---|---|
| `APIResponse<T>` | `{success, message, data, total_count, execution_time_ms, next_cursor, has_more}` | Most endpoints, all `/info` for known types | The dominant shape |
| Bare object/array | raw payload | HIP-3 status, gossip-status (also wrapped in APIResponse — depends on endpoint), Funding, Vaults | Mixed within HIP-3 |
| `Hip4Envelope` | `{batch_id, events, has_more, ...}` | HIP-4 only | |
| **WS push** | `{type, count, data: [...]}` | All WS channels | Matches swagger docs |
| **WS control** | `{type: welcome\|subscription_added\|subscription_removed\|subscriptions_list\|error, ...}` | Method replies | New shape this batch |
| **Gossip APIResponse** | Standard `APIResponse<T>` | `/hip3/priority-fees/gossip/*` | |

### Error shapes (final)

| Source | Shape | Trigger |
|---|---|---|
| Plaintext (or HTML CF) | text | 401, 524 CF timeout |
| FastAPI `{"detail": "..."}` | `detail: string` | 404 not found |
| FastAPI `{"detail": [...]}` | `detail: ValidationError[]` | 422 query/body validation |
| ClickHouse leak | `{"detail":"Server error: HTTPDriver... ClickHouse error code 60..."}` | 500 on spot endpoints (broken table refs) |
| **`/info` custom** | `{"error": "..."}` | 400 on unknown type, empty/invalid body |
| **WS error** | `{"type":"error", "message":"..."}` | unknown method, raw string frame |

### Numbers + dates

- Funding rates and premiums return as **strings** in `/info currentFundingRates`
  (matching REST batch-7) — confirms the wei/large-amount stringification rule
  doesn't apply here; this is a Hyperliquid-style precision-preservation choice
  for floats. SDK should coerce to `Decimal` / `string` consistently.
- Dates: `priority-fees/gossip` and `/info` use `YYYY-MM-DDTHH:MM:SS[.ffffff]`
  (no timezone suffix) in most fields; `fillAnalytics.time_range.start` adds
  trailing `Z`. Confirms inconsistency.

### Transport — WS specifics affecting SDK design

- Server is Cloudflare-fronted (`server: cloudflare`, `cf-ray` headers). CF
  imposes a 100s idle disconnect by default; the server appears not to send
  WS-level pings, so **the SDK should send WS pings every ~30s** to keep idle
  channels alive.
- During 20s on `completed_trades`: ~37 push messages received (~1.85/s),
  payloads 1-16 trades each. **High-volume channel.**
- During ~5s on `fills_spot`: ~10 messages (~2/s).
- `liquidation` and `hip4_events`: zero pushes in their brief windows — low
  frequency; cannot characterize.
- Close-code on graceful `ws.close(1000, 'done')`: server returned **`1011
  /origin`** instead of echoing 1000. Server-side ungraceful — likely an
  asyncio error in the close handler. SDK reconnect logic should treat 1011 as
  benign-but-noteworthy.

---

## Priority Fees — gossip

Samples: `status.json`, `history.json`, `history-slot0.json`,
`history-slot5.json`, `history-winnerip.json`.

### `GET /hip3/priority-fees/gossip/status`

```
HTTP 200 — APIResponse<{ previous_winners: (string|null)[], current_auctions: Auction[] }>
```

`previous_winners` is a 5-tuple aligned to slot_id 0-4. `current_auctions` is an
array of 5 objects with `slotId, startTime, durationSeconds, startGas,
currentGas, endGas, winner, lastUpdate`.

Confirmed findings:
- **`winner` is IPv4** (e.g. `"18.180.228.50"`, `"54.64.2.87"`), not a wallet.
  Matches batch-2 observation.
- Slot model: 0-4 fixed (`slotId: 0..4`). 5 slots total.
- `lastUpdate` is recent (within seconds of request). Not stale despite
  ReplacingMergeTree.
- `endGas` is null while auction is live.

### `GET /hip3/priority-fees/gossip/history`

```
HTTP 200 — APIResponse<AuctionHistoryEntry[]>
total_count populated (49785), has_more: null, next_cursor: null
```

Each entry: `slotId, startTime, durationSeconds, startGas, endGas, winner,
snapshotTs`.

- Default order: descending by `snapshotTs` (newest first).
- Filter `slot_id=0..4` works; **`slot_id=5` → 422** (`Input should be less
  than or equal to 4`).
- Filter `winner=1.2.3.4` (IPv4) works — returns 0 if no match. Wallet-style
  values are valid syntactically but match nothing. **SDK type: `winner:
  string` (IPv4 expected)**.
- Same row repeats across snapshots (ReplacingMergeTree not deduped at read
  time): the same `slotId/startTime` appears multiple times with progressing
  `snapshotTs`. **Consumer must dedupe by `(slotId, startTime)`** if they
  want one row per auction.

### SDK recommendation

- Strongly type `winner` field as IP-like string and document the upstream
  Hyperliquid quirk.
- Surface a `dedupedHistory()` helper that collapses by `(slotId, startTime)`
  taking max `snapshotTs`.

---

## POST /info

Samples: `info-*.json`. 19 type tests + 4 error cases.

### Dispatcher behavior

- Same envelope as underlying REST handler. Compare:
  - `info-fills.json` → `APIResponse<Fill[]>` matches REST `/fills/*`.
  - `info-currentFundingRates.json` → bare `APIResponse<FundingRate[]>` —
    but the REST version was **bare array** in batch 7. **DIVERGENCE**: `/info`
    wraps things that REST returned bare. Confirms `/info` standardizes some
    payloads upward but not all (HIP-4 stays Hip4Envelope-shaped — not tested
    in this batch but likely consistent).
  - `info-vaultList.json` → `APIResponse<Vault[]>` — also wrapped (bare in
    REST per batch 7). **Same wrapping behavior.**
  - `info-gossipLiveStatus.json` ↔ REST `/hip3/priority-fees/gossip/status`:
    both `APIResponse`. Identical.
- **Spot endpoints still 500** through `/info` with the same ClickHouse leak:
  `info-spotTokenList.json` and `info-spotPairList.json` both return the
  identical "Unknown table expression identifier 'hl_spot_tokens'" message.
  Confirms spot is broken at the data layer, not the routing layer.

### Type-to-endpoint mapping (verified)

| `type` | Backing REST path | Envelope on `/info` |
|---|---|---|
| `fills` | `/fills/perp/?market=perp` | APIResponse |
| `recentFills` | `/fills/recent` | APIResponse |
| `fillsSummary` | `/fills/perp/summary` | **524 CF timeout** (also slow in REST) |
| `tradeHistory` | `/users/.../trade-history` | APIResponse |
| `accountOverview` | `/users/.../overview` | APIResponse |
| `fillAnalytics` | `/analytics/fills` | APIResponse |
| `bestTraders24h` | `/analytics/best-traders-24h` | APIResponse |
| `volume24h` | `/analytics/volume-24h` | APIResponse |
| `liqHistory` | `/liquidations/history` | APIResponse |
| `twapList` | `/twaps/` | **524 CF timeout** |
| `topBuilders` | `/builders/top` | APIResponse |
| `hip3Summary` | `/hip3/summary` | APIResponse |
| `hip3DexList` | `/hip3/dexs` | APIResponse |
| `hip3Snapshots` | `/hip3/snapshots` | APIResponse |
| `spotTokenList` | `/spot/tokens` | **500 ClickHouse** |
| `spotPairList` | `/spot/pairs` | **500 ClickHouse** |
| `currentFundingRates` | `/funding/current` | APIResponse (wrapped — REST is bare!) |
| `vaultList` | `/vaults/` | APIResponse (wrapped — REST is bare!) |
| `gossipLiveStatus` | `/hip3/priority-fees/gossip/status` | APIResponse |

### Error shapes

- `type:"notARealType"` → `400 {"error":"Unknown type: notARealType"}` —
  custom, NOT a FastAPI discriminator 422.
- `type:"fillsByTradeId"` without `tradeId` → `422 {"detail":[{"type":"missing","loc":["body","fillsByTradeId","tradeId"],"msg":"Field required","input":{"type":"fillsByTradeId"}}]}` — standard FastAPI body validation,
  but with the **discriminator value in `loc[1]`**. SDK error decoder should
  handle this `loc` shape.
- `{}` empty body → `400 {"error":"JSON body required"}`.
- `"notjson"` raw string → `400 {"error":"JSON body required"}` (same).
- Missing `Content-Type` is tolerated (curl sets it by default with `-d`).

### Recommendation: keep both `/info` and REST?

- **Yes, expose REST per-resource methods as the primary surface**, since they
  return the more granular envelopes and are individually documented.
- Add a thin `client.info(type, params)` escape hatch that mirrors Hyperliquid's
  own `info` convention — useful for users who already know that pattern.
- Internally the SDK can implement everything atop REST (no advantage to using
  `/info` since the response shape is identical).
- **Important**: `/info` wraps some REST-bare endpoints (`currentFundingRates`,
  `vaultList`) in `APIResponse`. The SDK's typed helpers should unwrap if used
  via `/info` to maintain consistent return types.

---

## WebSocket

Session: `samples/batch-9/ws-session.jsonl` (129 lines).
Scripts: `ws-test.mjs`, `ws-test2.mjs`, `ws-test3.mjs`, `ws-test4.mjs`.

### Handshake + auth

Three modes tested:

| Method | Result | Notes |
|---|---|---|
| `Sec-WebSocket-Protocol: apikey.<key>` (subprotocol) | **101 upgrade succeeds, but server omits `Sec-WebSocket-Protocol` in response** → strict clients reject (`1006 / Server sent no subprotocol`). Server sent no welcome since the client never confirms open. | Browsers + `ws` reject. Curl/permissive clients would accept. |
| `Authorization: Bearer <key>` | **Works** (tested twice; first attempt got 429 from rapid-fire, second succeeded after a wait) | |
| `X-API-Key: <key>` | **Works** | Used for the main session. |

**Rate limit**: rapid connection retries trigger HTTP 429 on the upgrade. The
SDK should backoff on 429 during connect.

**Welcome message** (first frame after open, no client message required):
```json
{
  "type": "welcome",
  "message": "WebSocket /ws ready",
  "available_methods": ["subscribe", "unsubscribe", "list_subscriptions"],
  "available_subscriptions": ["completed_trades","fills_spot","recent_activity","liquidation","hip4_events"]
}
```

**Critical**: this is the canonical channel list — use it as the source of
truth for the SDK's typed subscription enum (not swagger).

### Message protocol

#### Client → server

```ts
type Outbound =
  | { method: 'list_subscriptions' }
  | { method: 'subscribe'; subscription: Subscription }
  | { method: 'unsubscribe'; subscription: Subscription };

type Subscription =
  | { type: 'completed_trades'; user?: string }   // user is wallet 0x...
  | { type: 'fills_spot' }
  | { type: 'recent_activity' }
  | { type: 'liquidation' }
  | { type: 'hip4_events' };
```

User-scoping confirmed only on `completed_trades`. The active-subscription key
becomes `completed_trades|user=0xabc...` when scoped. Unsubscribing the
non-user variant does **not** remove the scoped one (verified — list shows
`completed_trades|user=...` still active after unsubscribing the global).

#### Server → client (control)

```ts
type Control =
  | { type: 'welcome'; message: string; available_methods: string[]; available_subscriptions: string[] }
  | { type: 'subscriptions_list'; active_subscriptions: string[] }
  | { type: 'subscription_added'; subscription: { type: string; user?: string; status: 'active' }; active_subscriptions: string[] }
  | { type: 'subscription_removed'; subscription: { type: string; status: 'inactive' }; active_subscriptions: string[] }
  | { type: 'error'; message: string };
```

#### Server → client (data push)

```ts
type Push = { type: ChannelName; count: number; data: any[] };
```

- `count` matches `data.length`.
- `recent_activity` items include an additional `stream` field
  (`"completed_trades"`, presumably also `"fills_spot"`/`"liquidation"`) — it's
  a multiplexed firehose.

### Channels observed

| Channel | Frequency observed | Payload type |
|---|---|---|
| `completed_trades` | ~1.85 msgs/s (37 in 20s) | Same shape as REST `tradeHistory` |
| `fills_spot` | ~2 msgs/s | Spot-style fills (`coin: "@107"`, `coin_meaning: "HYPE"`) — note: ONLY way to get spot data since REST spot is 500! |
| `recent_activity` | ~2 msgs/s | Multiplexed; each item has `stream` field |
| `liquidation` | 0 in test window | Singular — note the channel name |
| `hip4_events` | 0 in test window | HIP-4 events likely follow Hip4Envelope shape |

**`fills_spot` is the only working spot data source** — REST spot endpoints
500. SDK spot integration should rely on this WS channel.

### Errors / edge cases

- `bogus_method` → `{"type":"error","message":"unknown method: bogus_method"}` ✓
- `{"method":"subscribe","subscription":{"type":"not_a_real_channel"}}` →
  **silently accepted** as `subscription_added`. No data ever flows. SDK must
  validate types client-side.
- Sending a raw string frame (not JSON) →
  `{"type":"error","message":"'str' object has no attribute 'get'"}` (Python
  internals leak — upstream bug).
- Graceful close `ws.close(1000, 'done')` → server responds with **`1011
  /origin`** instead of `1000`. Cosmetic, but SDK reconnect logic should
  classify 1011 here as "expected after client-initiated close" if a close was
  pending.

### SDK design implications

1. **Auto-reconnect with exponential backoff** (1s → 2s → 4s → 8s, capped 30s,
   reset on stable connection >60s). Treat 1011/1006 as retryable; 4xx upgrade
   responses (401, 429) as auth/rate-limit — surface to caller.
2. **Heartbeat**: send WS ping every 30s (no app-layer ping protocol; rely on
   RFC6455 ping frames — `ws.ping()` in Node, native in browsers).
3. **Subscription resync on reconnect**: keep client-side `Set<string>` of
   active subscriptions; on reopen, replay all `subscribe` messages.
4. **Typed dispatcher**: parse incoming `type` field, route via a discriminated
   union. Strongly type each channel's `data[]` element using REST type
   definitions where shapes match (e.g. `completed_trades` ≡ REST
   `tradeHistory` row).
5. **Client-side channel validation**: maintain a frozen `Set` of valid types
   (from `welcome.available_subscriptions`) and reject bogus subscribes locally
   to avoid the silent-accept trap.
6. **Browser support is broken** until server fixes subprotocol echo. SDK
   should expose a `transport` option that throws on browser environments with
   a clear message until then.

---

## Open questions

1. Will the server fix subprotocol echo (`Sec-WebSocket-Protocol` in 101
   response) to enable browser WS auth? **Blocker for browser SDK.**
2. Are there other undocumented WS channels (e.g. `funding_rates`, `vault_*`,
   `gossip_status`)? Welcome only lists 5; needs server-side confirmation.
3. `recent_activity` — what's the complete list of streams it multiplexes?
   Sampling only saw `completed_trades` and `fills_spot` items in our window.
4. Does `liquidation` accept a `user` filter like `completed_trades`?
5. WS rate limits beyond the upgrade 429 — is there a per-connection or
   per-key throttle? Not observed in 1-minute session.
6. `/info` dispatcher — is there a way to enumerate the 76 supported types
   via the API itself, or is the swagger the only source?
7. `priority-fees/gossip/history` `winner` filter: any way to map IP → wallet
   server-side, or is that purely client-side join?
8. Spot endpoints (REST + `/info`) broken at ClickHouse layer — is there an
   ETA? `fills_spot` WS channel is currently the only spot data source.
