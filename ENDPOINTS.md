# `@hypedexer/sdk` — Endpoint Inventory Matrix

Every endpoint observed across the 9 exploration batches, with the metadata the implementer needs. When all rows are checked off in `src/resources/`, the SDK is feature-complete.

Legend:
- **Envelope**: `API` = `APIResponse<T>`, `Bare` = bare object/array, `Hip4` = `Hip4Envelope<T>`.
- **Pagination**: `cursor` (`<epoch_ms>:<tid>`), `offset` (offset+limit), `time-window` (decrement `endTime`), `none` (single record), `none-list` (full list returned in one call).
- **Time params**: `iso-snake` (`start_time`/`end_time` ISO), `iso-bare` (`start`/`end` ISO), `epoch-camel` (`startTime`/`endTime` epoch-ms).
- **Cap**: real server-enforced cap on `limit` (422 above). `none` means no server cap — SDK enforces.
- ✅ = working as expected, ⚠ = known bug/gotcha, ❌ = broken upstream.

## Perp fills (batch-1) — `src/resources/fills.ts`

| Method + Path | Envelope | Pagination | Time params | Cap | Required | Known issues | /info type |
|---|---|---|---|---|---|---|---|
| GET `/fills/` | API | cursor | iso-snake | 1000 | — | ✅ tid 10^15 watch; coin filter permissive | `fills` |
| GET `/fills/recent` | API | cursor | iso-snake | 1000 | — | ✅ 24h cache; faster | `recentFills` |
| GET `/fills/user/{user_address}` | API | cursor | iso-snake (+`time_range`) | 1000 | `user_address` | ✅ omits startPosition/dir/closedPnl | — |
| GET `/fills/count` | API | none | — | — | — | ✅ data is object not array; envelope `execution_time_ms` null | — |
| GET `/fills/spot/` | API | offset | iso-snake | 1000 | — | ⚠ `total_count` = page size; cursor fields null | — |
| GET `/fills/spot/user/{user_address}` | API | offset | iso-snake | 1000 | `user_address` | ⚠ same as `/fills/spot/` | — |

## Analytics (batch-2) — `src/resources/analytics.ts`

| Method + Path | Envelope | Pagination | Time params | Cap | Required | Known issues | /info type |
|---|---|---|---|---|---|---|---|
| GET `/analytics/fills/stats` | API | none | — | hours: 168 | — | ✅ optional `coin` echoed | `fillAnalytics` |
| GET `/analytics/priority-fees/stats` | API | none | — | hours: 168 | — | ✅ | — |
| GET `/analytics/priority-fees/chart/daily` | API | none-list | iso-snake | — | — | ✅ default ~29d lookback | — |
| GET `/analytics/priority-fees/gossip/leaderboard` | API | none-list | — | limit: 200 | — | ⚠ `address` is IPv4 → rename `nodeIp` | — |
| GET `/analytics/liquidations/stats` | API | none | — | days: 30 | — | ⚠ `top_token_liquidated` ignores `coin` filter | — |

## Overview (batch-2) — `src/resources/overview.ts`

| Method + Path | Envelope | Pagination | Time params | Cap | Required | Known issues | /info type |
|---|---|---|---|---|---|---|---|
| GET `/overview/top-traders-24h` | API | none-list | — | — | — | ⚠ `sort=bogus` silent fallback | `bestTraders24h` |
| GET `/overview/total-fees-24h` | API | none | — | — | — | ✅ | — |
| GET `/overview/active-traders-24h` | API | none | — | — | — | ✅ slow (~7.5s); cache | — |
| GET `/overview/trading-volume-24h` | API | none | — | — | — | ✅ slow (~3.2s) | `volume24h` |
| GET `/overview/total-fills-24h` | API | none | — | — | — | ✅ slow (~2.5s) | — |
| GET `/overview/daily-volume-10d` | API | none-list | — | — | — | ✅ optional `user` filter | — |
| GET `/overview/daily-pnl-10d` | API | none-list | — | — | — | ✅ global-only, by coin | — |
| GET `/overview/coin-distribution` | API | none-list | — | — | `user` | ⚠ bad addr returns 200 empty (no 422) | — |

