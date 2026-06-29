import { assertAddress } from '../internal/address.js'
import { assertLimit, assertOptionalEnum } from '../internal/assert.js'
import { joinPath } from '../internal/url.js'
import { iterate } from '../pagination/iterator.js'
import type { HttpClient } from '../transport/HttpClient.js'
import { unwrap, unwrapSingle } from '../transport/envelopes.js'
import type {
  Builder,
  BuilderAddrStatsData,
  BuilderAddrStatsParams,
  BuilderEntry,
  BuilderTimeframe,
  BuilderTopSort,
  BuilderUser,
  BuilderUsersData,
  BuilderUsersParams,
  BuildersStatsAllTimeframesData,
  BuildersStatsData,
  BuildersStatsParams,
  BuildersTopData,
  BuildersTopParams,
} from '../types/builder.js'
import type { Page, Single } from '../types/common.js'

const TOP_LIMIT_CAP = 100

const TIMEFRAMES = ['1h', '24h', '7d', '30d'] as const satisfies readonly BuilderTimeframe[]
const TOP_SORTS = [
  'volume',
  'fees',
  'builder_fees',
  'fills',
  'users',
] as const satisfies readonly BuilderTopSort[]

type Query = Record<string, string | number | boolean | null | undefined>

function buildTopQuery(params: BuildersTopParams): Query {
  // PLAN.md §I #5: `/builders/top?sort=…` silent-falls-back to `volume` on
  // bogus values. We reject client-side instead.
  assertOptionalEnum(params.sort, TOP_SORTS, 'sort')
  assertOptionalEnum(params.timeframe, TIMEFRAMES, 'timeframe')
  assertLimit(params.limit, TOP_LIMIT_CAP)
  const q: Query = {}
  if (params.timeframe !== undefined) q['timeframe'] = params.timeframe
  if (params.sort !== undefined) q['sort'] = params.sort
  if (params.limit !== undefined) q['limit'] = params.limit
  if (params.offset !== undefined) q['offset'] = params.offset
  return q
}

function buildTimeframeOnlyQuery(timeframe: BuilderTimeframe | undefined): Query {
  assertOptionalEnum(timeframe, TIMEFRAMES, 'timeframe')
  const q: Query = {}
  if (timeframe !== undefined) q['timeframe'] = timeframe
  return q
}

function buildUsersQuery(params: BuilderUsersParams): Query {
  assertOptionalEnum(params.timeframe, TIMEFRAMES, 'timeframe')
  const q: Query = {}
  if (params.timeframe !== undefined) q['timeframe'] = params.timeframe
  if (params.limit !== undefined) q['limit'] = params.limit
  if (params.offset !== undefined) q['offset'] = params.offset
  return q
}

/**
 * Resource handler for the `/builders/*` endpoints (batch-6).
 *
 * All endpoints use the `apiResponse` envelope. The `data` payload is
 * polymorphic across this resource: `/builders/list` returns a bare array,
 * while `/builders/top`, `/builders/stats(/...)`, `/builders/{addr}/stats`
 * and `/builders/{addr}/users` each return an object wrapping their list.
 *
 * Defends against PLAN.md §I bugs:
 *   - #5: `/builders/top?sort=bogus` silent fallback to `volume` → client-side
 *         `assertEnum` on `sort` (also on `timeframe` for symmetry).
 *
 * Notes:
 *   - `/builders/{addr}/stats` returns a 200 with `builderName: null` when
 *     the address is unknown (no 404). The SDK still validates the address
 *     client-side for consistency with sibling endpoints (PLAN.md §I #14).
 *   - `total_count` on this resource is `null` everywhere; the human total is
 *     embedded in `message` ("<N> builders found"). The SDK passes both through.
 */
export class BuildersResource {
  constructor(private readonly http: HttpClient) {}

  /**
   * `GET /builders/top` — top builders for a trailing window, sorted by the
   * chosen metric. Note the response `data` is an OBJECT
   * `{timeframe, sort, builders[]}`, not a bare array. Use
   * {@link BuildersResource.iterateTop} to yield {@link Builder} rows directly.
   *
   * `sort` is validated client-side (PLAN.md §I #5); `limit` cap = 100.
   */
  async top(params: BuildersTopParams = {}): Promise<Single<BuildersTopData>> {
    const raw = await this.http.request<unknown>({
      path: '/builders/top',
      query: buildTopQuery(params),
    })
    return unwrapSingle<BuildersTopData>(raw, 'apiResponse')
  }

