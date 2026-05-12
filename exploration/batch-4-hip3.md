# Batch 4 — HIP-3

Base URL: `https://api.hypedexer.com` — auth via `X-API-Key` header. Raw samples in `samples/batch-4/`.

## Summary (key SDK takeaways)

- **HIP-3 endpoints break the `APIResponse` envelope pattern**: every single endpoint returns either a **bare array** or a **bare object** matching the Pydantic models from swagger. No `success`/`data`/`total_count`/`next_cursor` wrapper. SDK must treat HIP-3 as a separate response-shape family.
- **No cursor pagination anywhere on HIP-3** — only `limit` + `offset`. No `x-next-cursor` / `has_more` headers either. SDK can expose a generic `paginate(offset, limit)` helper, but cannot do cursor-style streaming here.
- **Dates are inconsistent**: most timestamps are naive ISO (no TZ, no `Z`) like `"2026-05-11T16:46:36.299000"`; only `/hip3/overview.auction_end_at` uses `Z` suffix. No epoch-ms anywhere in HIP-3 responses (despite epoch-ms being accepted as `start`/`end` query input — see edges below).
- **Coin namespacing confirmed**: `<dex_id>:<TICKER>` format universally (`xyz:CL`, `cash:MSFT`, `xyz:SP500`, `xyz:XYZ100`). `dex_id` is always a short opaque lowercase string (8 known: `abcd`, `cash`, `flx`, `hyna`, `km`, `para`, `vntl`, `xyz`).
- **Booleans are real booleans** (`is_halted: false`, `is_growth_mode: false`, not 0/1).
- **Numerics are JSON numbers, not strings** (price, oi, fees, leverage). Funding rates use scientific notation (`6.25e-06`). Leverage is integer.
- **Validation gaps inherited from earlier batches**: `/hip3/leaderboard?by=bogus` returns 200 with default `volume` ordering (silent fallback). Limit caps are strictly enforced via 422 though (good).
- **404 shape** for unknown `dex_id`/`ticker`: `{"detail": "DEX 'NOTREAL' not found"}` — standard FastAPI shape, no envelope.
- Response time generally 0.8–3s; `/hip3/dexs` first call was 3.1s (cold cache likely).

## Cross-cutting observations

### Envelope: bare, not wrapped
Every HIP-3 endpoint tested returned the raw Pydantic model (or list). Examples:
- `/hip3/overview` → `Hip3Overview` object directly: `{total_dexs, total_assets, total_volume_24h, total_fees_24h, total_trades_24h, total_open_interest, auction_active, auction_price_hype, auction_end_at, next_auction_at}`
- `/hip3/dexs` → `DexRegistry[]` directly
- `/hip3/fills` → `Hip3Fill[]` directly
- `/hip3/users/{addr}/overview` → `UserHip3Overview` object directly

Implication: SDK should not unwrap `data`. The HIP-3 module needs a distinct response handler — or the SDK's generic call wrapper needs an "envelope mode" flag per endpoint.

### Date formats observed in HIP-3 responses
| Field | Format | Example |
|---|---|---|
| `DexRegistry.active_since` | naive ISO (sec) | `2026-05-11T16:45:11` |
| `AssetConfig.update_timestamp` | naive ISO (sec) | `2026-05-11T16:45:11` |
| `LiveSnapshot.last_update` | naive ISO (µs) | `2026-05-11T16:46:36.299000` |
| `OhlcvBar.time` | naive ISO (sec) | `2026-05-10T17:00:00` |
| `OracleStats1m.bucket` | naive ISO (sec) | `2026-05-10T16:54:00` |
| `Hip3Fill.time` | naive ISO (µs) | `2026-05-11T16:53:20.000999` |
| `Auction.start_time` / `end_time_scheduled` | naive ISO (sec) | `2026-05-12T07:00:00` |
| `AuctionHistory.time` | naive ISO (sec) | `2026-05-11T00:00:00` |
| `Hip3Overview.auction_end_at` | ISO with `Z` | `2026-05-12T07:00:00Z` ⚠ outlier |
| `TraderStats.last_update` | naive ISO (µs) | `2026-05-11T16:50:17.260000` |

SDK takeaway: assume **UTC for naive** timestamps; the `Z`-suffixed outlier on `auction_end_at` is the only explicit one. A single parsing helper that handles both is needed.

### Query input date format (for `start`/`end`)
Confirmed that **epoch-ms** is accepted on `/hip3/ohlcv` (`start=$(date +%s)000` worked). Did not exhaustively test ISO/bare-date here, but consistent with earlier batches.

