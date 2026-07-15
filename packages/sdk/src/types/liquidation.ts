import type { TimeInput } from '../time/index.js'
import type { Address, Coin, Hex } from './common.js'

/**
 * A single liquidation event from `/liquidations/`.
 *
 * Field names match the upstream JSON (snake_case). A single liquidation
 * hash can appear multiple times in the feed (one row per fill leg, plus an
 * aggregate row with `liquidator_count: 0`).
 */
export interface Liquidation {
  /**
   * ISO 8601 timestamp, no timezone, second precision (e.g. `"2026-05-11T15:46:11"`).
   * Use `parseTimestamp(value, 'iso')` to get a Date.
   */
  readonly time: string

  /**
   * Epoch milliseconds.
   * Use `parseTimestamp(value, 'epochMs')` to get a Date.
   *
   * Warning: CORRUPT on very old rows — backend emits values in the year 2245
   * (e.g. `8713204932780`) for some pre-2025 liquidations. The `time` ISO
   * field on the same row is correct. See PLAN.md §I bug #4/#5.
   */
  readonly time_ms: number

  /** Namespaced coin string (e.g. `"BTC"`, `"flx:TSLA"`). */
  readonly coin: Coin

  /** 0x-prefixed transaction hash. */
  readonly hash: Hex

  /**
   * Address of the liquidated user.
   *
   * May be the empty string `""` on outlier rows where the backend failed to
   * resolve the user — not normalised to `null` to keep the wire shape intact.
   */
  readonly liquidated_user: Address | ''

  /** Total liquidated size in coin units. */
  readonly size_total: number

  /** Total notional liquidated in USD. */
  readonly notional_total: number

  /** Volume-weighted average fill price, or `null` when no fills happened. */
  readonly fill_px_vwap: number | null

  /** Mark price at liquidation time, or `null`. */
  readonly mark_px: number | null

  /** Liquidation method — typically `"market"`, sometimes other strings, or `null`. */
  readonly method: string | null

  /** Total fee paid by the liquidated user in USD. */
  readonly fee_total_liquidated: number

  /**
   * Addresses of the liquidators on this row. Up to 8 observed; may be empty
   * on the aggregate row (when `liquidator_count` is `0`).
   */
  readonly liquidators: ReadonlyArray<Address>

  /** Number of liquidators on this row (matches `liquidators.length`). */
  readonly liquidator_count: number

  /** Direction of the liquidated position, or `null` on aggregate/outlier rows. */
  readonly liq_dir: 'Long' | 'Short' | null

  /**
   * Numeric trade id. Safe as a JS number for current values, but can reach
   * `~10^15` so callers persisting these long-term should use a bigint-safe path.
   */
  readonly tid: number
}

/**
 * Sort direction for the liquidations feed.
 *
 * Note: `'asc'` is honoured by the server for the first page but produces a
 * corrupt `next_cursor` ("year 2245" timestamp) — `iterate()` therefore
 * refuses `'asc'`. See PLAN.md §I bug #4.
 */
export type LiquidationOrder = 'asc' | 'desc'

/**
 * Query parameters for `GET /liquidations/` (cursor-paginated).
 */
export interface LiquidationsListParams {
  readonly coin?: Coin
  readonly user?: Address
  readonly start_time?: TimeInput
  readonly end_time?: TimeInput
  /** Minimum notional (in USD) to include — server-side filter. */
  readonly amount_dollars?: number
  /** Opaque cursor — bad cursors are silently ignored by the server (returns first page). */
  readonly cursor?: string
  /** 1..100; rejected client-side above 100. */
  readonly limit?: number
  /** Defaults to `'desc'`. See {@link LiquidationOrder} for the `'asc'` caveat. */
  readonly order?: LiquidationOrder
}

/**
 * Query parameters for `GET /liquidations/recent` (cursor-paginated, 24h cache).
 */
export interface LiquidationsRecentParams {
  readonly coin?: Coin
  readonly cursor?: string
  /** 1..100; rejected client-side above 100. */
  readonly limit?: number
}
