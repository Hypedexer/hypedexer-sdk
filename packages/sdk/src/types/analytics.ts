import type { TimeInput } from '../time/index.js'
import type { Coin } from './common.js'

/**
 * ISO timestamp string carried verbatim from the upstream JSON.
 *
 * Use `parseTimestamp(value, 'iso')` to convert to a `Date`.
 * Stats endpoints emit `Z`-suffixed ISO at second-precision (fills/priority-fees)
 * or microsecond-precision (liquidations). Either is accepted by `parseTimestamp`.
 */
export type AnalyticsIsoTimestamp = string

/** Bare `YYYY-MM-DD` string. Use `parseTimestamp(value, 'date')` to get UTC midnight. */
export type DateOnly = string

/** Shared `time_range` envelope returned by every `*-stats` endpoint. */
export interface TimeRangeIso {
  readonly start: AnalyticsIsoTimestamp
  readonly end: AnalyticsIsoTimestamp
}

/**
 * Aggregate snapshot returned by `/analytics/fills/stats`.
 *
 * `coin` is conditionally present — only when the caller passed `?coin=`.
 */
export interface FillsStatsData {
  readonly total_fills: number
  readonly total_volume: number
  readonly total_fees: number
  readonly total_builder_fees_usdc: number
  readonly unique_users: number
  readonly unique_coins: number
  readonly time_range: TimeRangeIso
  readonly coin?: Coin
}

/**
 * Aggregate snapshot returned by `/analytics/priority-fees/stats`.
 *
 * `coin` is conditionally present — only when the caller passed `?coin=`.
 */
export interface PriorityFeesStatsData {
  readonly total_fills_with_priority: number
  readonly total_priority_gas: number
  readonly avg_priority_gas: number
  readonly min_priority_gas: number
  readonly max_priority_gas: number
  readonly unique_users: number
  readonly time_range: TimeRangeIso
  readonly coin?: Coin
}

/** One daily bucket of `/analytics/priority-fees/chart/daily`. */
export interface PriorityFeesDailyPoint {
  /** `YYYY-MM-DD`. Use `parseTimestamp(value, 'date')` to get UTC midnight. */
  readonly date: DateOnly
  readonly fills: number
  readonly fillsWithFee: number
  readonly totalGas: number
  readonly uniqueUsers: number
}

/**
 * One row of `/analytics/priority-fees/gossip/leaderboard`.
 *
 * `nodeIp` is the upstream `address` field renamed: upstream returns an
 * **IPv4 string** (e.g. `"54.64.2.87"`), not a wallet, despite the server
 * message claiming "wallets". See PLAN.md §I bug #9.
 */
export interface GossipLeaderboardEntry {
  /** IPv4 string identifying the gossip node — renamed from upstream `address`. */
  readonly nodeIp: string
  readonly totalGas: number
  readonly count: number
  readonly daysActive: number
}

/**
 * Aggregate snapshot returned by `/analytics/liquidations/stats`.
 *
 * `coin` is conditionally present — only when the caller passed `?coin=`.
 * `top_token_liquidated` is **NOT scoped by the `coin` filter** — the server
 * returns the global top token even when a filter is active. See PLAN.md §I
 * bug #8.
 */
export interface LiquidationsStatsData {
  readonly number_liquidation: number
  readonly number_long_liquidated: number
  readonly number_short_liquidated: number
  readonly amount_liquidated_usd: number
  readonly total_fees: number
  /** Global top-liquidated token. Ignores the `coin` query filter (bug #8). */
  readonly top_token_liquidated: Coin
  readonly time_range: TimeRangeIso
  readonly coin?: Coin
}

// ---------------------------------------------------------------------------
// Request parameter types
// ---------------------------------------------------------------------------

export interface FillsStatsParams {
  /** 1..168 (server cap). Defaults to 1 on the server. */
  readonly hours?: number
  readonly coin?: Coin
}

export interface PriorityFeesStatsParams {
  /** 1..168 (server cap). Defaults to 1 on the server. */
  readonly hours?: number
  readonly coin?: Coin
}

export interface PriorityFeesChartDailyParams {
  readonly startTime?: TimeInput
  readonly endTime?: TimeInput
}

export interface GossipLeaderboardParams {
  /** 1..200 (server cap). */
  readonly limit?: number
}

export interface LiquidationsStatsParams {
  /** 1..30 (server cap). Defaults to 1 on the server. */
  readonly days?: number
  readonly coin?: Coin
}
