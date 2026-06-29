import type { Address, Coin } from './common.js'

/**
 * Trailing-window enum accepted by every `/builders/*` endpoint that takes
 * a `timeframe` query param. Server returns 422 on bogus values.
 */
export type BuilderTimeframe = '1h' | '24h' | '7d' | '30d'

/**
 * Allowed values for `/builders/top?sort=`.
 *
 * Server silently falls back to `volume` on bogus values (PLAN.md §I #5).
 * The SDK validates client-side and throws `ValidationError` instead.
 */
export type BuilderTopSort = 'volume' | 'fees' | 'builder_fees' | 'fills' | 'users'

/**
 * Lifecycle stage of the referrer relationship for a builder on `/builders/list`.
 *
 * `null` is the documented "no referral" state (top-level builder, not referred).
 */
export type ReferrerStage = 'ready' | 'needToTrade' | 'needToCreateCode' | null

/**
 * One row in `BuildersTopData.builders` (returned by `/builders/top`).
 *
 * Wire shape is camelCase upstream and preserved verbatim.
 */
export interface Builder {
  readonly builder: Address
  /** `null` when the builder is unregistered (no name on file). */
  readonly builderName: string | null
  readonly fillCount: number
  readonly totalVolume: number
  readonly totalFees: number
  readonly totalBuilderFees: number
  readonly uniqueUsers: number
  readonly uniqueCoins: number
}

/**
 * `data` payload of `/builders/top` — note this is an OBJECT that wraps the
 * builders array, not a bare list (PLAN.md §B — apiResponse `data` is
 * polymorphic). `sort` echoes the input; on a silent server fallback it
 * would show `"bogus"` here, but the SDK rejects bogus sort values
 * client-side so the echo will always match the request.
 */
export interface BuildersTopData {
  readonly timeframe: BuilderTimeframe
  readonly sort: BuilderTopSort
  readonly builders: ReadonlyArray<Builder>
}

/**
 * Shared `current` / `previous` block of every `*-stats` endpoint.
 *
 * `uniqueBuilders` is present on the GLOBAL stats endpoints and absent on
 * the per-address variant (`/builders/{addr}/stats`).
 */
export interface BuilderStatsBlock {
  readonly fillCount: number
  readonly totalVolume: number
  readonly totalFees: number
  readonly totalBuilderFees: number
  /** Present on `/builders/stats(/all-timeframes)`, absent on `/builders/{addr}/stats`. */
  readonly uniqueBuilders?: number
  readonly uniqueUsers: number
  readonly uniqueCoins: number
}

/**
 * Period-over-period variation percentages for each metric in
 * {@link BuilderStatsBlock}. Each value can be `null` when the previous
 * period is zero (avoids divide-by-zero on the server side).
 */
export interface BuilderVariations {
  readonly fillCountPct: number | null
  readonly totalVolumePct: number | null
  readonly totalFeesPct: number | null
  readonly totalBuilderFeesPct: number | null
  /** Present on global stats, absent on the per-address variant. */
  readonly uniqueBuildersPct?: number | null
  readonly uniqueUsersPct: number | null
}

/** `data` payload of `/builders/stats`. */
export interface BuildersStatsData {
  readonly timeframe: BuilderTimeframe
  readonly current: BuilderStatsBlock
  readonly previous: BuilderStatsBlock
  readonly variations: BuilderVariations
}

/**
 * `data` payload of `/builders/stats/all-timeframes`. Keyed by timeframe;
 * each value mirrors {@link BuildersStatsData} minus the `timeframe` field.
 */
export type BuildersStatsAllTimeframesData = Record<
  BuilderTimeframe,
  Omit<BuildersStatsData, 'timeframe'>
>

/**
 * One row in `BuilderAddrStatsData.coinBreakdown`.
 *
 * `coin` may carry a HIP-3 dex prefix (e.g. `"xyz:CL"`) — use
 * `parseCoin(value)` to split into `{dex, symbol}`.
 */
export interface BuilderCoinBreakdown {
  readonly coin: Coin
  readonly coinMeaning: string
  readonly fillCount: number
  readonly totalVolume: number
  readonly totalFees: number
  readonly totalBuilderFees: number
  readonly uniqueUsers: number
}

/**
 * `data` payload of `/builders/{addr}/stats`. Note: per-builder stats
 * blocks do NOT carry `uniqueBuilders` (it would always be 1).
 *
 * `builderName` is `null` when the queried address isn't a registered
 * builder — the server returns 200 with sparse stats anyway (no 404).
 */
export interface BuilderAddrStatsData {
  readonly builder: Address
  readonly builderName: string | null
  readonly timeframe: BuilderTimeframe
  readonly current: BuilderStatsBlock
  readonly previous: BuilderStatsBlock
  readonly variations: BuilderVariations
  readonly coinBreakdown: ReadonlyArray<BuilderCoinBreakdown>
}

/** One row in `BuilderUsersData.users` (returned by `/builders/{addr}/users`). */
export interface BuilderUser {
  readonly user: Address
  readonly fillCount: number
  readonly totalVolume: number
  readonly totalFees: number
  readonly totalBuilderFees: number
  readonly uniqueCoins: number
}

/**
 * `data` payload of `/builders/{addr}/users` — like `/builders/top`,
 * this is an OBJECT wrapping the array, not a bare list.
 */
export interface BuilderUsersData {
  readonly timeframe: BuilderTimeframe
  readonly builder: Address
  readonly users: ReadonlyArray<BuilderUser>
}

/**
 * One row in `/builders/list` — a flat directory of every builder ever
 * registered. `name` is `null` for ~66% of rows (unnamed builders);
 * `referredBy` is `null` for top-level builders.
 */
export interface BuilderEntry {
  readonly address: Address
  readonly name: string | null
  readonly referredBy: Address | null
  readonly referrerStage: ReferrerStage
}

// ---------------------------------------------------------------------------
// Request parameter types
// ---------------------------------------------------------------------------

/**
 * Params for `/builders/top`. `limit` cap = 100 (422 above 100).
 *
 * `sort` is validated client-side because the server silently falls back to
 * `volume` on bogus values (PLAN.md §I #5).
 */
export interface BuildersTopParams {
  readonly timeframe?: BuilderTimeframe
  readonly sort?: BuilderTopSort
  /** 1..100 — rejected client-side above the cap. */
  readonly limit?: number
  /** Offset for pagination (defaults to 0). */
  readonly offset?: number
}

/** Params for `/builders/stats`. */
export interface BuildersStatsParams {
  readonly timeframe?: BuilderTimeframe
}

/** Params for `/builders/{addr}/stats`. */
export interface BuilderAddrStatsParams {
  readonly timeframe?: BuilderTimeframe
}

/**
 * Params for `/builders/{addr}/users`. No documented server-side cap on
 * `limit`; offset-paginated.
 */
export interface BuilderUsersParams {
  readonly timeframe?: BuilderTimeframe
  readonly limit?: number
  /** Offset for pagination (defaults to 0). */
  readonly offset?: number
}
