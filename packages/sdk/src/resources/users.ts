import { assertAddress } from '../internal/address.js'
import { assertEnum, assertLimit } from '../internal/assert.js'
import { joinPath } from '../internal/url.js'
import { encodeTime } from '../time/index.js'
import type { HttpClient } from '../transport/HttpClient.js'
import { unwrap, unwrapSingle } from '../transport/envelopes.js'
import type { Address, Page, Single } from '../types/common.js'
import type {
  ActiveUser,
  ActiveUsersParams,
  LeaderboardBy,
  LeaderboardByPnl,
  LeaderboardByPriorityFees,
  LeaderboardByTrades,
  LeaderboardByVolume,
  LeaderboardEntry,
  LeaderboardParams,
  UserCoinAggregate,
  UserCoinsParams,
  UserOverview,
  UserOverviewParams,
  UserPerformance,
} from '../types/user.js'

const LEADERBOARD_BY_VALUES = ['volume', 'pnl', 'trades', 'priority_fees'] as const

const LIMIT_CAP = 100
const HOURS_CAP = 168

type Query = Record<string, string | number | boolean | null | undefined>

/**
 * Builds the optional `start_time` / `end_time` ISO snake_case query params
 * for user-scoped endpoints. Returns an empty object if both are unset.
 */
function timeWindowQuery(params: UserOverviewParams | undefined): Query {
  const q: Query = {}
  if (params?.startTime !== undefined) q['start_time'] = encodeTime(params.startTime, 'isoSnake')
  if (params?.endTime !== undefined) q['end_time'] = encodeTime(params.endTime, 'isoSnake')
  return q
}

/**
 * Resource handler for the `/users/*` endpoints.
 *
 * Defends against PLAN.md §I bugs:
 *   - #14: bad-address sentinel-zeroed response → `assertAddress` before
 *          sending on `overview` / `performance` / `coins`.
 *   - #17: `last_activity = "1970-01-01T00:00:00"` sentinel → documented on
 *          {@link UserOverview.last_activity}; use `parseTimestamp(value, 'iso')`.
 *   - #23: polymorphic leaderboard → discriminated union with one overload
 *          per `by` value.
 */
export class UsersResource {
  constructor(private readonly http: HttpClient) {}

  /**
   * `GET /users/{user}/overview` — single per-user aggregate.
   *
   * Validates `user` client-side because the server returns a 200 with zeroed
   * fields on a malformed address (PLAN.md §I #14).
   */
  async overview(user: Address, params?: UserOverviewParams): Promise<Single<UserOverview>> {
    assertAddress(user, 'user')
    const raw = await this.http.request<unknown>({
      path: joinPath('users', user, 'overview'),
      query: timeWindowQuery(params),
    })
    return unwrapSingle<UserOverview>(raw, 'apiResponse')
  }

  /**
   * `GET /users/{user}/performance` — single per-user performance summary.
   *
   * Validates `user` client-side (PLAN.md §I #14).
   */
  async performance(user: Address, params?: UserOverviewParams): Promise<Single<UserPerformance>> {
    assertAddress(user, 'user')
    const raw = await this.http.request<unknown>({
      path: joinPath('users', user, 'performance'),
      query: timeWindowQuery(params),
    })
    return unwrapSingle<UserPerformance>(raw, 'apiResponse')
  }

  /**
   * `GET /users/{user}/coins` — offset-paginated per-coin aggregates.
   *
   * Validates `user` client-side (PLAN.md §I #14) and caps `limit` at 100.
   */
  async coins(user: Address, params?: UserCoinsParams): Promise<Page<UserCoinAggregate>> {
    assertAddress(user, 'user')
    assertLimit(params?.limit, LIMIT_CAP)
    const query: Query = { ...timeWindowQuery(params) }
    if (params?.limit !== undefined) query['limit'] = params.limit
    if (params?.offset !== undefined) query['offset'] = params.offset
    const raw = await this.http.request<unknown>({
      path: joinPath('users', user, 'coins'),
      query,
    })
    return unwrap<UserCoinAggregate>(raw, 'apiResponse')
  }

  /**
   * `GET /users/leaderboard` — none-list, polymorphic on `by` (PLAN.md §I #23).
   *
   * The row shape varies with `by` ('volume' | 'pnl' | 'trades' | 'priority_fees').
   * Overloads on the literal type narrow the return type to the matching
   * discriminated union member.
   */
  async leaderboard(params: LeaderboardParams<'volume'>): Promise<Page<LeaderboardByVolume>>
  async leaderboard(params: LeaderboardParams<'pnl'>): Promise<Page<LeaderboardByPnl>>
  async leaderboard(params: LeaderboardParams<'trades'>): Promise<Page<LeaderboardByTrades>>
  async leaderboard(
    params: LeaderboardParams<'priority_fees'>,
  ): Promise<Page<LeaderboardByPriorityFees>>
  async leaderboard<B extends LeaderboardBy>(
    params: LeaderboardParams<B>,
  ): Promise<Page<LeaderboardEntry<B>>>
  async leaderboard<B extends LeaderboardBy>(
    params: LeaderboardParams<B>,
  ): Promise<Page<LeaderboardEntry<B>>> {
    assertEnum(params.by, LEADERBOARD_BY_VALUES, 'by')
    assertLimit(params.hours, HOURS_CAP, 'hours')
    assertLimit(params.limit, LIMIT_CAP)
    const query: Query = { by: params.by }
    if (params.hours !== undefined) query['hours'] = params.hours
    if (params.limit !== undefined) query['limit'] = params.limit
    const raw = await this.http.request<unknown>({
      path: '/users/leaderboard',
      query,
    })
    return unwrap<LeaderboardEntry<B>>(raw, 'apiResponse')
  }

  /**
   * `GET /users/active` — offset-paginated recently-active users.
   *
   * `hours` cap = 168, `limit` cap = 100.
   */
  async active(params?: ActiveUsersParams): Promise<Page<ActiveUser>> {
    assertLimit(params?.hours, HOURS_CAP, 'hours')
    assertLimit(params?.limit, LIMIT_CAP)
    const query: Query = {}
    if (params?.hours !== undefined) query['hours'] = params.hours
    if (params?.limit !== undefined) query['limit'] = params.limit
    if (params?.offset !== undefined) query['offset'] = params.offset
    const raw = await this.http.request<unknown>({
      path: '/users/active',
      query,
    })
    return unwrap<ActiveUser>(raw, 'apiResponse')
  }
}
