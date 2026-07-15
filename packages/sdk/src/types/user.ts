import type { Address, Coin } from './common.js'

/**
 * Optional time-window for user-scoped requests. Encoded as
 * `start_time` / `end_time` ISO query parameters on the wire.
 */
export interface UserOverviewParams {
  /** Accepts Date | number (epoch ms) | ISO string. */
  readonly startTime?: Date | number | string
  /** Accepts Date | number (epoch ms) | ISO string. */
  readonly endTime?: Date | number | string
}

/**
 * Params for `/users/{user}/coins`. `limit` is capped at 100 by the server.
 */
export interface UserCoinsParams extends UserOverviewParams {
  /** 1..100 — rejected client-side above the cap. */
  readonly limit?: number
  /** Offset for pagination (defaults to 0). */
  readonly offset?: number
}

/**
 * Params for `/users/active`. Both fields default server-side
 * (`hours=1`, `limit` server default). Hours cap = 168; limit cap = 100.
 */
export interface ActiveUsersParams {
  /** 1..168 — rejected client-side above the cap. */
  readonly hours?: number
  /** 1..100 — rejected client-side above the cap. */
  readonly limit?: number
  /** Offset for pagination (defaults to 0). */
  readonly offset?: number
}

/**
 * Per-user aggregate from `/users/{user}/overview` (apiResponse, single).
 *
 * Field names mirror the wire shape (snake_case).
 */
export interface UserOverview {
  /** Echoes the input verbatim — NOT normalized. See PLAN.md §I #14. */
  readonly user: Address
  readonly total_volume: number
  readonly total_fees: number
  readonly fill_count: number
  readonly unique_coins: number
  readonly total_pnl: number
  /** A "trade" = open+close; differs from `fill_count`. */
  readonly total_trades: number
  /** Always 0 currently — see PLAN.md §I #6 (unreliable / not wired). */
  readonly total_priority_gas: number
  /**
   * ISO no TZ, second precision. Sentinel `"1970-01-01T00:00:00"` means
   * "no activity" — see PLAN.md §I #17. Use `parseTimestamp(value, 'iso')`
   * to get a `Date | null` (null on sentinel / empty).
   */
  readonly last_activity: string | null
  /** Float in `[0, 1]`. */
  readonly win_rate: number
}

/**
 * Per-user performance summary from `/users/{user}/performance`
 * (apiResponse, single).
 */
export interface UserPerformance {
  readonly user: Address
  readonly total_trades: number
  /** Float in `[0, 1]`. */
  readonly win_rate: number
  readonly avg_win: number
  /** USD, positive number (loss magnitude). */
  readonly avg_loss: number
  /** Gross profit / gross loss. */
  readonly profit_factor: number
  /** USD, positive (magnitude). */
  readonly max_drawdown: number
  readonly avg_trade_size: number
  /**
   * Observed inflated (~3.7e11 — decades). The server likely includes
   * never-closed positions in the average. See PLAN.md §I #8 (bug #8 in
   * exploration). Pass-through; documented but not corrected.
   */
  readonly avg_holding_time_s: number
  readonly wins: number
  /** `wins + losses` can be `< total_trades` — break-evens excluded. */
  readonly losses: number
  readonly total_pnl: number
}

/**
 * Per-coin aggregate row from `/users/{user}/coins` (apiResponse, offset).
 */
export interface UserCoinAggregate {
  readonly coin: Coin
  readonly total_volume: number
  readonly fill_count: number
  readonly total_fees: number
  readonly avg_price: number
  readonly price_range: { readonly min: number; readonly max: number }
  readonly total_pnl: number
}

/**
 * Active-user row from `/users/active` (apiResponse, offset).
 */
export interface ActiveUser {
  readonly user: Address
  readonly fill_count: number
  readonly total_volume: number
  readonly unique_coins: number
  /**
   * ISO no TZ, microsecond precision. Use `parseTimestamp(value, 'iso')`
   * to get a `Date | null`.
   */
  readonly last_activity: string
}

// -----------------------------------------------------------------------------
// Leaderboard — polymorphic on `by` (PLAN.md §I #23)
// -----------------------------------------------------------------------------

/**
 * Allowed values for `?by=` on `/users/leaderboard`.
 */
export type LeaderboardBy = 'volume' | 'pnl' | 'trades' | 'priority_fees'

/**
 * Leaderboard row returned by `/users/leaderboard` when `by=volume`.
 * See PLAN.md §I #23.
 */
export interface LeaderboardByVolume {
  readonly user: Address
  readonly total_volume: number
  readonly fill_count: number
  readonly unique_coins: number
}

/**
 * Leaderboard row returned by `/users/leaderboard` when `by=pnl`.
 * See PLAN.md §I #23.
 */
export interface LeaderboardByPnl {
  readonly user: Address
  readonly total_pnl: number
  readonly trade_count: number
}

/**
 * Leaderboard row returned by `/users/leaderboard` when `by=trades`.
 * See PLAN.md §I #23.
 */
export interface LeaderboardByTrades {
  readonly user: Address
  readonly fill_count: number
  readonly total_volume: number
}

/**
 * Leaderboard row returned by `/users/leaderboard` when `by=priority_fees`.
 * See PLAN.md §I #23.
 */
export interface LeaderboardByPriorityFees {
  readonly user: Address
  /** Always 0 currently — see PLAN.md §I #6. */
  readonly total_priority_gas: number
  readonly fill_count: number
}

/**
 * Discriminated row type keyed on the request's `by` value.
 * See PLAN.md §I #23 — `/users/leaderboard` returns shape-shifting rows
 * depending on `by`.
 */
export type LeaderboardEntry<B extends LeaderboardBy> = B extends 'volume'
  ? LeaderboardByVolume
  : B extends 'pnl'
    ? LeaderboardByPnl
    : B extends 'trades'
      ? LeaderboardByTrades
      : B extends 'priority_fees'
        ? LeaderboardByPriorityFees
        : never

/**
 * Params for `/users/leaderboard`. `hours` cap = 168, `limit` cap = 100.
 */
export interface LeaderboardParams<B extends LeaderboardBy> {
  readonly by: B
  /** 1..168 — rejected client-side above the cap. */
  readonly hours?: number
  /** 1..100 — rejected client-side above the cap. */
  readonly limit?: number
}
