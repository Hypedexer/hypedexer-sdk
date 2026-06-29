import { assertAddress } from '../internal/address.js'
import { assertLimit, assertOptionalEnum } from '../internal/assert.js'
import { encodeSegment, joinPath } from '../internal/url.js'
import { iterate } from '../pagination/iterator.js'
import type { HttpClient } from '../transport/HttpClient.js'
import { unwrap, unwrapSingle } from '../transport/envelopes.js'
import type { Page, Single } from '../types/common.js'
import type {
  Twap,
  TwapDetail,
  TwapFill,
  TwapFillsParams,
  TwapStatusFilter,
  TwapsListParams,
  TwapsOrder,
  TwapsStatsData,
  TwapsStatsParams,
  TwapsUserParams,
} from '../types/twap.js'

const LIST_LIMIT_CAP = 500
const USER_LIMIT_CAP = 200
const FILLS_LIMIT_CAP = 1000

const STATUS_FILTER_VALUES = [
  'activated',
  'finished',
  'terminated',
  'all',
] as const satisfies readonly TwapStatusFilter[]

const ORDER_VALUES = ['asc', 'desc'] as const satisfies readonly TwapsOrder[]

type Query = Record<string, string | number | boolean | null | undefined>

function buildListQuery(p: TwapsListParams): Query {
  // PLAN.md §I #5 — silent-fallback enums are validated client-side.
  // Status is server-enforced (422 today) but we still fail fast for parity
  // with the rest of the SDK; this also blocks accidental `error: ...` casts.
  assertOptionalEnum(p.status, STATUS_FILTER_VALUES, 'status')
  assertOptionalEnum(p.order, ORDER_VALUES, 'order')
  assertLimit(p.limit, LIST_LIMIT_CAP)
  if (p.user !== undefined) assertAddress(p.user, 'user')

  const q: Query = {}
  if (p.status !== undefined) q['status'] = p.status
  if (p.coin !== undefined) q['coin'] = p.coin
  if (p.user !== undefined) q['user'] = p.user
  if (p.order !== undefined) q['order'] = p.order
  if (p.limit !== undefined) q['limit'] = p.limit
  if (p.offset !== undefined) q['offset'] = p.offset
  return q
}

function buildUserQuery(p: TwapsUserParams): Query {
  assertOptionalEnum(p.status, STATUS_FILTER_VALUES, 'status')
  assertOptionalEnum(p.order, ORDER_VALUES, 'order')
  assertLimit(p.limit, USER_LIMIT_CAP)

  const q: Query = {}
  if (p.status !== undefined) q['status'] = p.status
  if (p.order !== undefined) q['order'] = p.order
  if (p.limit !== undefined) q['limit'] = p.limit
  if (p.offset !== undefined) q['offset'] = p.offset
  return q
}

function buildFillsQuery(p: TwapFillsParams): Query {
  assertLimit(p.limit, FILLS_LIMIT_CAP)
  const q: Query = {}
  if (p.limit !== undefined) q['limit'] = p.limit
  if (p.offset !== undefined) q['offset'] = p.offset
  return q
}

function buildStatsQuery(p: TwapsStatsParams): Query {
  const q: Query = {}
  if (p.hours !== undefined) q['hours'] = p.hours
  if (p.coin !== undefined) q['coin'] = p.coin
  return q
}

/**
 * Resource handler for the `/twaps/*` endpoints (batch-6).
 *
 * Five endpoints, all behind the `APIResponse<T>` envelope, all offset-paginated
 * (or none-paginated). Endpoint family overview:
 *
 * - `GET /twaps/`            list of TWAPs across all users (cap 500)
 * - `GET /twaps/stats`       aggregate snapshot (single)
 * - `GET /twaps/user/{addr}` per-user list (cap 200) with `executionPct`
 * - `GET /twaps/{id}`        composite `{meta, events, fills}` (single)
 * - `GET /twaps/{id}/fills`  individual fills attached to a TWAP (cap 1000)
 *
 * Known issues defended / documented (see PLAN.md §I):
 *  - #13: status enum incomplete — the {@link Twap.status} field is typed as a
 *         template-literal union covering `error: ${string}`. The query filter
 *         {@link TwapStatusFilter} stays narrow because the server rejects
 *         error-prefix values with a 422.
 *  - #17: `startTime = "1970-01-01T00:00:00"` sentinel — documented on
 *         {@link Twap.startTime}; use `parseTimestamp(value, 'iso')`.
 *  - batch-6 §11: `/twaps/{id}` returns FastAPI `{detail: string}` on 404
 *         (NOT the envelope) — that's transformed into `NotFoundError` by the
 *         shared error layer; no special handling here.
 *  - batch-6 §11: `/twaps/{id}/fills` ships `hash = 0x0...0` (TWAP fills are
 *         off-chain) — passed through as-is on {@link TwapFill}.
 */
export class TwapsResource {
  constructor(private readonly http: HttpClient) {}

  /**
   * `GET /twaps/` — offset-paginated list of TWAPs across all users.
   *
   * Client-side guards: address (when `user` filter is set), status enum,
   * order enum, `limit <= 500`.
   *
   * @param params - status / coin / user / order / limit / offset filters.
   * @returns Page of {@link Twap} rows (apiResponse envelope).
   * @throws ValidationError when an enum / address / limit fails validation.
   * @see PLAN.md §I #5 #13 #14 #17
   */
  async list(params: TwapsListParams = {}): Promise<Page<Twap>> {
    const raw = await this.http.request<unknown>({
      path: '/twaps/',
      query: buildListQuery(params),
    })
    return unwrap<Twap>(raw, 'apiResponse')
  }

