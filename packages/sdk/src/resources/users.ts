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
 * `/users/*` resource. Covers per-user aggregates, the polymorphic
 * leaderboard, and the recently-active feed.
 *
 * Class-wide quirks defended in this resource (per PLAN.md §I):
 * - bug #5: `leaderboard.by` is validated client-side against the frozen
 *   `'volume' | 'pnl' | 'trades' | 'priority_fees'` enum to defend against
 *   the server's silent enum-fallback behaviour.
 * - bug #14: `/users/{addr}/overview` returns 200 + zeroed sentinel on a bad
 *   address (no 422). The SDK validates the eth-address pattern client-side
 *   on every address-scoped method ({@link UsersResource.overview},
 *   {@link UsersResource.performance}, {@link UsersResource.coins}) so the
 *   failure mode is consistent with the rest of the surface.
 * - bug #17: `last_activity = "1970-01-01T00:00:00"` sentinel on overview
 *   means "never active"; documented on {@link UserOverview.last_activity}.
 *   Use `parseTimestamp(value, 'iso')` to get `Date | null`.
 * - bug #23: `/users/leaderboard` returns shape-shifting `data[]` rows keyed
 *   on `by`. SDK exposes a discriminated union via overloads on
 *   {@link UsersResource.leaderboard} so the row type narrows to match.
 *
 * @see PLAN.md §I bug #5
 * @see PLAN.md §I bug #14
 * @see PLAN.md §I bug #17
 * @see PLAN.md §I bug #23
 */
export class UsersResource {
  constructor(private readonly http: HttpClient) {}

  /**
   * `GET /users/{user}/overview` — single per-user aggregate.
   *
   * @param user - Hyperliquid wallet address (0x-prefixed, 40 hex chars). Validated client-side (§I #14).
   * @param params - Optional time-window.
   * @param params.startTime - Lower bound. Accepts `Date | number | string`; emitted as ISO `Z` snake_case.
   * @param params.endTime - Upper bound. Same shape as `startTime`.
   * @returns `Single<UserOverview>` aggregate (totals, trade count, PnL, win rate, last activity).
   * @throws {ValidationError} when `user` is not a valid eth-address.
   * @throws {ServerError} on upstream 5xx.
   * @throws {NetworkError} on transport failure or timeout.
   * @see PLAN.md §I bug #14
   * @see PLAN.md §I bug #17
   * @remarks
   * The server returns 200 + zeroed fields for malformed addresses instead of
   * 422 (§I #14). The SDK throws {@link ValidationError} client-side before
   * sending. Note also that `last_activity` may be the sentinel
   * `"1970-01-01T00:00:00"` (§I #17) meaning "never active" — use
   * `parseTimestamp(value, 'iso')` to get a `Date | null`.
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
   * `GET /users/{user}/performance` — single per-user performance summary
   * (win rate, average win/loss, profit factor, max drawdown, etc.).
   *
   * @param user - Hyperliquid wallet address (0x-prefixed, 40 hex chars). Validated client-side (§I #14).
   * @param params - Optional time-window.
   * @param params.startTime - Lower bound. Accepts `Date | number | string`; emitted as ISO `Z` snake_case.
   * @param params.endTime - Upper bound. Same shape as `startTime`.
   * @returns `Single<UserPerformance>` performance summary.
   * @throws {ValidationError} when `user` is not a valid eth-address.
   * @throws {ServerError} on upstream 5xx.
   * @throws {NetworkError} on transport failure or timeout.
   * @see PLAN.md §I bug #14
   * @remarks
   * `avg_holding_time_s` is currently inflated upstream (server likely includes
   * never-closed positions in the average). The SDK ships the raw value
   * untouched — see {@link UserPerformance.avg_holding_time_s}.
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
   * `GET /users/{user}/coins` — offset-paginated per-coin aggregates for a user.
   *
   * @param user - Hyperliquid wallet address (0x-prefixed, 40 hex chars). Validated client-side (§I #14).
   * @param params - Optional filters and paging controls.
   * @param params.startTime - Lower bound. Accepts `Date | number | string`; emitted as ISO `Z` snake_case.
   * @param params.endTime - Upper bound. Same shape as `startTime`.
   * @param params.limit - Page size 1..100. Validated client-side.
   * @param params.offset - Zero-based offset for paging (defaults to 0 server-side).
   * @returns `Page<UserCoinAggregate>` rows of `(coin, volume, fill_count, fees, avg_price, price_range, pnl)`.
   * @throws {ValidationError} when `user` is not a valid eth-address or `limit > 100`.
   * @throws {ServerError} on upstream 5xx.
   * @throws {NetworkError} on transport failure or timeout.
   * @see PLAN.md §I bug #14
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
   * The row shape varies with `by`:
   * - `'volume'` → {@link LeaderboardByVolume} `(total_volume, fill_count, unique_coins)`
   * - `'pnl'` → {@link LeaderboardByPnl} `(total_pnl, trade_count)`
   * - `'trades'` → {@link LeaderboardByTrades} `(fill_count, total_volume)`
   * - `'priority_fees'` → {@link LeaderboardByPriorityFees} `(total_priority_gas, fill_count)`
   *
   * @param params - Required scope.
   * @param params.by - Discriminator. One of `'volume' | 'pnl' | 'trades' | 'priority_fees'`. Validated client-side (§I #5).
   * @param params.hours - Look-back window in hours, 1..168.
   * @param params.limit - Page size 1..100.
   * @returns `Page<LeaderboardEntry<B>>` — full list in one call (no pagination). Row type narrows to match `by`.
   * @throws {ValidationError} when `by` is not in the enum, when `hours > 168`, or when `limit > 100`.
   * @throws {ServerError} on upstream 5xx.
   * @throws {NetworkError} on transport failure or timeout.
   * @see PLAN.md §I bug #5
   * @see PLAN.md §I bug #23
   * @remarks
   * The server returns shape-shifting `data[]` rows keyed on `by`. Calling
   * code that joins fields like `total_pnl` against a `'volume'` result would
   * silently get `undefined`. The SDK uses overloads on the literal `by` value
   * to narrow the row type at compile-time so this never compiles.
   * {@link LeaderboardByPriorityFees.total_priority_gas} is currently always 0
   * upstream (§I #6) — pass-through, not normalized.
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
   * `GET /users/active` — offset-paginated recently-active users feed.
   *
   * @param params - Optional filters and paging controls.
   * @param params.hours - Activity window in hours, 1..168. Defaults server-side to 1.
   * @param params.limit - Page size 1..100. Validated client-side.
   * @param params.offset - Zero-based offset for paging (defaults to 0 server-side).
   * @returns `Page<ActiveUser>` rows of `(user, fill_count, total_volume, unique_coins, last_activity)`.
   * @throws {ValidationError} when `hours > 168` or `limit > 100`.
   * @throws {ServerError} on upstream 5xx.
   * @throws {NetworkError} on transport failure or timeout.
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
