import type { TimeInput } from '../time/index.js'
import type { Address, Coin, Hex } from './common.js'

/**
 * Direction of a completed trade position (perp).
 */
export type Direction = 'long' | 'short'

/**
 * Server validates `sort_by` loosely (silent fallback on bogus values — see PLAN.md §I #5).
 * The SDK enforces this enum client-side via assertEnum before sending.
 */
export type TradeSortBy = 'pnl' | 'time' | 'volume' | 'duration'

/**
 * Sort direction for `?sort_dir=` on `/completed-trades/`.
 */
export type TradeSortDir = 'asc' | 'desc'

/**
 * Leverage type observed on completed trades.
 */
export type LeverageType = 'cross' | 'isolated'

/**
 * A completed perp trade (open + close fills aggregated).
 *
 * Field names mirror the upstream JSON snake_case as TS camelCase via the SDK
 * boundary. Timestamp fields are kept as their wire shape (ISO no TZ).
 */
export interface Trade {
  readonly user: Address
  readonly coin: Coin
  readonly direction: Direction
  /** ISO no TZ, microsecond precision. Use parseTimestamp(value, 'iso') to get a Date. */
  readonly startTime: string
  /** ISO no TZ, microsecond precision. Use parseTimestamp(value, 'iso') to get a Date. */
  readonly endTime: string
  readonly durationS: number
  readonly entryPrice: number
  readonly exitPrice: number
  readonly sizeClose: number
  readonly pnlRealized: number
  readonly leverageType: LeverageType
  readonly positionValue: number
  readonly totalFills: number
  readonly totalFees: number
  readonly avgFillPrice: number
  /** ISO no TZ, microsecond precision. Use parseTimestamp(value, 'iso') to get a Date. */
  readonly firstFillTime: string
  /** ISO no TZ, microsecond precision. Use parseTimestamp(value, 'iso') to get a Date. */
  readonly lastFillTime: string
  readonly totalVolume: number
  /**
   * Composite id: `trade_<coin>_<8hex>`. May contain `:` when coin is HIP-3 (e.g.
   * `trade_xyz:EWY_0xabcdef01`). Always pass through encodeSegment on path use.
   */
  readonly tradeId: string
  readonly closeHash: Hex
  /** ISO no TZ, microsecond precision. Use parseTimestamp(value, 'iso') to get a Date. */
  readonly createdAt: string
}

/**
 * Aggregated summary across the queried set of completed trades.
 *
 * Notes:
 * - `execution_time_ms` on the envelope is null for this endpoint (PLAN.md §I, batch-3 docs).
 * - `avgPnlPct` is a true percentage (1.09 = +1.09%).
 * - `avgDurationS` is currently inflated upstream — see batch-3 known issues.
 */
export interface TradesSummary {
  readonly totalTrades: number
  readonly totalPnl: number
  /** True percentage (1.09 = +1.09%). */
  readonly avgPnlPct: number
  /** Currently inflated upstream — see batch-3 known issues. */
  readonly avgDurationS: number
  readonly totalFees: number
  readonly totalVolume: number
  readonly timeRange: {
    /** ISO timestamp. Use parseTimestamp(value, 'iso') to get a Date. */
    readonly start: string
    /** ISO timestamp. Use parseTimestamp(value, 'iso') to get a Date. */
    readonly end: string
  }
  readonly directionBreakdown: ReadonlyArray<{
    readonly direction: Direction
    readonly count: number
    readonly totalPnl: number
  }>
  readonly topCoins: ReadonlyArray<{
    readonly coin: Coin
    readonly tradeCount: number
    readonly totalPnl: number
    readonly totalVolume: number
  }>
}

/**
 * A single completed trade optionally enriched with its fills.
 *
 * Returned by `GET /completed-trades/{trade_id}`. The `fills` array is present
 * only when the request was made with `includeFills: true`; otherwise the field
 * is absent. Embedded fills carry the same shifted-key quirk as `/fills` rows
 * (PLAN.md §I #3), so {@link TradeFill} already omits `feeUsdc` / `typeTrade`.
 */
export interface TradeDetail extends Trade {
  /** Present only when `includeFills: true` was passed. */
  readonly fills?: ReadonlyArray<TradeFill>
}

/**
 * Query parameters for `GET /completed-trades/{trade_id}`.
 */
export interface CompletedTradeGetParams {
  /** Embed the trade's fills in the response (`?include_fills=true`). Default false. */
  readonly includeFills?: boolean
}

/**
 * A fill row attached to a completed trade.
 *
 * Note: the wire response contains two SHIFTED keys (`feeUsdc: "perp"` and
 * `typeTrade: <ISO>`) — see PLAN.md §I #3 / batch-3 bug. The SDK type
 * intentionally OMITS those two fields until the upstream serializer is fixed.
 * All other fields are positionally correct.
 */
export interface TradeFill {
  readonly user: Address
  readonly coin: Coin
  readonly coinMeaning: string
  readonly px: number
  readonly sz: number
  readonly side: 'A' | 'B'
  /** ISO no TZ, microsecond precision. Use parseTimestamp(value, 'iso') to get a Date. */
  readonly time: string
  readonly startPosition: number
  readonly dir: string
  readonly closedPnl: number
  readonly hash: Hex
  readonly oid: number
  /** Wire encoding is 0/1; SDK normalizes to boolean. */
  readonly crossed: boolean
  readonly tid: number
  /** 32-byte client order id. */
  readonly cloid: Hex
  readonly fee: number
  readonly feeToken: string
  // feeUsdc / typeTrade intentionally omitted — see PLAN.md §I #3.
}

/**
 * Query parameters for `GET /completed-trades/`.
 *
 * NB: server has NO `limit` cap on this endpoint (a single 70 MB response was
 * observed at `limit=99999`). The SDK hard-caps `limit` at 100 client-side
 * via assertLimit — see PLAN.md §I #2.
 */
export interface CompletedTradesListParams {
  readonly user?: Address
  readonly coin?: Coin
  readonly direction?: Direction
  readonly startTime?: TimeInput
  readonly endTime?: TimeInput
  readonly minPnl?: number
  readonly maxPnl?: number
  readonly offset?: number
  /** Hard-capped client-side at 100 (no server cap). */
  readonly limit?: number
  /** Currently has no observable effect upstream. */
  readonly doCount?: boolean
  readonly sortBy?: TradeSortBy
  readonly sortDir?: TradeSortDir
}

/**
 * Query parameters for `GET /completed-trades/summary`.
 */
export interface CompletedTradesSummaryParams {
  readonly user?: Address
  readonly coin?: Coin
  readonly direction?: Direction
  readonly startTime?: TimeInput
  readonly endTime?: TimeInput
}
