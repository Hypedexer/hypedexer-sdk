import { ValidationError } from '../errors/index.js'
import { assertAddress } from '../internal/address.js'
import { assertEnum, assertLimit } from '../internal/assert.js'
import { iterate } from '../pagination/iterator.js'
import { encodeTime } from '../time/index.js'
import type { HttpClient } from '../transport/HttpClient.js'
import { unwrap } from '../transport/envelopes.js'
import type { APIResponse, Page } from '../types/common.js'
import type {
  Liquidation,
  LiquidationOrder,
  LiquidationsListParams,
  LiquidationsRecentParams,
} from '../types/liquidation.js'

const LIMIT_CAP = 100
const ORDER_VALUES = ['asc', 'desc'] as const satisfies readonly LiquidationOrder[]

type RawList = APIResponse<Liquidation[]>

function buildListQuery(
  p: LiquidationsListParams,
): Record<string, string | number | boolean | null | undefined> {
  return {
    coin: p.coin,
    user: p.user,
    start_time: p.start_time !== undefined ? encodeTime(p.start_time, 'isoSnake') : undefined,
    end_time: p.end_time !== undefined ? encodeTime(p.end_time, 'isoSnake') : undefined,
    amount_dollars: p.amount_dollars,
    cursor: p.cursor,
    limit: p.limit,
    order: p.order,
  }
}

function buildRecentQuery(
  p: LiquidationsRecentParams,
): Record<string, string | number | boolean | null | undefined> {
  return {
    coin: p.coin,
    cursor: p.cursor,
    limit: p.limit,
  }
}

/**
 * Resource wrapper for the `/liquidations/*` endpoints.
 *
 * Endpoints:
 * - `GET /liquidations/`         — full history, cursor pagination
 * - `GET /liquidations/recent`   — 24h hot-cache view, cursor pagination
 *
 * Quirks defended client-side (see PLAN.md §I):
 * - bug #4: `order=asc` produces a corrupt `next_cursor` (year 2245). `list({order:'asc'})`
 *   is allowed (first page only) but {@link Liquidations.iterate} throws ValidationError.
 * - bug #5: `order` is enum-validated against `'asc' | 'desc'` before sending; the server
 *   does enforce a regex on this one, but we fail fast anyway for parity with the rest
 *   of the SDK.
 */
export class Liquidations {
  constructor(private readonly http: HttpClient) {}

  /**
   * Fetch one page from `/liquidations/`.
   *
   * `order: 'asc'` is accepted (the first page is valid) but the returned
   * `meta.nextCursor` cannot be re-used safely — see {@link Liquidations.iterate}.
   */
  async list(params: LiquidationsListParams = {}): Promise<Page<Liquidation>> {
    if (params.order !== undefined) {
      assertEnum(params.order, ORDER_VALUES, 'order')
    }
    if (params.user !== undefined) {
      assertAddress(params.user, 'user')
    }
    assertLimit(params.limit, LIMIT_CAP)

    const raw = await this.http.request<RawList>({
      path: '/liquidations/',
      query: buildListQuery(params),
    })
    return unwrap<Liquidation>(raw, 'apiResponse')
  }

  /**
   * Fetch one page from `/liquidations/recent` (24h hot-cache window).
   *
   * Same item shape as {@link Liquidations.list}; `total_count` is always `null`
   * here. The server has no `order` parameter on this endpoint — rows are
   * returned newest-first.
   */
  async recent(params: LiquidationsRecentParams = {}): Promise<Page<Liquidation>> {
    assertLimit(params.limit, LIMIT_CAP)

    const raw = await this.http.request<RawList>({
      path: '/liquidations/recent',
      query: buildRecentQuery(params),
    })
    return unwrap<Liquidation>(raw, 'apiResponse')
  }

  /**
   * Iterate every liquidation matching `params`, following `next_cursor` until
   * the server reports `has_more: false` or omits a cursor.
   *
   * Throws ValidationError immediately when `params.order === 'asc'`: the
   * server emits a corrupt cursor in that mode (timestamp in the year 2245)
   * which would cause the iterator to spin forever. See PLAN.md §I bug #4.
   */
  iterate(params: LiquidationsListParams = {}): AsyncIterable<Liquidation> {
    if (params.order === 'asc') {
      throw new ValidationError(
        '`order: "asc"` cannot be iterated — the server returns a corrupt cursor',
        [
          {
            msg: 'use list({order: "asc"}) for the first page only, or omit order to use desc',
            loc: ['order'],
            type: 'sdk_validation',
            input: params.order,
            ctx: { bug: 'PLAN.md §I #4' },
          },
        ],
      )
    }
    if (params.order !== undefined) {
      assertEnum(params.order, ORDER_VALUES, 'order')
    }
    if (params.user !== undefined) {
      assertAddress(params.user, 'user')
    }
    assertLimit(params.limit, LIMIT_CAP)

    return iterate<Liquidation, Record<string, unknown>>(
      (p) => this.list(p as LiquidationsListParams),
      params as unknown as Record<string, unknown>,
      { kind: 'cursor' },
    )
  }
}
