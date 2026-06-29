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
 * Resource client for the `/completed-trades/*` endpoints (batch-3).
 *
 * Known issues defended by this resource:
 * - #2: `limit` has no server cap → hard-capped at 100 via assertLimit.
 * - #3: `/{trade_id}/fills` rows ship shifted `feeUsdc`/`typeTrade` keys; the
 *   TradeFill type omits those fields.
 * - #5: `sort_by` silent fallback → assertEnum on `sortBy`.
 * - #15: bogus trade id returns 200 with empty fills (no 404). Documented.
 */
export class CompletedTradesResource {
  constructor(private readonly http: HttpClient) {}

  /**
   * `GET /completed-trades/` — offset-paginated list of completed perp trades.
   *
   * @throws ValidationError when `limit > 100`, `sortBy`/`sortDir`/`direction` is
   *   not in the allowed enum, or `user` is not a valid 0x address.
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
   * Async iterator over `/completed-trades/` rows. Pages by `offset += limit`
   * until a partial page is returned. Same validation as {@link list}.
   *
   * Defaults `limit` to 100 (the SDK cap) so each request fetches the maximum
   * allowed batch size.
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
   * `GET /completed-trades/summary` — aggregated stats for the queried set.
   *
   * Note: `execution_time_ms` on the envelope is always null for this endpoint
   * (PLAN.md §I, batch-3 docs).
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
   * The `tradeId` segment can contain `:` (HIP-3 coins). The SDK URL-encodes
   * `:` as `%3A` via {@link encodeSegment} to avoid intermediate proxies
   * mis-parsing it as a scheme/host delimiter.
   *
   * Per PLAN.md §I #15: a bogus `tradeId` returns a 200 with an empty `data`
   * array — the SDK does NOT synthesize a NotFoundError.
   *
   * Per PLAN.md §I #3: the wire response ships SHIFTED `feeUsdc`/`typeTrade`
   * values; the {@link TradeFill} type omits both fields.
   */
  async fills(tradeId: string): Promise<Page<TradeFill>> {
    const path = `/completed-trades/${encodeSegment(tradeId)}/fills`
    const raw = await this.http.request<unknown>({ path })
    return unwrap<TradeFill>(raw, 'apiResponse')
  }
}
