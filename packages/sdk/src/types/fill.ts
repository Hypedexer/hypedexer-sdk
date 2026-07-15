import type { TimeInput } from '../time/index.js'
import type { Address, Coin, Hex, Side } from './common.js'

/**
 * Unified perp `Fill` shape — observed across `/fills/`, `/fills/recent`
 * and `/fills/user/{addr}`. User-scoped responses omit
 * `startPosition` / `dir` / `closedPnl` (batch-1 §user).
 *
 * `isLiquidation` is wire-int `0 | 1` upstream; the SDK exposes raw values
 * (see PLAN §F.4 for the boolean-coercion roadmap). `tid` magnitudes reach
 * ~10^15 today (still below `Number.MAX_SAFE_INTEGER`) — see PLAN §F.3.
 */
export interface Fill {
  readonly user: Address
  readonly coin: Coin
  readonly coinMeaning: string
  readonly px: number
  readonly sz: number
  readonly side: Side
  /** ISO no TZ, µs precision. Use `parseTimestamp(value, 'iso')` to get a Date. */
  readonly time: string
  readonly startPosition?: number
  readonly dir?: string
  readonly closedPnl?: number
  readonly hash: Hex
  readonly oid: number
  readonly tid: number
  readonly fee: number
  readonly feeToken: string
  readonly typeTrade: 'perp' | 'spot'
  readonly isLiquidation: boolean | number
  readonly liquidationRole: string
  readonly liqMarkPx: number | null
  readonly liqMethod: string | null
  readonly liquidatedUser: Address | null
  readonly notional: number
  readonly priorityGas: number | null
}

/**
 * Spot fill payload — narrow subset of `Fill` plus `feeUsdc`. Currently
 * unreachable via REST: `/fills/spot/*` returns 500 (see PLAN §I #1). The
 * canonical spot source is the WebSocket `fills_spot` channel.
 */
export interface SpotFill {
  readonly user: Address
  readonly coin: Coin
  readonly coinMeaning: string
  readonly px: number
  readonly sz: number
  readonly side: Side
  /** ISO no TZ, µs precision. Use `parseTimestamp(value, 'iso')` to get a Date. */
  readonly time: string
  readonly tid: number
  readonly oid: number
  readonly hash: Hex
  readonly fee: number
  readonly feeToken: string
  readonly feeUsdc: number
  readonly typeTrade: 'spot'
  readonly priorityGas: number | null
}

/**
 * Discriminated union on `typeTrade` across the two fill shapes.
 */
export type AnyFill =
  | (Fill & { readonly typeTrade: 'perp' })
  | (SpotFill & { readonly typeTrade: 'spot' })

/**
 * `/fills/count` single-record payload.
 */
export interface FillsCount {
  readonly count: number
  /** ISO with `+00:00` offset, µs precision. Use `parseTimestamp(value, 'iso')` to get a Date. */
  readonly timestamp: string
  /** `null` upstream on this endpoint (envelope quirk — see PLAN §I #17 family). */
  readonly execution_time_ms: number | null
}

/**
 * Relative time-range shortcut accepted by `FillsUserParams.timeRange`.
 */
export type FillsTimeRange = '1h' | '24h' | '7d' | '30d'

/**
 * Params for `GET /fills/`. Cursor pagination (`"<epoch_ms>:<tid>"`), `limit` capped at 1000.
 */
export interface FillsListParams {
  readonly coin?: Coin
  readonly side?: Side
  readonly hasPriorityGas?: boolean
  readonly startTime?: TimeInput
  readonly endTime?: TimeInput
  /** `"<epoch_ms>:<tid>"` cursor — see PLAN §D. */
  readonly cursor?: string
  /** 1..1000 (server cap). */
  readonly limit?: number
}

/**
 * Params for `GET /fills/recent`. Same shape as {@link FillsListParams}.
 */
export interface FillsRecentParams extends FillsListParams {}

/**
 * Params for `GET /fills/user/{address}`. Extends {@link FillsListParams} with
 * an optional `timeRange` shortcut used in place of `startTime` / `endTime`.
 */
export interface FillsUserParams extends FillsListParams {
  /** Alternative to `startTime` / `endTime`; mutually exclusive in practice. */
  readonly timeRange?: FillsTimeRange
}

/**
 * Spot fills request params. Note: spot REST is broken upstream — calling
 * the matching SDK methods throws `ServerError` synchronously (PLAN §I #1).
 */
export interface SpotFillsListParams {
  readonly coin?: Coin
  readonly side?: Side
  readonly startTime?: TimeInput
  readonly endTime?: TimeInput
  /** Cursor isn't honored on spot — see PLAN §D.5. Use `offset` instead. */
  readonly offset?: number
  /** 1..1000 (server cap). */
  readonly limit?: number
}

/**
 * Params for `GET /fills/spot/user/{address}`. Same shape as {@link SpotFillsListParams}.
 */
export interface SpotFillsUserParams extends SpotFillsListParams {}
