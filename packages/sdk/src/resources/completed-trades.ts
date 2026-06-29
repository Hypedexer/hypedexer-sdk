import { assertAddress } from '../internal/address.js'
import { assertLimit, assertOptionalEnum } from '../internal/assert.js'
import { encodeSegment } from '../internal/url.js'
import { iterate } from '../pagination/iterator.js'
import { encodeTime } from '../time/index.js'
import type { HttpClient } from '../transport/HttpClient.js'
import { unwrap, unwrapSingle } from '../transport/envelopes.js'
import type { Page, Single } from '../types/common.js'
import type {
  CompletedTradesListParams,
  CompletedTradesSummaryParams,
  Direction,
  Trade,
  TradeFill,
  TradeSortBy,
  TradeSortDir,
  TradesSummary,
} from '../types/trade.js'

/** Server has no `limit` cap on `/completed-trades/` — the SDK enforces this. */
const COMPLETED_TRADES_LIMIT_CAP = 100

const SORT_BY_VALUES = [
  'pnl',
  'time',
  'volume',
  'duration',
] as const satisfies readonly TradeSortBy[]
const SORT_DIR_VALUES = ['asc', 'desc'] as const satisfies readonly TradeSortDir[]
const DIRECTION_VALUES = ['long', 'short'] as const satisfies readonly Direction[]

function buildListQuery(
  params: CompletedTradesListParams,
): Record<string, string | number | boolean | null | undefined> {
  const q: Record<string, string | number | boolean | null | undefined> = {}
  if (params.user !== undefined) q['user'] = params.user
  if (params.coin !== undefined) q['coin'] = params.coin
  if (params.direction !== undefined) q['direction'] = params.direction
  if (params.startTime !== undefined) q['start_time'] = encodeTime(params.startTime, 'isoSnake')
  if (params.endTime !== undefined) q['end_time'] = encodeTime(params.endTime, 'isoSnake')
  if (params.minPnl !== undefined) q['min_pnl'] = params.minPnl
  if (params.maxPnl !== undefined) q['max_pnl'] = params.maxPnl
  if (params.offset !== undefined) q['offset'] = params.offset
  if (params.limit !== undefined) q['limit'] = params.limit
  if (params.doCount !== undefined) q['do_count'] = params.doCount
  if (params.sortBy !== undefined) q['sort_by'] = params.sortBy
  if (params.sortDir !== undefined) q['sort_dir'] = params.sortDir
  return q
}

function buildSummaryQuery(
  params: CompletedTradesSummaryParams,
): Record<string, string | number | boolean | null | undefined> {
  const q: Record<string, string | number | boolean | null | undefined> = {}
  if (params.user !== undefined) q['user'] = params.user
  if (params.coin !== undefined) q['coin'] = params.coin
  if (params.direction !== undefined) q['direction'] = params.direction
  if (params.startTime !== undefined) q['start_time'] = encodeTime(params.startTime, 'isoSnake')
  if (params.endTime !== undefined) q['end_time'] = encodeTime(params.endTime, 'isoSnake')
  return q
}

function validateListParams(params: CompletedTradesListParams): void {
  // PLAN.md §I #2: no server cap → SDK hard-cap at 100.
  assertLimit(params.limit, COMPLETED_TRADES_LIMIT_CAP)
  // PLAN.md §I #5: sort_by silent fallback → SDK validates client-side.
  assertOptionalEnum(params.sortBy, SORT_BY_VALUES, 'sort_by')
  assertOptionalEnum(params.sortDir, SORT_DIR_VALUES, 'sort_dir')
  assertOptionalEnum(params.direction, DIRECTION_VALUES, 'direction')
  if (params.user !== undefined) assertAddress(params.user, 'user')
}

function validateSummaryParams(params: CompletedTradesSummaryParams): void {
  assertOptionalEnum(params.direction, DIRECTION_VALUES, 'direction')
  if (params.user !== undefined) assertAddress(params.user, 'user')
}

