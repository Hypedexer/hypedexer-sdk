import type { Address, Coin } from './common.js'

/**
 * ISO no-TZ timestamp string as emitted by `/overview/*`.
 * Use `parseTimestamp(value, 'iso')` to materialise a Date.
 */
export type IsoTimestamp = string

/**
 * "YYYY-MM-DD" calendar date as emitted by `/overview/daily-*`.
 * Use `parseTimestamp(value, 'date')` to materialise a Date.
 */
export type DateOnly = string

/**
 * Allowed `sort` values for `topTraders24h`. Validated client-side because the
 * server silently falls back on unknown values — see PLAN.md §I #5.
 *
 * - `pnl_pos`: descending total PnL (positive performers first). This is the
 *   server's default.
 * - `pnl_neg`: ascending total PnL (most-negative first).
 * - `volume`: descending total USD volume.
 * - `trades`: descending trade count.
 */
export type TopTraderSort = 'pnl_pos' | 'pnl_neg' | 'volume' | 'trades'

/**
 * Runtime allowlist matched against {@link TopTraderSort} for client-side enum validation.
 */
export const TOP_TRADER_SORTS = ['pnl_pos', 'pnl_neg', 'volume', 'trades'] as const

/**
 * KPI-card envelope shared by `activeTraders24h`, `tradingVolume24h` and
 * `totalFills24h`. `variationPct` may be `null` when the prior bucket is 0.
 */
export interface KpiCard<T = number> {
  readonly value: T
  /** Variation vs prior 24h window. May be null when the previous bucket is 0. */
  readonly variationPct: number | null
}

/**
 * One trader row of the `topTraders24h` leaderboard.
 */
export interface TopTraderEntry {
  readonly user: Address
  readonly tradeCount: number
  readonly totalVolume: number
  /** Fraction in [0, 1], NOT a percentage. */
  readonly winRate: number
  readonly totalPnl: number
}

/**
 * Spot, perp-USDC, and combined trading fees over the last 24h.
 */
export interface TotalFees24h {
  readonly feesSpot: number
  readonly feesPerpUsdc: number
  /** Server-computed sum; equals `feesSpot + feesPerpUsdc`. */
  readonly totalFees: number
}

/**
 * Count of unique active addresses in the last 24h with prior-day variation.
 */
export type ActiveTraders24h = KpiCard<number>

/**
 * Total trading volume (USD) in the last 24h with prior-day variation.
 */
export type TradingVolume24h = KpiCard<number>

/**
 * Total fill count in the last 24h with prior-day variation.
 */
export type TotalFills24h = KpiCard<number>

/**
 * One point of the 10-day daily-volume series. Items are sorted oldest → newest.
 */
export interface DailyVolumePoint {
  readonly date: DateOnly
  readonly volume: number
}

/**
 * One per-coin row of the 10-day daily-PnL series. Always global — the server
 * does not accept a `user` filter on this endpoint.
 */
export interface DailyPnlEntry {
  readonly date: DateOnly
  readonly coin: Coin
  readonly pnl: number
}

/**
 * Per-coin breakdown of a user's volume + fill count over the lookback window.
 */
export interface CoinDistributionEntry {
  readonly coin: Coin
  readonly volume: number
  readonly fills: number
}

/**
 * Query params for the `topTraders24h` leaderboard request.
 */
export interface TopTradersParams {
  /** See {@link TopTraderSort}. Defaults to server default (`pnl_pos`). */
  readonly sort?: TopTraderSort
  /** Defaults to 20 when omitted. */
  readonly limit?: number
}

/**
 * Query params for the 10-day daily-volume series request.
 */
export interface DailyVolumeParams {
  /** Optional address to scope the series to a single trader. */
  readonly user?: Address
}

/**
 * Query params for a user's per-coin distribution request.
 */
export interface CoinDistributionParams {
  /**
   * Required by the server (422 when missing). SDK additionally validates the
   * eth-address pattern client-side because the server returns 200 + empty
   * for bogus inputs — see PLAN.md §I #14.
   */
  readonly user: Address
}
