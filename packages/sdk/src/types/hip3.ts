import type { TimeInput } from '../time/index.js'
import type { Address, Coin, Hex, Side } from './common.js'

/**
 * Aggregate stats from `/hip3/overview` (bare object).
 *
 * Field names mirror the upstream snake_case wire shape. Note the outlier:
 * `auction_end_at` is the only HIP-3 timestamp emitted with a `Z` suffix —
 * every other HIP-3 timestamp is naive ISO (no TZ). Use
 * `parseTimestamp(value, 'iso')` either way.
 */
export interface Hip3Overview {
  readonly total_dexs: number
  readonly total_assets: number
  readonly total_volume_24h: number
  readonly total_fees_24h: number
  readonly total_trades_24h: number
  readonly total_open_interest: number
  readonly auction_active: boolean
  readonly auction_price_hype: number
  /** ISO with `Z`, microsecond precision (HIP-3 outlier). */
  readonly auction_end_at: string | null
  /** ISO with `Z`, microsecond precision when present. */
  readonly next_auction_at: string | null
}

/**
 * A single dex registry row from `/hip3/dexs` (bare list item).
 *
 * Currently `total_staked_hype` is always `0.0` (feature not live upstream).
 */
export interface DexRegistry {
  readonly dex_id: string
  readonly name: string
  readonly deployer_address: Address
  /** May be the empty string `""` when the deployer hasn't set an updater. */
  readonly oracle_updater: Address | ''
  readonly collateral_asset: 'USDC' | string
  /** Float in `[0, 1]`. */
  readonly fee_share_pct: number
  readonly is_growth_mode: boolean
  /** ISO no TZ, second precision. Use `parseTimestamp(value, 'iso')` for a Date. */
  readonly active_since: string
  /** Always `0.0` today — feature not wired. */
  readonly total_staked_hype: number
}

/**
 * A single asset config row from `/hip3/assets` (bare list item).
 *
 * **PLAN.md §I bug #6**: `asset_id` is always `0` in the assets listing today.
 * Treat as a placeholder; do not use as a join key. Same caveat on
 * `/hip3/oracle/stats?asset_id=` which silently ignores the filter.
 */
export interface AssetConfig {
  readonly dex_id: string
  /** PLAN.md §I bug #6 — always 0 today, do not use as a join key. */
  readonly asset_id: number
  /** Prefixed coin (e.g. `"xyz:CL"`). Same as `coin` on other resources. */
  readonly ticker: Coin
  /** Display-only `<bare-ticker>/<collateral>` (e.g. `"CL/USDC"`). */
  readonly symbol: string
  readonly max_leverage: number
  readonly oi_cap_usd: number
  readonly is_halted: boolean
  readonly oracle_source: 'hip3_node' | string
  /** ISO no TZ, second precision. */
  readonly update_timestamp: string
  /** Float in `[0, 1]`. */
  readonly fee_share_pct: number
}

/** Allowed `status` filter for `/hip3/auctions`. */
export type AuctionStatus = 'open' | 'closed' | 'expired'

/** Runtime allowlist for {@link AuctionStatus} enum validation. */
export const AUCTION_STATUSES = ['open', 'closed', 'expired'] as const

/**
 * A single auction row from `/hip3/auctions` and `/hip3/auctions/current`
 * (bare list item / object).
 *
 * Note: this shape differs from {@link AuctionHistory}, which uses different
 * field names AND types (`auction_id` is a string there, not a number).
 */
export interface Auction {
  /** Epoch seconds. */
  readonly auction_id: number
  /** ISO no TZ, second precision. */
  readonly start_time: string
  /** ISO no TZ, second precision. */
  readonly end_time_scheduled: string
  readonly start_price_hype: number
  readonly floor_price_hype: number
  readonly current_gas: number | null
  readonly winner_address: Address | null
  readonly winning_bid_hype: number | null
  readonly winning_ticker: Coin | null
  readonly status: AuctionStatus
  readonly tx_hash: Hex | null
}

/**
 * A single row from `/hip3/auctions/history` (bare list item).
 *
 * **Different schema** from {@link Auction}: `auction_id` is a **string** here
 * (vs `number` on `/auctions`) — divergence from the live `Auction` shape.
 * `dex_id` / `coin` / `winner` are empty strings on expired auctions.
 */
export interface AuctionHistory {
  /** ISO no TZ, second precision. */
  readonly time: string
  /** Empty string on expired/unwon auctions. */
  readonly dex_id: string | ''
  /** Empty string on expired/unwon auctions. */
  readonly coin: Coin | ''
  /** STRING here, not the int form returned by `/hip3/auctions`. */
  readonly auction_id: string
  readonly start_px: number
  readonly end_px: number
  readonly cleared_px: number
  /** Empty string on expired/unwon auctions. */
  readonly winner: Address | ''
  readonly sz: number
  readonly status: AuctionStatus
  readonly duration_seconds: number
}