## Users (batch-3) — `src/resources/users.ts`

| Method + Path | Envelope | Pagination | Time params | Cap | Required | Known issues | /info type |
|---|---|---|---|---|---|---|---|
| GET `/users/{user}/overview` | API | none | iso-snake | — | path `user` | ⚠ bad addr → 200 zeroed; `last_activity` 1970 sentinel; `total_priority_gas` always 0 | `accountOverview` |
| GET `/users/{user}/performance` | API | none | iso-snake | — | path `user` | ⚠ `avg_holding_time_s` inflated | — |
| GET `/users/{user}/coins` | API | offset | iso-snake | 100 | path `user` | ✅ | — |
| GET `/users/leaderboard` | API | none-list | — | hours: 168; limit: 100 | `by` | ✅ polymorphic on `by`; 422 on bogus (good) | — |
| GET `/users/active` | API | offset | — | hours: 168; limit: 100 | — | ✅ | — |

## Completed trades (batch-3) — `src/resources/completed-trades.ts`

| Method + Path | Envelope | Pagination | Time params | Cap | Required | Known issues | /info type |
|---|---|---|---|---|---|---|---|
| GET `/completed-trades/` | API | offset | iso-snake | **none → SDK 100** | — | ⚠ no server cap (70MB risk); `sort_by=bogus` silent fallback; `execution_time_ms` null | — |
| GET `/completed-trades/summary` | API | none | iso-snake | — | — | ⚠ `execution_time_ms` null; `avg_pnl_pct` % units; `avg_duration_s` inflated | `fillsSummary` |
| GET `/completed-trades/{trade_id}/fills` | API | none-list | — | — | path `trade_id` (URL-encode `:`) | ⚠ `feeUsdc`/`typeTrade` shifted keys (drop); bogus id → 200 empty | `fillsByTradeId` |

## Liquidations (batch-3) — `src/resources/liquidations.ts`

| Method + Path | Envelope | Pagination | Time params | Cap | Required | Known issues | /info type |
|---|---|---|---|---|---|---|---|
| GET `/liquidations/` | API | cursor | iso-snake | 100 | — | ⚠ `order=asc` corrupt cursor → SDK refuses iterate asc; bogus cursor silently first-page | `liqHistory` |
| GET `/liquidations/recent` | API | cursor | iso-snake | 100 | — | ✅ 24h cache | — |

## HIP-3 (batch-4) — `src/resources/hip3.ts` — bare envelope

| Method + Path | Envelope | Pagination | Time params | Cap | Required | Known issues | /info type |
|---|---|---|---|---|---|---|---|
| GET `/hip3/overview` | Bare | none | — | — | — | ⚠ `auction_end_at` Z-suffixed (outlier) | `hip3Summary` |
| GET `/hip3/dexs` | Bare | offset | — | 500 | — | ✅ | `hip3DexList` |
| GET `/hip3/dexs/{dex_id}` | Bare | none | — | — | path `dex_id` | 404 `{detail: string}` | — |
| GET `/hip3/assets` | Bare | offset | — | 1000 | — | ⚠ `asset_id` always 0 | — |
| GET `/hip3/assets/{ticker}` | Bare | none | — | — | path `ticker` (prefixed) | 404 `{detail: string}` | — |
| GET `/hip3/auctions` | Bare | offset | — | 200 | — | ✅ | — |
| GET `/hip3/auctions/current` | Bare | none | — | — | — | ✅ | — |
| GET `/hip3/auctions/history` | Bare | offset | — | 500 | — | ⚠ `auction_id` STRING here (vs int on `/auctions`); empty strings on expired | — |
| GET `/hip3/snapshots` | Bare | none-list | — | — | — | ✅ | `hip3Snapshots` |
| GET `/hip3/top-movers` | Bare | none-list | — | 100 | — | ✅ same shape as snapshots | — |
| GET `/hip3/ohlcv` | Bare | offset | iso-bare/epoch | 2000 (default 168) | `coin` | ⚠ `volume`/`fees` always 0 | — |
| GET `/hip3/oracle/stats` | Bare | offset | iso-bare/epoch | 10000 | `dex_id` | ✅ `asset_id` filter useless (always 0) | — |
| GET `/hip3/fills` | Bare | offset | iso-bare/epoch | — | — | ✅ `tid` is plain int (no cursor format) | — |
| GET `/hip3/stats/traders` | Bare | offset | — | 500 | — | ✅ | — |
| GET `/hip3/leaderboard` | Bare | none-list | — | 200 | `by` | ⚠ `by=bogus` silent fallback | — |
| GET `/hip3/users/{address}/overview` | Bare | none | — | — | path `address` | ✅ | — |
| GET `/hip3/users/{address}/fills` | Bare | offset | iso-bare/epoch | — | path `address` | ✅ | — |
| GET `/hip3/users/{address}/coins` | Bare | none-list | — | 100 | path `address` | ✅ | — |

