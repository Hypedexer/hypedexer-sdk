import { ServerError } from '../errors/index.js'
import { assertAddress } from '../internal/address.js'
import { assertEnum, assertLimit, assertOptionalEnum } from '../internal/assert.js'
import { joinPath } from '../internal/url.js'
import { iterate } from '../pagination/iterator.js'
import { encodeTime } from '../time/index.js'
import type { HttpClient } from '../transport/HttpClient.js'
import { unwrap, unwrapSingle } from '../transport/envelopes.js'
import type { Page, Single } from '../types/common.js'
import type {
  Fill,
  FillsCount,
  FillsListParams,
  FillsRecentParams,
  FillsTimeRange,
  FillsUserParams,
  SpotFill,
  SpotFillsListParams,
  SpotFillsUserParams,
} from '../types/fill.js'

const FILLS_LIMIT_CAP = 1000
const SPOT_LIMIT_CAP = 1000
const SIDES = ['A', 'B'] as const
const TIME_RANGES: readonly FillsTimeRange[] = ['1h', '24h', '7d', '30d']
const SPOT_BUG_MESSAGE =
  '/fills/spot/* is broken upstream (500 ClickHouse). Subscribe to the WebSocket `fills_spot` channel instead. See PLAN.md §I #1.'

type Query = Record<string, string | number | boolean | null | undefined>

function buildListQuery(p: FillsListParams): Query {
  assertLimit(p.limit, FILLS_LIMIT_CAP)
  assertOptionalEnum(p.side, SIDES, 'side')
  const q: Query = {}
  if (p.coin !== undefined) q['coin'] = p.coin
  if (p.side !== undefined) q['side'] = p.side
  if (p.hasPriorityGas !== undefined) q['has_priority_gas'] = p.hasPriorityGas
  if (p.cursor !== undefined) q['cursor'] = p.cursor
  if (p.limit !== undefined) q['limit'] = p.limit
  if (p.startTime !== undefined) q['start_time'] = encodeTime(p.startTime, 'isoSnake')
  if (p.endTime !== undefined) q['end_time'] = encodeTime(p.endTime, 'isoSnake')
  return q
}

function buildUserQuery(p: FillsUserParams): Query {
  const q = buildListQuery(p)
  if (p.timeRange !== undefined) {
    assertEnum(p.timeRange, TIME_RANGES, 'timeRange')
    q['time_range'] = p.timeRange
  }
  return q
}

function buildSpotQuery(p: SpotFillsListParams): Query {
  assertLimit(p.limit, SPOT_LIMIT_CAP)
  assertOptionalEnum(p.side, SIDES, 'side')
  const q: Query = {}
  if (p.coin !== undefined) q['coin'] = p.coin
  if (p.side !== undefined) q['side'] = p.side
  if (p.limit !== undefined) q['limit'] = p.limit
  if (p.offset !== undefined) q['offset'] = p.offset
  if (p.startTime !== undefined) q['start_time'] = encodeTime(p.startTime, 'isoSnake')
  if (p.endTime !== undefined) q['end_time'] = encodeTime(p.endTime, 'isoSnake')
  return q
}

/**
 * `/fills/*` resource. Covers the entire perp fills surface (full history,
 * 24h hot cache, per-user history, total count) plus the broken spot stubs.
 *
 * All perp endpoints use cursor pagination (APIResponse envelope) and accept
 * the same filter shape (`coin`, `side`, `hasPriorityGas`, time window,
 * `cursor`, `limit` 1..1000).
 *
 * Class-wide quirks defended in this resource (per PLAN.md §I):
 * - bug #1: `/fills/spot/*` returns 500 ClickHouse upstream — {@link Fills.spotList}
 *   and {@link Fills.spotUser} throw `ServerError` synchronously without a
 *   network round-trip and point callers at the `fills_spot` WS channel.
 * - bug #5: `side` and `timeRange` are validated against frozen enums client-side
 *   to defend against the server's silent fallback behaviour.
 * - bug #14: addresses on `/fills/user/{addr}` are validated client-side to
 *   match the early-rejection behaviour of the rest of the SDK.
 *
 * @see PLAN.md §I bug #1
 * @see PLAN.md §I bug #5
 * @see PLAN.md §I bug #14
 */