/**
 * A live market snapshot from `/hip3/snapshots` and `/hip3/top-movers`
 * (same row shape — bare list item).
 */
export interface LiveSnapshot {
  readonly dex_id: string
  readonly coin: Coin
  readonly current_mark_price: number
  readonly current_oracle_price: number
  readonly current_funding_rate: number
  readonly open_interest: number
  readonly volume_24h: number
  readonly fees_24h: number
  readonly trades_24h: number
  readonly total_volume_cumulative: number
  readonly total_fees_cumulative: number
  readonly is_halted: boolean
  /** ISO no TZ, microsecond precision. */
  readonly last_update: string
}

/**
 * One OHLCV bar from `/hip3/ohlcv` (bare list item).
 *
 * **PLAN.md §I bug #7**: `volume` and `fees` are observed as `0.0` on every
 * bar today, even when `trades > 0` — the indexer is not aggregating
 * trade-flow into these fields. Field is preserved on the typed surface for
 * forward compatibility; do not rely on it for v0.1.
 */
export interface OhlcvBar {
  /** ISO no TZ, second precision (hourly buckets). */
  readonly time: string
  readonly dex_id: string
  readonly coin: Coin
  readonly open: number
  readonly high: number
  readonly low: number
  readonly close: number
  /** PLAN.md §I bug #7 — always 0 today. */
  readonly volume: number
  /** PLAN.md §I bug #7 — always 0 today. */
  readonly fees: number
  readonly trades: number
}

/**
 * One oracle-vs-mark 1-minute bucket from `/hip3/oracle/stats` (bare list
 * item). Note `asset_id` is the same placeholder zero as on
 * {@link AssetConfig} (PLAN.md §I bug #6), so filtering by `asset_id` on
 * the request is effectively a no-op.
 */
export interface OracleStats1m {
  /** ISO no TZ, second precision. */
  readonly bucket: string
  readonly dex_id: string
  /** PLAN.md §I bug #6 — always 0. */
  readonly asset_id: number
  readonly mark_open: number
  readonly mark_high: number
  readonly mark_low: number
  readonly mark_close: number
  readonly oracle_open: number
  readonly oracle_high: number
  readonly oracle_low: number
  readonly oracle_close: number
  readonly max_deviation_pct: number
  readonly avg_funding_rate: number
  readonly total_oi: number
  readonly trade_count: number
}

/**
 * A single HIP-3 fill row from `/hip3/fills` and `/hip3/users/{addr}/fills`
 * (bare list item).
 *
 * `tid` is a plain integer trade id (NOT the perp `<epoch_ms>:<tid>` cursor
 * format — see PLAN §D.1). `is_liquidation` is wire-int `0 | 1` upstream;
 * the SDK preserves the raw value (see PLAN §F.4).
 */
export interface Hip3Fill {
  /** ISO no TZ, microsecond precision. */
  readonly time: string
  readonly dex_id: string
  /** `<dex_id>:<TICKER>` prefixed form (e.g. `"xyz:CL"`). */
  readonly coin: Coin
  readonly user: Address
  readonly side: Side
  readonly px: number
  readonly sz: number
  readonly notional: number
  readonly fee: number
  readonly builder_fee_usd: number
  /** Wire int `0 | 1`. See PLAN §F.4. */
  readonly is_liquidation: number | boolean
  readonly hash: Hex
  readonly tid: number
}

/**
 * Per-trader, per-coin aggregate from `/hip3/stats/traders` (bare list item).
 */
export interface TraderStats {
  readonly dex_id: string
  readonly trader: Address
  readonly coin: Coin
  readonly total_volume: number
  readonly total_fees: number
  readonly total_trades: number
  readonly pnl_realized: number
  /** ISO no TZ, microsecond precision. */
  readonly last_update: string
}

/** Allowed sort dimensions for `/hip3/leaderboard?by=`. */
export type Hip3LeaderboardBy = 'volume' | 'pnl' | 'trades' | 'fees'

/** Runtime allowlist for {@link Hip3LeaderboardBy}. */
export const HIP3_LEADERBOARD_BY = ['volume', 'pnl', 'trades', 'fees'] as const

/**
 * One leaderboard row from `/hip3/leaderboard` (bare list item).
 *
 * The row schema is the same regardless of `by`; only the ordering changes.
 */
export interface Hip3LeaderboardEntry {
  readonly trader: Address
  readonly total_volume: number
  readonly total_fees: number
  readonly total_trades: number
  readonly pnl_realized: number
}

/**
 * Per-user HIP-3 aggregate from `/hip3/users/{address}/overview` (bare object).
 */
export interface UserHip3Overview {
  readonly trader: Address
  readonly total_volume: number
  readonly total_fees: number
  readonly total_trades: number
  readonly pnl_realized: number
  readonly coins_traded: number
  readonly dexs_traded: number
}