## HIP-4 (batch-5) — `src/resources/hip4.ts` — Hip4 envelope

| Method + Path | Envelope | Pagination | Time params | Cap | Required | Known issues | /info type |
|---|---|---|---|---|---|---|---|
| GET `/hip4/markets` | Hip4 | offset | — | 1000 | — | ⚠ `coin=` silently ignored — omit from typed surface | — |
| GET `/hip4/outcomes` | Hip4 | offset | — | 1000 | — | ✅ alias of `/hip4/markets` | — |
| GET `/hip4/questions` | Hip4 | offset | — | 1000 | — | ✅ `description` pipe-delimited (parser helper) | — |
| GET `/hip4/outcome-tokens` | Hip4 | offset | — | 1000 | — | ✅ `coin=@N` filter works | — |
| GET `/hip4/fills` | Hip4 | offset | iso-bare (incl `Z`) | 1000 | — | ✅ `feeToken` "USDH" or "+NNN"; `time_ms` epoch | — |
| GET `/hip4/fees` | Hip4 | offset | iso-bare | 1000 | — | ✅ `date` YYYY-MM-DD | — |
| GET `/hip4/settlements` | Hip4 | offset | iso-bare | 1000 | — | ⚠ duplicates (`outcome_id, nonce`) | — |
| GET `/hip4/fee-scales` | Hip4 | none-list | — | — | — | ❌ `status: not_yet_live` today | — |
| GET `/hip4/analytics` | Hip4 | offset | iso-bare | 2000 | — | ✅ `coin=290,291` (int csv) normalized | — |
| GET `/hip4/user-actions` | Hip4 | offset | — | 1000 | — | ❌ `status: not_yet_live`; validation bypassed | — |

## Builders (batch-6) — `src/resources/builders.ts`

| Method + Path | Envelope | Pagination | Time params | Cap | Required | Known issues | /info type |
|---|---|---|---|---|---|---|---|
| GET `/builders/top` | API | offset | — | 100 | — | ⚠ `sort=bogus` silent fallback | `topBuilders` |
| GET `/builders/stats` | API | none | — | — | — | ✅ `variations.*Pct` can be null | — |
| GET `/builders/stats/all-timeframes` | API | none | — | — | — | ✅ keyed by timeframe | — |
| GET `/builders/{addr}/stats` | API | none | — | — | path `addr` | ✅ unknown addr → 200 with `builderName: null` | — |
| GET `/builders/{addr}/users` | API | offset | — | — | path `addr` | ✅ | — |
| GET `/builders/list` | API | none-list | — | — | — | ✅ 640 builders returned in one call | — |

## TWAPs (batch-6) — `src/resources/twaps.ts`

| Method + Path | Envelope | Pagination | Time params | Cap | Required | Known issues | /info type |
|---|---|---|---|---|---|---|---|
| GET `/twaps/` | API | offset | — | 500 | — | ⚠ status enum incomplete (error: prefix); startTime 1970 sentinel | `twapList` |
| GET `/twaps/stats` | API | none | — | hours: ? | — | ⚠ `byStatus` exposes error-prefix strings | — |
| GET `/twaps/user/{addr}` | API | offset | — | 200 | path `addr` | ✅ adds `executionPct` | — |
| GET `/twaps/{twap_id}` | API | none | — | — | path `id` | ⚠ 404 `{detail: string}`; composite shape | — |
| GET `/twaps/{twap_id}/fills` | API | offset | — | 1000 | path `id` | ✅ reuses Fill shape; `hash` all-zero; `total_count` populated | — |