export class Fills {
  constructor(private readonly http: HttpClient) {}

  /**
   * `GET /fills/` — cursor-paginated full perp fills history.
   *
   * @param params - Optional filters and paging controls.
   * @param params.coin - Perp symbol (e.g. `"BTC"`). Omit for cross-coin.
   * @param params.side - `"A"` (ask / sell) or `"B"` (bid / buy). Validated client-side (§I #5).
   * @param params.hasPriorityGas - Restrict to fills that paid priority gas (HIP-3).
   * @param params.startTime - Lower time bound. Accepts `Date | number | string`; emitted as ISO `Z` (snake_case).
   * @param params.endTime - Upper time bound. Same shape as `startTime`.
   * @param params.cursor - Opaque cursor returned by a previous page (`meta.nextCursor`).
   * @param params.limit - Page size 1..1000 (server cap). Defaults to server default when omitted.
   * @returns `Page<Fill>` with `meta.nextCursor` and `meta.hasMore` for follow-up requests.
   * @throws {ValidationError} when `side` is not `A`/`B` or `limit` exceeds 1000.
   * @throws {ServerError} on upstream 5xx.
   * @throws {NetworkError} on transport failure or timeout.
   * @see PLAN.md §I bug #5
   */
  async list(params: FillsListParams = {}): Promise<Page<Fill>> {
    const raw = await this.http.request<unknown>({
      path: '/fills/',
      query: buildListQuery(params),
    })
    return unwrap<Fill>(raw, 'apiResponse')
  }

  /**
   * Async iterator over `/fills/` — transparently follows `meta.nextCursor`
   * until `meta.hasMore === false`.
   *
   * @param params - Same shape as {@link Fills.list}; `cursor` is managed by the iterator.
   * @returns An `AsyncIterable<Fill>` that yields fills one at a time across pages.
   * @throws {ValidationError} on bad enum/limit (raised lazily on the first network call).
   * @see PLAN.md §I bug #5
   */
  iterate(params: FillsListParams = {}): AsyncIterable<Fill> {
    return iterate<Fill, FillsListParams & Record<string, unknown>>(
      (p) => this.list(p),
      { ...params },
      { kind: 'cursor' },
    )
  }

  /**
   * `GET /fills/recent` — 24h hot-cache view; same item shape as {@link Fills.list}.
   *
   * @param params - Same filter shape as {@link Fills.list}.
   * @returns `Page<Fill>` over the trailing 24h window.
   * @throws {ValidationError} when `side` is invalid or `limit` exceeds 1000.
   * @throws {ServerError} on upstream 5xx.
   * @see PLAN.md §I bug #5
   */
  async recent(params: FillsRecentParams = {}): Promise<Page<Fill>> {
    const raw = await this.http.request<unknown>({
      path: '/fills/recent',
      query: buildListQuery(params),
    })
    return unwrap<Fill>(raw, 'apiResponse')
  }

  /**
   * Async iterator over `/fills/recent`.
   *
   * @param params - Same shape as {@link Fills.recent}.
   * @returns `AsyncIterable<Fill>` over the cached 24h window.
   * @see PLAN.md §I bug #5
   */
  iterateRecent(params: FillsRecentParams = {}): AsyncIterable<Fill> {
    return iterate<Fill, FillsRecentParams & Record<string, unknown>>(
      (p) => this.recent(p),
      { ...params },
      { kind: 'cursor' },
    )
  }

  /**
   * `GET /fills/user/{address}` — cursor-paginated fills for a specific wallet.
   *
   * @param address - Hyperliquid wallet address (0x-prefixed, 40 hex chars). Validated client-side.
   * @param params - Same filter shape as {@link Fills.list} plus `timeRange` (`'1h' | '24h' | '7d' | '30d'`).
   * @returns `Page<Fill>` scoped to the given user.
   * @throws {ValidationError} when `address` does not match the eth-address pattern,
   *   when `side` is invalid, when `timeRange` is not in the enum, or when `limit > 1000`.
   * @throws {ServerError} on upstream 5xx.
   * @see PLAN.md §I bug #5
   * @see PLAN.md §I bug #14
   * @remarks
   * Sibling endpoints (e.g. `/users/{addr}/overview`) silently return zeroed
   * sentinel responses on a malformed address instead of 422. The SDK validates
   * the address pattern client-side to normalise this behaviour: every
   * address-scoped method throws `ValidationError` before sending.
   */
  async user(address: string, params: FillsUserParams = {}): Promise<Page<Fill>> {
    assertAddress(address, 'address')
    const raw = await this.http.request<unknown>({
      path: joinPath('fills', 'user', address),
      query: buildUserQuery(params),
    })
    return unwrap<Fill>(raw, 'apiResponse')
  }