  /**
   * Async iterator over `/twaps/` rows. Pages by `offset += limit` until a
   * partial page is returned (the server doesn't expose `has_more` /
   * `next_cursor` on this endpoint).
   *
   * Defaults `limit` to the server cap (500) so each request fetches the
   * maximum allowed batch.
   */
  iterate(params: TwapsListParams = {}): AsyncIterable<Twap> {
    // Re-run validation now so a bad param throws synchronously (mirrors
    // Fills.iterateUser et al.).
    buildListQuery(params)
    const limit = params.limit ?? LIST_LIMIT_CAP
    const initial: Record<string, unknown> = { ...params, limit }
    return iterate<Twap, Record<string, unknown>>((p) => this.list(p as TwapsListParams), initial, {
      kind: 'offset',
      limit,
    })
  }

  /**
   * `GET /twaps/stats` — single aggregate snapshot for the trailing `hours`
   * window. Defaults to 1h server-side.
   *
   * The `byStatus` rows surface error-prefixed status strings (PLAN.md §I #13)
   * — see {@link TwapsStatusBucket.status}.
   *
   * @param params - optional `hours` / `coin` filters.
   * @returns Single {@link TwapsStatsData} record (apiResponse envelope).
   * @see PLAN.md §I #13
   */
  async stats(params: TwapsStatsParams = {}): Promise<Single<TwapsStatsData>> {
    const raw = await this.http.request<unknown>({
      path: '/twaps/stats',
      query: buildStatsQuery(params),
    })
    return unwrapSingle<TwapsStatsData>(raw, 'apiResponse')
  }

  /**
   * `GET /twaps/user/{addr}` — offset-paginated TWAP list for a single user.
   * Adds `executionPct` to each row (0..100).
   *
   * Client-side guards: address (PLAN.md §I #14 parity), status enum,
   * order enum, `limit <= 200`.
   *
   * @param address - user address (URL-encoded via {@link joinPath}).
   * @param params - status / order / limit / offset filters.
   * @returns Page of {@link Twap} rows (apiResponse envelope).
   * @throws ValidationError when `address` / `status` / `order` / `limit` invalid.
   * @see PLAN.md §I #14
   */
  async user(address: string, params: TwapsUserParams = {}): Promise<Page<Twap>> {
    assertAddress(address, 'address')
    const raw = await this.http.request<unknown>({
      path: joinPath('twaps', 'user', address),
      query: buildUserQuery(params),
    })
    return unwrap<Twap>(raw, 'apiResponse')
  }

  /** Async iterator over `/twaps/user/{addr}` — offset pagination, cap 200. */
  iterateUser(address: string, params: TwapsUserParams = {}): AsyncIterable<Twap> {
    assertAddress(address, 'address')
    buildUserQuery(params)
    const limit = params.limit ?? USER_LIMIT_CAP
    const initial: Record<string, unknown> = { ...params, limit }
    return iterate<Twap, Record<string, unknown>>(
      (p) => this.user(address, p as TwapsUserParams),
      initial,
      { kind: 'offset', limit },
    )
  }

  /**
   * `GET /twaps/{id}` — single composite payload `{meta, events, fills}`.
   *
   * On an unknown id the server returns FastAPI `{detail: "TWAP <id> not found"}`
   * with HTTP 404. The shared error layer maps that to {@link NotFoundError}.
   *
   * @param twapId - numeric TWAP id.
   * @returns Single {@link TwapDetail} composite payload (apiResponse envelope).
   * @throws NotFoundError when the TWAP id is unknown.
   */
  async get(twapId: number): Promise<Single<TwapDetail>> {
    const segment = encodeSegment(String(twapId))
    const raw = await this.http.request<unknown>({
      path: `/twaps/${segment}`,
    })
    return unwrapSingle<TwapDetail>(raw, 'apiResponse')
  }

  /**
   * `GET /twaps/{id}/fills` — offset-paginated fills attached to a TWAP.
   *
   * `limit` is capped at 1000. `hash` is the all-zero hash on every row
   * (TWAP fills are off-chain executions) — pass-through, not corrected.
   * This is the only `/twaps/*` endpoint where `total_count` is actually
   * populated upstream.
   *
   * @param twapId - numeric TWAP id.
   * @param params - limit / offset filters.
   * @returns Page of {@link TwapFill} rows (apiResponse envelope).
   * @throws ValidationError when `limit > 1000`.
   */
  async fills(twapId: number, params: TwapFillsParams = {}): Promise<Page<TwapFill>> {
    const segment = encodeSegment(String(twapId))
    const raw = await this.http.request<unknown>({
      path: `/twaps/${segment}/fills`,
      query: buildFillsQuery(params),
    })
    return unwrap<TwapFill>(raw, 'apiResponse')
  }

  /** Async iterator over `/twaps/{id}/fills` — offset pagination, cap 1000. */
  iterateFills(twapId: number, params: TwapFillsParams = {}): AsyncIterable<TwapFill> {
    buildFillsQuery(params)
    const limit = params.limit ?? FILLS_LIMIT_CAP
    const initial: Record<string, unknown> = { ...params, limit }
    return iterate<TwapFill, Record<string, unknown>>(
      (p) => this.fills(twapId, p as TwapFillsParams),
      initial,
      { kind: 'offset', limit },
    )
  }
}