/**
 * `/completed-trades/*` resource. Covers the full list of completed perp
 * trades (open+close aggregated), the aggregate summary, and per-trade fills.
 *
 * Class-wide quirks defended in this resource (per PLAN.md §I):
 * - bug #2: server has no `limit` cap on `/completed-trades/` (a 70 MB
 *   response was observed at `limit=99999`). The SDK hard-caps `limit` at 100
 *   client-side and rejects larger values with {@link ValidationError}.
 * - bug #3: `/{trade_id}/fills` rows ship shifted `feeUsdc`/`typeTrade` keys
 *   on the wire. The {@link TradeFill} type intentionally omits both fields
 *   until the upstream serializer is fixed.
 * - bug #5: `sort_by` (and related enums) silently fall back on bogus values.
 *   The SDK validates `sortBy`, `sortDir`, and `direction` client-side.
 * - bug #14: address-scoped queries fall back to empty when `user` is invalid.
 *   The SDK validates the eth-address pattern client-side.
 * - bug #15: a bogus `tradeId` on `/{trade_id}/fills` returns 200 with an
 *   empty `data` array (no 404). The SDK does NOT synthesize a NotFoundError.
 *
 * @see PLAN.md §I bug #2
 * @see PLAN.md §I bug #3
 * @see PLAN.md §I bug #5
 * @see PLAN.md §I bug #14
 * @see PLAN.md §I bug #15
 */
export class CompletedTradesResource {
  constructor(private readonly http: HttpClient) {}

  /**
   * `GET /completed-trades/` — offset-paginated list of completed perp trades
   * (each row = an open+close fill aggregate).
   *
   * @param params - Optional filters and paging controls.
   * @param params.user - Hyperliquid wallet address (0x-prefixed, 40 hex chars). Validated client-side (§I #14).
   * @param params.coin - Perp symbol (e.g. `"BTC"`).
   * @param params.direction - `'long' | 'short'`. Validated client-side (§I #5).
   * @param params.startTime - Lower time bound. Accepts `Date | number | string`; emitted as ISO `Z` snake_case.
   * @param params.endTime - Upper time bound. Same shape as `startTime`.
   * @param params.minPnl - Lower bound on realized PnL (USD).
   * @param params.maxPnl - Upper bound on realized PnL (USD).
   * @param params.offset - Zero-based offset for paging.
   * @param params.limit - Page size 1..100 (SDK hard-cap, §I #2). Server has no cap.
   * @param params.doCount - Pass-through flag; currently has no observable effect upstream.
   * @param params.sortBy - One of `'pnl' | 'time' | 'volume' | 'duration'`. Validated client-side (§I #5).
   * @param params.sortDir - `'asc' | 'desc'`. Validated client-side.
   * @returns `Page<Trade>` with `meta` for offset/total bookkeeping.
   * @throws {ValidationError} when `limit > 100` (§I #2), when `sortBy`/`sortDir`/`direction` is not in the allowed enum, or when `user` is set and is not a valid eth-address.
   * @throws {ServerError} on upstream 5xx.
   * @throws {NetworkError} on transport failure or timeout.
   * @see PLAN.md §I bug #2
   * @see PLAN.md §I bug #5
   * @see PLAN.md §I bug #14
   */
  async list(params: CompletedTradesListParams = {}): Promise<Page<Trade>> {
    validateListParams(params)
    const raw = await this.http.request<unknown>({
      path: '/completed-trades/',
      query: buildListQuery(params),
    })
    return unwrap<Trade>(raw, 'apiResponse')
  }