## Funding (batch-7) — `src/resources/funding.ts` — bare envelope

| Method + Path | Envelope | Pagination | Time params | Cap | Required | Known issues | /info type |
|---|---|---|---|---|---|---|---|
| GET `/funding/predictedFundings` | Bare | none-list | — | — | — | ✅ ~230 entries; 47 zero-rate | `currentFundingRates` (⚠ /info wraps in API) |
| GET `/funding/fundingHistory` | Bare | time-window | epoch-camel | 5000 | `coin` | ✅ string-encoded rate/premium | — |
| GET `/funding/userFunding` | Bare | time-window | epoch-camel | 5000 | `user` | ⚠ empty for every tested user (shape unverified) | — |

## Vaults (batch-7) — `src/resources/vaults.ts` — bare envelope

| Method + Path | Envelope | Pagination | Time params | Cap | Required | Known issues | /info type |
|---|---|---|---|---|---|---|---|
| GET `/vaults/vaultDetails` | Bare | none | epoch-camel | — | `vaultAddress` | ⚠ `portfolio[]` → rename `leaderCommissionHistory`; zero-addr 404 | — |
| GET `/vaults/vaultSummaries` | Bare | offset | — | 5000 | — | ✅ default sort: followerCount desc; `includeClosed` flag | `vaultList` (⚠ /info wraps in API) |
| GET `/vaults/userVaultEquities` | Bare | time-window | epoch-camel | — | `user` | ⚠ empty for tested users (shape unverified) | — |
| GET `/vaults/dailySnapshots` | Bare | time-window | epoch-camel | 5000 | `vaultAddress` | ✅ adds `day` field | — |
| GET `/vaults/equitySnapshots` | Bare | time-window | epoch-camel | 5000 | `vaultAddress` | ✅ higher-frequency (no `day`) | — |
| GET `/vaults/vaultLedger` | Bare | time-window | epoch-camel | 5000 | `vaultAddress` | ✅ SDK synthesizes `kind: deposit/withdraw` | — |

## Spot (batch-7) — `src/resources/spot.ts` — **all broken**

| Method + Path | Envelope | Pagination | Time params | Cap | Required | Known issues | /info type |
|---|---|---|---|---|---|---|---|
| GET `/spot/tokens` | Bare? | offset | — | — | — | ❌ 500 ClickHouse leak — SDK throws ServerError | `spotTokenList` |
| GET `/spot/pairs` | Bare? | offset | — | — | — | ❌ 500 ClickHouse leak | `spotPairList` |
| GET `/spot/auctions/live` | Bare? | none-list | — | — | — | ❌ 500 ClickHouse leak | — |
| GET `/spot/auctions/hist` | Bare? | offset | — | — | — | ❌ 500 ClickHouse leak | — |

**Workaround:** use the WS `fills_spot` channel for spot fills. Token/pair metadata has no current workaround.

## EVM (batch-8) — `src/resources/evm.ts`