  /**
   * Async iterator over the {@link Builder} rows from `/builders/top` via
   * offset pagination. Same client-side validation as {@link top}.
   *
   * Defaults `limit` to 100 (the cap) so each request fetches the maximum
   * allowed batch.
   */
  iterateTop(params: BuildersTopParams = {}): AsyncIterable<Builder> {
    // Pre-validate so callers see ValidationError synchronously (matches the
    // fills/users/completed-trades convention).
    buildTopQuery(params)
    const limit = params.limit ?? TOP_LIMIT_CAP
    return iterate<Builder, Record<string, unknown>>(
      async (p) => {
        const single = await this.top(p as BuildersTopParams)
        const builders = single.data?.builders ?? []
        return { data: [...builders], meta: single.meta }
      },
      { ...params, limit },
      { kind: 'offset', limit },
    )
  }

  /**
   * `GET /builders/stats` — global builders stats for a trailing window
   * (defaults to `24h` on the server). `variations.*Pct` values can be
   * `null` when the previous period has zero activity.
   */
  async stats(params: BuildersStatsParams = {}): Promise<Single<BuildersStatsData>> {
    const raw = await this.http.request<unknown>({
      path: '/builders/stats',
      query: buildTimeframeOnlyQuery(params.timeframe),
    })
    return unwrapSingle<BuildersStatsData>(raw, 'apiResponse')
  }

  /**
   * `GET /builders/stats/all-timeframes` — single response keyed by every
   * supported timeframe (`'1h' | '24h' | '7d' | '30d'`).
   *
   * The inner shape mirrors {@link BuildersStatsData} minus the redundant
   * `timeframe` field (it's the key in the outer record).
   */
  async statsAllTimeframes(): Promise<Single<BuildersStatsAllTimeframesData>> {
    const raw = await this.http.request<unknown>({
      path: '/builders/stats/all-timeframes',
    })
    return unwrapSingle<BuildersStatsAllTimeframesData>(raw, 'apiResponse')
  }

  /**
   * `GET /builders/{addr}/stats` — per-builder stats + `coinBreakdown`.
   *
   * Validates `addr` client-side even though the server returns 200 on any
   * valid 0x address (PLAN.md §I #14). Unknown builders surface as
   * `builderName: null` with sparse stats.
   */
  async addrStats(
    addr: string,
    params: BuilderAddrStatsParams = {},
  ): Promise<Single<BuilderAddrStatsData>> {
    assertAddress(addr, 'addr')
    const raw = await this.http.request<unknown>({
      path: joinPath('builders', addr, 'stats'),
      query: buildTimeframeOnlyQuery(params.timeframe),
    })
    return unwrapSingle<BuilderAddrStatsData>(raw, 'apiResponse')
  }

  /**
   * `GET /builders/{addr}/users` — users that traded through the builder.
   *
   * Response `data` is an OBJECT `{timeframe, builder, users[]}`. Use
   * {@link BuildersResource.iterateUsers} to yield {@link BuilderUser} rows
   * directly. No documented server-side cap on `limit`.
   */
  async users(addr: string, params: BuilderUsersParams = {}): Promise<Single<BuilderUsersData>> {
    assertAddress(addr, 'addr')
    const raw = await this.http.request<unknown>({
      path: joinPath('builders', addr, 'users'),
      query: buildUsersQuery(params),
    })
    return unwrapSingle<BuilderUsersData>(raw, 'apiResponse')
  }

  /**
   * Async iterator over the {@link BuilderUser} rows from
   * `/builders/{addr}/users` via offset pagination.
   */
  iterateUsers(addr: string, params: BuilderUsersParams = {}): AsyncIterable<BuilderUser> {
    assertAddress(addr, 'addr')
    // Pre-validate other params synchronously.
    buildUsersQuery(params)
    const limit = params.limit ?? 100
    return iterate<BuilderUser, Record<string, unknown>>(
      async (p) => {
        const single = await this.users(addr, p as BuilderUsersParams)
        const users = single.data?.users ?? []
        return { data: [...users], meta: single.meta }
      },
      { ...params, limit },
      { kind: 'offset', limit },
    )
  }

  /**
   * `GET /builders/list` — flat directory of every registered builder.
   *
   * No pagination supported upstream; the full list (~640 rows at the time
   * of writing) is returned in one call. The `data` payload IS a bare array
   * for this endpoint, so the SDK exposes it as a `Page<BuilderEntry>`.
   */
  async list(): Promise<Page<BuilderEntry>> {
    const raw = await this.http.request<unknown>({ path: '/builders/list' })
    return unwrap<BuilderEntry>(raw, 'apiResponse')
  }
}