  /**
   * Async iterator over `/completed-trades/` — pages by `offset += limit`
   * until a partial page is returned. Same validation as
   * {@link CompletedTradesResource.list}.
   *
   * @param params - Same shape as {@link CompletedTradesResource.list}; `offset` is managed by the iterator.
   * @returns `AsyncIterable<Trade>` that yields rows one at a time across pages.
   * @throws {ValidationError} on bad enum/limit/address (raised eagerly via `validateListParams`).
   * @see PLAN.md §I bug #2
   * @see PLAN.md §I bug #5
   * @see PLAN.md §I bug #14
   * @remarks
   * Defaults `limit` to 100 (the SDK cap, §I #2) so each request fetches the
   * maximum allowed batch size and minimizes the number of round-trips.
   */
  iterate(params: CompletedTradesListParams = {}): AsyncIterable<Trade> {
    validateListParams(params)
    const limit = params.limit ?? COMPLETED_TRADES_LIMIT_CAP
    const initial: Record<string, unknown> = { ...params, limit }
    return iterate<Trade, Record<string, unknown>>(
      (p) => this.list(p as CompletedTradesListParams),
      initial,
      { kind: 'offset', limit },
    )
  }

  /**
   * `GET /completed-trades/summary` — aggregated stats across the queried set
   * (total trades, total PnL, average PnL %, direction breakdown, top coins).
   *
   * @param params - Optional filters; same time/scope shape as {@link CompletedTradesResource.list}.
   * @param params.user - Hyperliquid wallet address (0x-prefixed, 40 hex chars). Validated client-side (§I #14).
   * @param params.coin - Perp symbol filter.
   * @param params.direction - `'long' | 'short'`. Validated client-side (§I #5).
   * @param params.startTime - Lower time bound. Accepts `Date | number | string`; emitted as ISO `Z` snake_case.
   * @param params.endTime - Upper time bound. Same shape as `startTime`.
   * @returns `Single<TradesSummary>` aggregated snapshot.
   * @throws {ValidationError} when `direction` is not in the enum or `user` is not a valid eth-address.
   * @throws {ServerError} on upstream 5xx.
   * @throws {NetworkError} on transport failure or timeout.
   * @see PLAN.md §I bug #5
   * @see PLAN.md §I bug #14
   * @remarks
   * The envelope `execution_time_ms` is always `null` for this endpoint (per
   * batch-3 docs). `avgDurationS` on the payload is also currently inflated
   * upstream — see {@link TradesSummary.avgDurationS}.
   */
  async summary(params: CompletedTradesSummaryParams = {}): Promise<Single<TradesSummary>> {
    validateSummaryParams(params)
    const raw = await this.http.request<unknown>({
      path: '/completed-trades/summary',
      query: buildSummaryQuery(params),
    })
    return unwrapSingle<TradesSummary>(raw, 'apiResponse')
  }

  /**
   * `GET /completed-trades/{trade_id}/fills` — fills attached to a completed trade.
   *
   * @param tradeId - Composite id of the trade (e.g. `"trade_BTC_0xabcdef01"`).
   *   May contain `:` when the coin is HIP-3 (e.g. `"trade_xyz:EWY_0xabcdef01"`);
   *   the SDK URL-encodes `:` as `%3A` via {@link encodeSegment} so intermediate
   *   proxies do not mis-parse it as a scheme/host delimiter.
   * @returns `Page<TradeFill>` rows of the fills attached to the trade.
   * @throws {ServerError} on upstream 5xx.
   * @throws {NetworkError} on transport failure or timeout.
   * @see PLAN.md §I bug #3
   * @see PLAN.md §I bug #15
   * @remarks
   * Per §I #15, a bogus `tradeId` returns a 200 with an empty `data` array
   * instead of 404. The SDK does NOT synthesize a NotFoundError — callers must
   * treat an empty `data` array as "trade not found OR trade had no fills".
   *
   * Per §I #3, the wire response ships SHIFTED `feeUsdc` (always literal
   * `"perp"`) and `typeTrade` (an ISO timestamp) keys. The {@link TradeFill}
   * type intentionally omits both until the upstream serializer is fixed; all
   * other fields are positionally correct.
   */
  async fills(tradeId: string): Promise<Page<TradeFill>> {
    const path = `/completed-trades/${encodeSegment(tradeId)}/fills`
    const raw = await this.http.request<unknown>({ path })
    return unwrap<TradeFill>(raw, 'apiResponse')
  }
}
