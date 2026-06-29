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
 * `/fills/*` resource. Cursor pagination on perp endpoints; spot REST is broken
 * upstream (PLAN §I #1) so the spot methods throw `ServerError` synchronously
 * without making a network call.
 */
export class Fills {
  constructor(private readonly http: HttpClient) {}

  /** GET `/fills/` — cursor pagination, 1..1000 limit. */
  async list(params: FillsListParams = {}): Promise<Page<Fill>> {
    const raw = await this.http.request<unknown>({
      path: '/fills/',
      query: buildListQuery(params),
    })
    return unwrap<Fill>(raw, 'apiResponse')
  }

  /** Async iterator over `/fills/` pages — see PLAN §D.2. */
  iterate(params: FillsListParams = {}): AsyncIterable<Fill> {
    return iterate<Fill, FillsListParams & Record<string, unknown>>(
      (p) => this.list(p),
      { ...params },
      { kind: 'cursor' },
    )
  }

  /** GET `/fills/recent` — same shape as `/fills/` with a 24h cache (batch-1). */
  async recent(params: FillsRecentParams = {}): Promise<Page<Fill>> {
    const raw = await this.http.request<unknown>({
      path: '/fills/recent',
      query: buildListQuery(params),
    })
    return unwrap<Fill>(raw, 'apiResponse')
  }

  /** Async iterator over `/fills/recent`. */
  iterateRecent(params: FillsRecentParams = {}): AsyncIterable<Fill> {
    return iterate<Fill, FillsRecentParams & Record<string, unknown>>(
      (p) => this.recent(p),
      { ...params },
      { kind: 'cursor' },
    )
  }

  /**
   * GET `/fills/user/{address}` — cursor pagination. Address is validated
   * client-side because sibling endpoints (e.g. `/users/{addr}/overview`)
   * silently return zeros on bad addresses (PLAN §I #14); we normalize the
   * behaviour and always reject early.
   */
  async user(address: string, params: FillsUserParams = {}): Promise<Page<Fill>> {
    assertAddress(address, 'address')
    const raw = await this.http.request<unknown>({
      path: joinPath('fills', 'user', address),
      query: buildUserQuery(params),
    })
    return unwrap<Fill>(raw, 'apiResponse')
  }

  /** Async iterator over `/fills/user/{address}`. */
  iterateUser(address: string, params: FillsUserParams = {}): AsyncIterable<Fill> {
    assertAddress(address, 'address')
    return iterate<Fill, FillsUserParams & Record<string, unknown>>(
      (p) => this.user(address, p),
      { ...params },
      { kind: 'cursor' },
    )
  }

  /**
   * GET `/fills/count` — single-record. Envelope `execution_time_ms` is `null`
   * upstream on this endpoint; `data.execution_time_ms` is preserved on the
   * payload itself.
   */
  async count(): Promise<Single<FillsCount>> {
    const raw = await this.http.request<unknown>({ path: '/fills/count' })
    return unwrapSingle<FillsCount>(raw, 'apiResponse')
  }

  /**
   * GET `/fills/spot/` — BROKEN UPSTREAM. Rejects with `ServerError` without
   * making a network call (PLAN §I #1). Use the WebSocket `fills_spot` channel.
   */
  async spotList(params: SpotFillsListParams = {}): Promise<Page<SpotFill>> {
    // Run client-side validation first so callers that pass bogus params still
    // get a `ValidationError` (preserves the contract of every other method).
    buildSpotQuery(params)
    throw new ServerError(SPOT_BUG_MESSAGE, { status: 500 })
  }

  /**
   * GET `/fills/spot/user/{address}` — BROKEN UPSTREAM. Rejects with
   * `ServerError` without making a network call (PLAN §I #1). Use the
   * WebSocket `fills_spot` channel.
   */
  async spotUser(address: string, params: SpotFillsUserParams = {}): Promise<Page<SpotFill>> {
    assertAddress(address, 'address')
    buildSpotQuery(params)
    throw new ServerError(SPOT_BUG_MESSAGE, { status: 500 })
  }
}
