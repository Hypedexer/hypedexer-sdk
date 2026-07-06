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
 * `/fills/*` resource. Covers the entire perp AND spot fills surface (full
 * history, 24h hot cache, per-user history, total count).
 *
 * Perp endpoints use cursor pagination; spot endpoints use offset pagination.
 * All share the APIResponse envelope shape.
 *
 * Class-wide quirks defended in this resource (per PLAN.md §I):
 * - bug #5: `side` and `timeRange` are validated against frozen enums client-side
 *   to defend against the server's silent fallback behaviour.
 * - bug #14: addresses on `/fills/user/{addr}` are validated client-side to
 *   match the early-rejection behaviour of the rest of the SDK.
 *
 * Historical note: `/fills/spot/*` returned 500 ClickHouse upstream when this
 * resource was first authored (PLAN.md §I #1). That has since been fixed
 * upstream and both spot methods now issue real requests.
 *
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
   * `GET /fills/spot/` — offset-paginated spot fills history (APIResponse envelope).
   *
   * @param params - Optional filters (`coin`, `side`, time window) plus
   *   `limit` (1..1000, defaults to server side) and `offset` for paging.
   * @returns `Page<SpotFill>` with the standard envelope meta. Offset-paginated,
   *   so callers walk pages by incrementing `offset` until they receive
   *   fewer rows than `limit`.
   * @throws {ValidationError} when `side` is not `'A' | 'B'` or `limit` exceeds
   *   the 1000 cap.
   * @throws {ServerError} on upstream 5xx.
   * @throws {NetworkError} on transport failure.
   * @remarks
   * Historical note: this path returned 500 ClickHouse until the upstream fix
   * (PLAN.md §I #1). The stream-shaped alternative
   * `client.ws.subscribe('fills_spot')` is still available for low-latency use.
   */
  async spotList(params: SpotFillsListParams = {}): Promise<Page<SpotFill>> {
    const raw = await this.http.request<unknown>({
      path: '/fills/spot/',
      query: buildSpotQuery(params),
    })
    return unwrap<SpotFill>(raw, 'apiResponse')
  }

  /**
   * `GET /fills/spot/user/{address}` — offset-paginated per-user spot fills.
   *
   * @param address - Hyperliquid wallet address (0x-prefixed, 40 hex chars).
   *   Validated client-side (PLAN.md §I #14).
   * @param params - Same filter shape as {@link Fills.spotList}.
   * @returns `Page<SpotFill>` scoped to `address`.
   * @throws {ValidationError} when `address` fails the on-chain shape check
   *   or when other params fail client-side validation.
   * @throws {ServerError} on upstream 5xx.
   * @throws {NetworkError} on transport failure.
   */
  async spotUser(address: string, params: SpotFillsUserParams = {}): Promise<Page<SpotFill>> {
    assertAddress(address, 'address')
    const raw = await this.http.request<unknown>({
      path: joinPath('fills', 'spot', 'user', address),
      query: buildSpotQuery(params),
    })
    return unwrap<SpotFill>(raw, 'apiResponse')
  }
}
