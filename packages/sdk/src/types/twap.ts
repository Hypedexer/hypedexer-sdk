import type { Address, Coin, Side } from './common.js'
import type { Fill } from './fill.js'

// -----------------------------------------------------------------------------
// Status — see PLAN.md §I bug #13
// -----------------------------------------------------------------------------

/**
 * The three "happy path" status values documented by the upstream OpenAPI.
 * Use {@link TwapStatus} when you want to accept the full real-world set.
 */
export type TwapStatusKnown = 'activated' | 'finished' | 'terminated'

/**
 * Error-prefixed status strings emitted by the upstream when a TWAP can not
 * complete (e.g. `"error: Insufficient margin to place order."`).
 *
 * The upstream OpenAPI does NOT document these values, but they show up in
 * the wild on `/twaps/stats.byStatus` and on individual TWAP rows.
 *
 * @see PLAN.md §I bug #13 — the `?status=` query filter does not accept these
 *      strings, so error-status TWAPs can only be retrieved by paging the
 *      unfiltered list and matching on the prefix client-side.
 */
export type TwapStatusError = `error: ${string}`

/**
 * Full status union for a TWAP row: the three documented enum values plus the
 * undocumented `error: ${string}` template-literal family. See PLAN.md §I #13.
 */
export type TwapStatus = TwapStatusKnown | TwapStatusError

/**
 * Allowed values for the `?status=` query parameter on `/twaps/` and
 * `/twaps/user/{addr}`. `'all'` means "do not filter" (server default).
 *
 * Note: this set is intentionally narrower than {@link TwapStatus}. Per
 * PLAN.md §I #13 the upstream server enforces a 422 if you pass an
 * `error: ...` string here, so the SDK only exposes the four values the
 * upstream actually accepts.
 */
export type TwapStatusFilter = TwapStatusKnown | 'all'

// -----------------------------------------------------------------------------
// Row shapes
// -----------------------------------------------------------------------------

/**
 * A single TWAP order as returned by `/twaps/`, `/twaps/user/{addr}`, and as
 * the `meta` subtree of {@link TwapDetail}.
 *
 * Field names mirror the wire shape (camelCase as emitted upstream — TWAPs
 * are one of the rare HypeDexer endpoints already emitted in camelCase).
 *
 * `executionPct` is only present on the user-scoped list and on detail. It
 * is `0..100` (not `0..1`). See exploration/batch-6.
 *
 * `startTime` can be the sentinel `"1970-01-01T00:00:00"` ("never started").
 * Use `parseTimestamp(value, 'iso')` to get a `Date | null` — see PLAN.md
 * §I bug #17.
 */
export interface Twap {
  readonly twapId: number
  /** PLAN.md §I bug #13 — also covers `error: ${string}` strings at runtime. */
  readonly status: TwapStatus
  readonly coin: Coin
  readonly user: Address
  readonly side: Side
  readonly sz: number
  readonly executedSz: number
  readonly executedNtl: number
  readonly minutes: number
  readonly reduceOnly: boolean
  readonly randomize: boolean
  /**
   * ISO no TZ, second precision. Sentinel `"1970-01-01T00:00:00"` means
   * "never started" — see PLAN.md §I bug #17. Use
   * `parseTimestamp(value, 'iso')` to get a `Date | null`.
   */
  readonly startTime: string
  /** ISO no TZ, µs precision. Use `parseTimestamp(value, 'iso')` for a Date. */
  readonly updatedAt: string
  /** `0..100`. Only present on user-scoped list rows and on detail.meta. */
  readonly executionPct?: number
}

/**
 * One row of the status-transition log emitted as part of {@link TwapDetail}.
 * `status` can include the same `error: ${string}` family as {@link Twap.status}.
 */
export interface TwapEvent {
  /** ISO no TZ, µs precision. Use `parseTimestamp(value, 'iso')` for a Date. */
  readonly eventTime: string
  /** PLAN.md §I bug #13. */
  readonly status: TwapStatus
  readonly executedSz: number
  readonly executedNtl: number
}

/**
 * Aggregate fill summary returned by `/twaps/{id}` under `data.fills`. NOT a
 * fill list — use `twaps.fills(id)` (which calls `/twaps/{id}/fills`) for the
 * individual rows.
 */
