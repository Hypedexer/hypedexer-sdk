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
 * `/liquidations/*` resource. Covers the full liquidation history (cursor
 * pagination) and the 24h hot-cache view.
 *
 * Class-wide quirks defended in this resource (per PLAN.md §I):
 * - bug #4: `order=asc` produces a corrupt `next_cursor` (year 2245). The SDK
 *   permits `list({order:'asc'})` for the first page only;
 *   {@link Liquidations.iterate} refuses `'asc'` synchronously to avoid an
 *   infinite paging loop.
 * - bug #5: `order` is enum-validated against `'asc' | 'desc'` client-side
 *   even though the server enforces a regex on this one — fails fast for
 *   parity with the rest of the SDK.
 * - bug #14: addresses on the `user` filter are validated client-side to
 *   match the early-rejection behaviour of the rest of the SDK.
 *
 * @see PLAN.md §I bug #4
 * @see PLAN.md §I bug #5
 * @see PLAN.md §I bug #14
 */
export class Liquidations {
  constructor(private readonly http: HttpClient) {}

  /**
   * `GET /liquidations/` — cursor-paginated full liquidation history.
   *
   * @param params - Optional filters and paging controls.
   * @param params.coin - Namespaced coin filter (e.g. `"BTC"`, `"flx:TSLA"`).
   * @param params.user - Liquidated user address (0x-prefixed, 40 hex chars). Validated client-side (§I #14).
   * @param params.start_time - Lower time bound. Accepts `Date | number | string`; emitted as ISO `Z` snake_case.
   * @param params.end_time - Upper time bound. Same shape as `start_time`.
   * @param params.amount_dollars - Minimum notional (USD) — server-side filter.
   * @param params.cursor - Opaque cursor returned by a previous page. Bad cursors are silently ignored by the server.
   * @param params.limit - Page size 1..100. Validated client-side.
   * @param params.order - `'asc' | 'desc'` (defaults to `'desc'`). Validated client-side. See {@link Liquidations.iterate} for the `'asc'` caveat (§I #4).
   * @returns `Page<Liquidation>` with `meta.nextCursor` / `meta.hasMore` for follow-up requests.
   * @throws {ValidationError} when `order` is not `asc`/`desc`, when `user` is not a valid eth-address, or when `limit > 100`.
   * @throws {ServerError} on upstream 5xx.
   * @throws {NetworkError} on transport failure or timeout.
   * @see PLAN.md §I bug #4
   * @see PLAN.md §I bug #5
   * @see PLAN.md §I bug #14
   * @remarks
   * `order: 'asc'` returns a valid first page but the embedded
   * `meta.nextCursor` is corrupt (timestamp in the year 2245). Use this method
   * for one-shot first-page reads; if you need to follow pages, omit `order`
   * (or use `'desc'`) and rely on {@link Liquidations.iterate}.
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
   * `GET /liquidations/recent` — cursor-paginated 24h hot-cache view.
   *
   * @param params - Optional filters and paging controls.
   * @param params.coin - Namespaced coin filter (e.g. `"BTC"`, `"flx:TSLA"`).
   * @param params.cursor - Opaque cursor returned by a previous page.
   * @param params.limit - Page size 1..100. Validated client-side.
   * @returns `Page<Liquidation>` over the trailing 24h window; same item shape as {@link Liquidations.list}.
   * @throws {ValidationError} when `limit > 100`.
   * @throws {ServerError} on upstream 5xx.
   * @throws {NetworkError} on transport failure or timeout.
   * @remarks
   * `total_count` is always `null` on this endpoint. The server has no `order`
   * parameter here — rows are returned newest-first.
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
   * Async iterator over `/liquidations/` — follows `meta.nextCursor` until
   * `meta.hasMore === false` or the server omits a cursor.
   *
   * @param params - Same shape as {@link Liquidations.list}; `cursor` is managed by the iterator. `order: 'asc'` is refused (§I #4).
   * @returns `AsyncIterable<Liquidation>` that yields rows one at a time across pages.
   * @throws {ValidationError} synchronously when `params.order === 'asc'` (§I #4), when `order` is otherwise not `asc`/`desc`, when `user` is not a valid eth-address, or when `limit > 100`.
   * @see PLAN.md §I bug #4
   * @see PLAN.md §I bug #14
   * @remarks
   * `order: 'asc'` is refused at the iterator boundary because the server
   * emits a corrupt `next_cursor` (timestamp in the year 2245) in that mode,
   * which would cause the iterator to spin forever. Use
   * {@link Liquidations.list} with `order: 'asc'` for the first page only, or
   * omit `order` to default to `'desc'` and iterate safely.
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