  /**
   * Async iterator over `/fills/user/{address}`.
   *
   * @param address - Hyperliquid wallet address (0x-prefixed, 40 hex chars).
   * @param params - Same shape as {@link Fills.user}.
   * @returns `AsyncIterable<Fill>` scoped to the user.
   * @throws {ValidationError} on bad address (eagerly) or bad enums/limit (lazily on first fetch).
   * @see PLAN.md §I bug #14
   */
  iterateUser(address: string, params: FillsUserParams = {}): AsyncIterable<Fill> {
    assertAddress(address, 'address')
    return iterate<Fill, FillsUserParams & Record<string, unknown>>(
      (p) => this.user(address, p),
      { ...params },
      { kind: 'cursor' },
    )
  }

  /**
   * `GET /fills/count` — single-record total fill counter.
   *
   * @returns `Single<FillsCount>` with `data.count`, `data.timestamp`, and
   *   `data.execution_time_ms`.
   * @throws {ServerError} on upstream 5xx.
   * @throws {NetworkError} on transport failure or timeout.
   * @remarks
   * The envelope `execution_time_ms` is `null` upstream on this endpoint; the
   * payload's own `data.execution_time_ms` is preserved.
   */
  async count(): Promise<Single<FillsCount>> {
    const raw = await this.http.request<unknown>({ path: '/fills/count' })
    return unwrapSingle<FillsCount>(raw, 'apiResponse')
  }

  /**
   * `GET /fills/spot/` — BROKEN UPSTREAM. Rejects synchronously with
   * `ServerError` without making a network round-trip.
   *
   * @param params - Validated client-side (`side`, `limit` 1..1000) so bad input
   *   still surfaces as `ValidationError` for API parity.
   * @returns Never resolves — always throws.
   * @throws {ValidationError} when input fails the same client-side checks as the perp methods.
   * @throws {ServerError} unconditionally (status 500) with a message pointing at
   *   the WebSocket `fills_spot` channel as the working alternative.
   * @see PLAN.md §I bug #1
   * @remarks
   * `/fills/spot/*` returns 500 ClickHouse on the backend. The SDK refuses to
   * waste a request on it; subscribe to `client.ws.subscribe('fills_spot')`
   * instead. The stub is kept so the typed surface stays complete and so the
   * method can be flipped to a real call once the backend is fixed.
   */
  async spotList(params: SpotFillsListParams = {}): Promise<Page<SpotFill>> {
    // Run client-side validation first so callers that pass bogus params still
    // get a `ValidationError` (preserves the contract of every other method).
    buildSpotQuery(params)
    throw new ServerError(SPOT_BUG_MESSAGE, { status: 500 })
  }

  /**
   * `GET /fills/spot/user/{address}` — BROKEN UPSTREAM. Rejects synchronously
   * with `ServerError` without making a network round-trip.
   *
   * @param address - Hyperliquid wallet address (0x-prefixed, 40 hex chars). Validated client-side.
   * @param params - Same filter shape as {@link Fills.spotList}.
   * @returns Never resolves — always throws.
   * @throws {ValidationError} when `address` or any other input fails client-side validation.
   * @throws {ServerError} unconditionally (status 500) with a message pointing at the WS channel.
   * @see PLAN.md §I bug #1
   * @see PLAN.md §I bug #14
   * @remarks
   * Same posture as {@link Fills.spotList}: spot REST is unusable, so the
   * method throws without hitting the network. Use `client.ws.subscribe('fills_spot')`
   * with an `addr` filter instead.
   */
  async spotUser(address: string, params: SpotFillsUserParams = {}): Promise<Page<SpotFill>> {
    assertAddress(address, 'address')
    buildSpotQuery(params)
    throw new ServerError(SPOT_BUG_MESSAGE, { status: 500 })
  }
}