### Coin / dex_id format
- `dex_id`: short lowercase opaque string. All collateral is `USDC`. `fee_share_pct` is `0.0–1.0` float (note `hyna` = `0.1111` — not always whole).
- `coin`: `"<dex_id>:<TICKER>"` everywhere, including in fills, ohlcv, snapshots, user/coins.
- `ticker` (on `AssetConfig`) === `coin` (it's the full prefixed form `xyz:CL`, not the bare `CL`).
- `symbol` is `<bare-ticker>/<collateral>` e.g. `CL/USDC` — display-only.
- `asset_id` is always `0` in the assets list returned — suspect this is a swagger leakage / placeholder rather than the real on-chain id. Investigate in batch follow-up.

### Numeric encoding
- Prices, sizes, notional, fees, OI, volume: JSON `number` (float). Some fields show heavy float-noise (`1.1698`, `0.020566`, `-0.00038934820000000004`).
- `total_staked_hype: 0.0` on every dex (feature not live / always zero).
- Funding rates: small floats, sometimes `6.25e-06` (scientific notation in JSON).
- `max_leverage`: integer.
- `oi_cap_usd`: float.
- `is_liquidation`: integer 0/1 (**inconsistent** with the boolean `is_halted` / `is_growth_mode` elsewhere — SDK should map this to bool).

### Pagination
Pure `offset` + `limit`. Confirmed `/hip3/dexs?limit=3&offset=5` returns the tail dexs as expected. No cursor anywhere. No `total` returned in body or headers (so client cannot know when to stop except by getting a short page).

### Validation
- Limit out-of-range → 422 with FastAPI detail array (confirmed on `/hip3/top-movers?limit=999`).
- Invalid `dex_id` path param → 404 `{"detail": "DEX '…' not found"}`.
- Invalid `ticker` path param → 404 `{"detail": "Asset '…' not found"}`.
- `/hip3/leaderboard?by=bogus` → **200, silent fallback** (returned same as `by=volume`). Validation gap.
- `/hip3/snapshots` with no params → 200, returns all live snapshots (effectively unfiltered list).

### Headers
`x-credit-balance`, `x-credit-cost: 1`, `x-process-time` (ms) on every response. No pagination/total/cursor headers.

## Per-endpoint

### Meta / discovery

**`GET /hip3/overview`** → bare `Hip3Overview` object.
Fields: `total_dexs:int`, `total_assets:int`, `total_volume_24h:float`, `total_fees_24h:float`, `total_trades_24h:int`, `total_open_interest:float`, `auction_active:bool`, `auction_price_hype:float`, `auction_end_at:string|null` (ISO+Z), `next_auction_at:string|null`. Sample: `samples/batch-4/02_overview.json`.

**`GET /hip3/dexs`** (`limit` 1–500, `offset`) → bare `DexRegistry[]`.
Fields per dex: `dex_id, name, deployer_address, oracle_updater (may be ""), collateral_asset, fee_share_pct:float, is_growth_mode:bool, active_since, total_staked_hype:float`. 8 dexs total. Sample: `01_dexs.json`, `24_dexs_offset.json`.

**`GET /hip3/dexs/{dex_id}`** → bare `DexRegistry` object. 404 on unknown. Sample: `06_dex_xyz.json`, `07_dex_invalid.json`.

**`GET /hip3/assets`** (`dex_id`, `search`, `limit` 1–1000, `offset`) → bare `AssetConfig[]`.
Fields: `dex_id, asset_id (all 0?), ticker (== coin, prefixed), symbol, max_leverage:int, oi_cap_usd:float, is_halted:bool, oracle_source ("hip3_node"), update_timestamp, fee_share_pct`. Sample: `03_assets.json`.

**`GET /hip3/assets/{ticker}`** → bare `AssetConfig`. Ticker accepts the prefixed form (`xyz:CL`). 404 on unknown. Sample: `08_asset_ticker.json`, `09_asset_invalid.json`.

### Auctions

**`GET /hip3/auctions`** (`status` open|closed|expired, `limit` 1–200, `offset`) → bare `Auction[]`.
Fields: `auction_id:int (epoch-sec), start_time, end_time_scheduled, start_price_hype:float, floor_price_hype:float, current_gas:float|null, winner_address:string|null, winning_bid_hype:float|null, winning_ticker:string|null, status, tx_hash:string|null`. Sample: `10_auctions.json`.

**`GET /hip3/auctions/current`** → bare `Auction` object (most recent). Sample: `11_auctions_current.json`.

**`GET /hip3/auctions/history`** (`dex_id`, `limit` 1–500, `offset`) → bare `AuctionHistory[]`.
**Different schema** from `/auctions`: `time, dex_id, coin, auction_id (string!), start_px, end_px, cleared_px, winner, sz:float, status, duration_seconds:int`. Note `auction_id` is `string` here vs `int` in `/auctions` — divergence to handle. Empty `dex_id`/`coin`/`winner` strings for expired auctions. Sample: `12_auctions_history.json`.

### Market data

**`GET /hip3/snapshots`** (`dex_id`, `coin`, both optional) → bare `LiveSnapshot[]`.
Fields: `dex_id, coin, current_mark_price, current_oracle_price, current_funding_rate, open_interest, volume_24h, fees_24h, trades_24h:int, total_volume_cumulative, total_fees_cumulative, is_halted, last_update`. Works with no params. Sample: `13_snapshots.json`, `25_snapshots_noparams.json`.

**`GET /hip3/top-movers`** (`limit` 1–100) → bare `LiveSnapshot[]` (same schema as `/snapshots`). Sample: `05_top_movers.json`.

**`GET /hip3/ohlcv`** (REQUIRED `coin`; `dex_id`, `start`, `end`, `limit` 1–2000 default 168) → bare `OhlcvBar[]`.
Fields: `time, dex_id, coin, open, high, low, close, volume, fees, trades:int`. ⚠ Observed `volume:0.0` and `fees:0.0` on every bar even when `trades > 0` — looks like backfill / oracle-only bars not aggregating trade volume. Investigate. Sample: `14_ohlcv.json`, `14b_ohlcv_window.json`.

**`GET /hip3/oracle/stats`** (REQUIRED `dex_id`; optional `asset_id`, `start`, `end`, `limit` 1–10000) → bare `OracleStats1m[]`.
Fields: `bucket, dex_id, asset_id:int, mark_open, mark_high, mark_low, mark_close, oracle_open, oracle_high, oracle_low, oracle_close, max_deviation_pct, avg_funding_rate, total_oi, trade_count:int`. Sample: `15_oracle_stats.json`.

### Fills / trading

**`GET /hip3/fills`** (`dex_id`, `coin`, `user`, `side`, `start`, `end`, `min_notional`, `limit`, `offset`) → bare `Hip3Fill[]`.
Fields: `time, dex_id, coin, user, side ("A"/"B"), px, sz, notional, fee, builder_fee_usd, is_liquidation:int(0/1), hash, tid:int`. `tid` is a numeric trade id (not the perp `epoch_ms:tid` cursor format). No cursor pagination. Sample: `16_fills.json`, `26_fills_window.json`.

**`GET /hip3/stats/traders`** (`dex_id`, `coin`, `limit` 1–500, `offset`) → bare `TraderStats[]`.
Fields: `dex_id, trader, coin, total_volume, total_fees, total_trades:int, pnl_realized, last_update`. Sample: `17_stats_traders.json`.

**`GET /hip3/leaderboard`** (`by` volume|pnl|trades|fees, `dex_id`, `limit` 1–200) → bare `LeaderboardEntry[]`.
Fields: `trader, total_volume, total_fees, total_trades:int, pnl_realized`. **`by=bogus` silently falls back to volume default** — SDK should validate enum client-side. Sample: `04_leaderboard_volume.json`, `18_lb_pnl.json`, `19_lb_bogus.json`.

### Users

**`GET /hip3/users/{address}/overview`** → bare `UserHip3Overview` object.
Fields: `trader, total_volume, total_fees, total_trades:int, pnl_realized, coins_traded:int, dexs_traded:int`. Sample: `20_user_overview.json`.

**`GET /hip3/users/{address}/fills`** (`coin`, `dex_id`, `start`, `end`, `limit`, `offset`) → bare `Hip3Fill[]` (same schema as `/hip3/fills`). Sample: `21_user_fills.json`.

**`GET /hip3/users/{address}/coins`** (`limit` 1–100) → bare `UserCoinStats[]`.
Fields: `dex_id, coin, total_volume, total_fees, total_trades:int, pnl_realized`. Sample: `22_user_coins.json`.

## Open questions

1. **`asset_id` always 0** on `/hip3/assets` listings — bug, placeholder, or genuinely "asset within a single-asset-per-dex model"? Affects `/hip3/oracle/stats?asset_id=` filter usefulness.
2. **`AuctionHistory.auction_id` is `string`** but `Auction.auction_id` is `int` — intentional? SDK should normalize.
3. **OHLCV `volume`/`fees` always 0** in samples despite non-zero `trades` — does HIP-3 OHLCV currently only track oracle/mark prices and not aggregate trade flow? Or is it a recent indexer issue?
4. **`is_liquidation` 0/1 int** on fills vs boolean `is_halted` elsewhere — confirm whether SDK should expose as bool uniformly.
5. **Naive ISO timestamps** — assume UTC. Confirm with backend team before generating timezone-aware Date wrappers in TS.
6. **No `total_count`** in body or headers anywhere on HIP-3 — paginated list consumers must page until short-page detection. Worth requesting backend add a `X-Total-Count` header.
7. **`hl_*` namespaces vs `xyz:CL` style**: previously seen perp coins like `@10` / `km:BTC` exist in batch 1. Confirm: does the perps `/fills` API now also include HIP-3 coins, or is the split strict between `/v1/fills` (perps) and `/hip3/fills` (HIP-3)? (Test in consolidation pass.)