/**
 * Per-coin aggregate row from `/hip3/users/{address}/coins` (bare list item).
 */
export interface UserCoinStats {
  readonly dex_id: string
  readonly coin: Coin
  readonly total_volume: number
  readonly total_fees: number
  readonly total_trades: number
  readonly pnl_realized: number
}

// -----------------------------------------------------------------------------
// Request param types
// -----------------------------------------------------------------------------

/** Params for `/hip3/dexs`. `limit` capped at 500. */
export interface Hip3DexsParams {
  /** 1..500 — rejected client-side above the cap. */
  readonly limit?: number
  readonly offset?: number
}

/** Params for `/hip3/assets`. `limit` capped at 1000. */
export interface Hip3AssetsParams {
  readonly dexId?: string
  readonly search?: string
  /** 1..1000 — rejected client-side above the cap. */
  readonly limit?: number
  readonly offset?: number
}

/** Params for `/hip3/auctions`. `limit` capped at 200. */
export interface Hip3AuctionsParams {
  readonly status?: AuctionStatus
  /** 1..200 — rejected client-side above the cap. */
  readonly limit?: number
  readonly offset?: number
}

/** Params for `/hip3/auctions/history`. `limit` capped at 500. */
export interface Hip3AuctionsHistoryParams {
  readonly dexId?: string
  /** 1..500 — rejected client-side above the cap. */
  readonly limit?: number
  readonly offset?: number
}

/** Params for `/hip3/snapshots`. Both fields are optional. */
export interface Hip3SnapshotsParams {
  readonly dexId?: string
  readonly coin?: Coin
}

/** Params for `/hip3/top-movers`. `limit` capped at 100. */
export interface Hip3TopMoversParams {
  /** 1..100 — rejected client-side above the cap. */
  readonly limit?: number
}

/**
 * Params for `/hip3/ohlcv`. `coin` is required (server 422s when missing).
 * `limit` capped at 2000 (default 168).
 *
 * Time params encode as `start`/`end` ISO bare-date strings (or epoch ms —
 * the server accepts both). See ENDPOINTS.md `iso-bare/epoch`.
 */
export interface Hip3OhlcvParams {
  readonly coin: Coin
  readonly dexId?: string
  readonly startTime?: TimeInput
  readonly endTime?: TimeInput
  /** 1..2000 — rejected client-side above the cap. Default 168 server-side. */
  readonly limit?: number
}

/**
 * Params for `/hip3/oracle/stats`. `dexId` is required. `limit` capped at 10000.
 *
 * Note: `assetId` is accepted by the server but currently useless because
 * every asset has `asset_id: 0` (PLAN.md §I bug #6). The field is preserved
 * for forward-compat.
 */
export interface Hip3OracleStatsParams {
  readonly dexId: string
  /** PLAN.md §I bug #6 — filter is effectively a no-op today. */
  readonly assetId?: number
  readonly startTime?: TimeInput
  readonly endTime?: TimeInput
  /** 1..10000 — rejected client-side above the cap. */
  readonly limit?: number
}

/**
 * Params for `/hip3/fills`. Time params encode as `start`/`end`
 * (iso-bare/epoch).
 */
export interface Hip3FillsParams {
  readonly dexId?: string
  readonly coin?: Coin
  readonly user?: Address
  readonly side?: Side
  readonly startTime?: TimeInput
  readonly endTime?: TimeInput
  /** Minimum notional (USD) to include — server-side filter. */
  readonly minNotional?: number
  readonly limit?: number
  readonly offset?: number
}

/** Params for `/hip3/stats/traders`. `limit` capped at 500. */
export interface Hip3StatsTradersParams {
  readonly dexId?: string
  readonly coin?: Coin
  /** 1..500 — rejected client-side above the cap. */
  readonly limit?: number
  readonly offset?: number
}

/**
 * Params for `/hip3/leaderboard`. `by` is required. `limit` capped at 200.
 *
 * **PLAN.md §I bug #5**: server silently falls back to `volume` on unknown
 * `by` values. SDK validates client-side via {@link HIP3_LEADERBOARD_BY}.
 */
export interface Hip3LeaderboardParams {
  readonly by: Hip3LeaderboardBy
  readonly dexId?: string
  /** 1..200 — rejected client-side above the cap. */
  readonly limit?: number
}

/** Params for `/hip3/users/{address}/fills`. Time params encode as `start`/`end`. */
export interface Hip3UserFillsParams {
  readonly coin?: Coin
  readonly dexId?: string
  readonly startTime?: TimeInput
  readonly endTime?: TimeInput
  readonly limit?: number
  readonly offset?: number
}

/** Params for `/hip3/users/{address}/coins`. `limit` capped at 100. */
export interface Hip3UserCoinsParams {
  /** 1..100 — rejected client-side above the cap. */
  readonly limit?: number
}