| Method + Path | Envelope | Pagination | Time params | Cap | Required | Known issues | /info type |
|---|---|---|---|---|---|---|---|
| GET `/evm/stats` | API | none | — | — | — | ✅ ~28ms | — |
| GET `/evm/stats/daily` | API | none-list | — | days: 365 | — | ✅ | — |
| GET `/evm/blocks` | API | offset | iso-snake | 1000 | — | ✅ `start_block`/`end_block` inclusive range | — |
| GET `/evm/blocks/{block_number}` | API | none | — | — | path `block_number` | 404 `{detail: string}` | — |
| GET `/evm/blocks/{block_number}/transactions` | API | offset | — | 1000 | path `block_number` | ✅ | — |
| GET `/evm/transactions` | API | offset | iso-snake | 1000 | — | ⚠ `tx_hash`/`from_addr` empty strings; epoch-ms silently ignored on time | — |
| GET `/evm/logs` | API | offset | iso-snake | 1000 | — | ⚠ topics empty string when absent | — |
| GET `/evm/ledger/transfers` | API | offset | iso-snake | 1000 | — | ⚠ `action_type=bogus` silent empty; `block_height` always 0 | — |
| GET `/evm/bridge/events` | API | offset | iso-snake | 1000 | — | ⚠ `event_type=bogus` silent empty; nonce int53 edge | — |
| GET `/evm/user/{address}/ledger-events` | API | offset | iso-snake | 1000 | path `address` | ✅ enum strictly enforced; multi `event_type` supported | — |
| GET `/evm/user/{address}/ledger-summary` | API | none-list | — | — | path `address` | ✅ | — |
| GET `/evm/hip3/backstop/transfers` | API | offset | iso-snake | 1000 | — | ⚠ empty in current data | — |
| GET `/evm/hip3/backstop/transfers-summary` | API | none-list | — | — | — | ⚠ empty in current data | — |
| GET `/evm/hip3/backstop/health` | API | none-list | — | — | — | ✅ 6 active dexes (subset of 8) | — |
| GET `/evm/hip3/backstop/{dex}/health` | API | none | — | — | path `dex` | 404 `{detail: string}` on unknown | — |
| GET `/evm/hip3/backstop/{dex}/fills` | API | offset | iso-snake | 1000 | path `dex` | ⚠ unknown dex → 200 empty (inconsistent with `/health`); simplified Fill shape | — |

## Priority fees gossip (batch-9) — `src/resources/priority-fees.ts`

| Method + Path | Envelope | Pagination | Time params | Cap | Required | Known issues | /info type |
|---|---|---|---|---|---|---|---|
| GET `/hip3/priority-fees/gossip/status` | API | none | — | — | — | ✅ `winner` is IPv4 | `gossipLiveStatus` |
| GET `/hip3/priority-fees/gossip/history` | API | offset | iso-snake | — | — | ⚠ slot 0..4 (422 on 5); duplicate rows by snapshot → SDK `dedupedHistory()` | — |

## /info dispatcher (batch-9) — `src/resources/info.ts`

| Method + Path | Notes |
|---|---|
| POST `/info` | Discriminated dispatcher. Returns same envelope as backing REST handler **EXCEPT**: wraps `currentFundingRates` and `vaultList` in `APIResponse<T>` (REST is bare). SDK unwraps these two for return-type parity. Error shapes: 400 `{error: string}` (custom), 422 `{detail: [...]}` (FastAPI; `loc[1]` = discriminator value). |

## WebSocket (batch-9) — `src/transport/ws.ts`

| Endpoint | Notes |
|---|---|
| WS `wss://api.hypedexer.com/ws` | Auth: `X-API-Key` or `Authorization: Bearer` header (subprotocol broken — browser unsupported). Channels: `completed_trades` (user-scopable), `fills_spot`, `recent_activity` (multiplexed `stream`), `liquidation`, `hip4_events`. Push shape `{type, count, data: []}`. Control frames: welcome, subscriptions_list, subscription_added, subscription_removed, error. Heartbeat: SDK ping every 25s (CF disconnects ~100s). Reconnect: exp-backoff 1s→60s, resub on reconnect. Close 1011 on graceful = transient. 429 on rapid handshakes. |

---

## Totals

- **REST endpoints**: 88 (6 fills + 5 analytics + 8 overview + 5 users + 3 completed-trades + 2 liquidations + 18 hip3 + 10 hip4 + 6 builders + 5 twaps + 3 funding + 6 vaults + 4 spot + 16 evm + 2 gossip) — `/hip4/markets` and `/hip4/outcomes` count as 2 distinct endpoints (aliases).
- **Dispatcher**: 1 (`POST /info`, verified 19 types).
- **WebSocket**: 5 channels on 1 endpoint.

**Grand total surface area**: 94 REST + 1 dispatcher + 5 WS channels = 100 entry points.

When every row in this matrix is implemented in `src/resources/` (with the bug column either normalized or documented) and `src/transport/ws.ts` ships the 5 channels with reconnect + heartbeat + allowlist, v0.1.0 is releasable.