export interface TwapFillAggregate {
  readonly fillCount: number
  readonly totalNotional: number
  readonly totalSz: number
  readonly avgPx: number
  readonly minPx: number
  readonly maxPx: number
  readonly totalFees: number
  readonly totalBuilderFees: number
  /** ISO no TZ, µs precision. */
  readonly firstFill: string
  /** ISO no TZ, µs precision. */
  readonly lastFill: string
}

/**
 * Composite payload returned by `GET /twaps/{id}` — see exploration/batch-6
 * §10. Made of three sub-shapes: `meta` (the same row as the list endpoint,
 * always with `executionPct`), `events` (status-transition log), and `fills`
 * (aggregate summary, NOT a fill list).
 */
export interface TwapDetail {
  readonly meta: Twap
  readonly events: ReadonlyArray<TwapEvent>
  readonly fills: TwapFillAggregate
}

/**
 * One bucket of `/twaps/stats.byStatus`. `status` is the same `TwapStatus`
 * union as the row type — so it can include `error: ${string}` strings
 * (PLAN.md §I bug #13).
 */
export interface TwapsStatusBucket {
  /** PLAN.md §I bug #13 — surfaces `error: ${string}` strings. */
  readonly status: TwapStatus
  readonly count: number
  readonly totalSz: number
  readonly executedSz: number
  readonly executedNtl: number
  readonly avgMinutes: number
  readonly uniqueUsers: number
  readonly uniqueCoins: number
}

/**
 * Aggregate fill summary inside `/twaps/stats`.
 */
export interface TwapsStatsFillSummary {
  readonly count: number
  readonly volume: number
  readonly totalFees: number
  readonly uniqueUsers: number
  readonly uniqueTwaps: number
}

/**
 * Payload of `GET /twaps/stats`.
 */
export interface TwapsStatsData {
  readonly hours: number
  readonly totalTwaps: number
  readonly totalExecutedNtl: number
  readonly byStatus: ReadonlyArray<TwapsStatusBucket>
  readonly fills: TwapsStatsFillSummary
}

/**
 * Fill row returned by `GET /twaps/{id}/fills`. Reuses the perp {@link Fill}
 * shape minus the liquidation-related fields (TWAP fills are never
 * liquidations), and adds `builderFee`. See exploration/batch-6 §11.
 *
 * `hash` is the all-zero hash on these rows — TWAP fills are off-chain
 * executions, not on-chain transactions.
 */
export interface TwapFill
  extends Omit<
    Fill,
    | 'liquidationRole'
    | 'liqMarkPx'
    | 'liqMethod'
    | 'liquidatedUser'
    | 'isLiquidation'
    | 'startPosition'
    | 'closedPnl'
    | 'dir'
  > {
  readonly builderFee: number
}

// -----------------------------------------------------------------------------
// Request param shapes
// -----------------------------------------------------------------------------

/**
 * Sort direction for the TWAP list endpoints (`/twaps/` and `/twaps/user/{addr}`).
 */
export type TwapsOrder = 'asc' | 'desc'

/**
 * Params for `GET /twaps/`. `limit` is capped at 500 by the server.
 */
export interface TwapsListParams {
  /** `'all'` is the server default. PLAN.md §I bug #13: error-status TWAPs
   *  can NOT be retrieved by passing an `error: ...` string here. */
  readonly status?: TwapStatusFilter
  readonly coin?: Coin
  readonly user?: Address
  readonly order?: TwapsOrder
  /** 1..500 — rejected client-side above the cap. */
  readonly limit?: number
  /** Offset for pagination (defaults to 0). */
  readonly offset?: number
}

/**
 * Params for `GET /twaps/stats`.
 */
export interface TwapsStatsParams {
  /** Server default is 1h. */
  readonly hours?: number
  readonly coin?: Coin
}

/**
 * Params for `GET /twaps/user/{addr}`. `limit` is capped at 200 by the server.
 * Note: this endpoint does NOT expose a `coin` filter.
 */
export interface TwapsUserParams {
  readonly status?: TwapStatusFilter
  readonly order?: TwapsOrder
  /** 1..200 — rejected client-side above the cap. */
  readonly limit?: number
  readonly offset?: number
}

/**
 * Params for `GET /twaps/{id}/fills`. `limit` is capped at 1000 by the server.
 */
export interface TwapFillsParams {
  /** 1..1000 — rejected client-side above the cap. */
  readonly limit?: number
  readonly offset?: number
}
