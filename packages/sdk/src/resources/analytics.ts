import { ValidationError } from '../errors/index.js'
import { assertLimit } from '../internal/assert.js'
import { encodeTime } from '../time/index.js'
import type { HttpClient } from '../transport/HttpClient.js'
import { unwrap, unwrapSingle } from '../transport/envelopes.js'
import type {
  FillsStatsData,
  FillsStatsParams,
  GossipLeaderboardEntry,
  GossipLeaderboardParams,
  LiquidationsStatsData,
  LiquidationsStatsParams,
  PriorityFeesChartDailyParams,
  PriorityFeesDailyPoint,
  PriorityFeesStatsData,
  PriorityFeesStatsParams,
} from '../types/analytics.js'
import type { Page, Single } from '../types/common.js'

const FILLS_STATS_HOURS_CAP = 168
const PRIORITY_FEES_STATS_HOURS_CAP = 168
const GOSSIP_LIMIT_CAP = 200
const LIQUIDATIONS_STATS_DAYS_CAP = 30

interface RawGossipLeaderboardEntry {
  readonly address: string
  readonly totalGas: number
  readonly count: number
  readonly daysActive: number
}

function assertOptionalPositiveInt(value: number | undefined, paramName: string): void {
  if (value === undefined) return
  if (
    typeof value !== 'number' ||
    !Number.isFinite(value) ||
    !Number.isInteger(value) ||
    value < 1
  ) {
    throw new ValidationError(`invalid value for "${paramName}"`, [
      {
        msg: 'value must be a positive integer (>= 1)',
        loc: [paramName],
        type: 'sdk_validation',
        input: value,
      },
    ])
  }
}

/**
 * Analytics resource — `/analytics/*` (batch-2).
 *
 * All endpoints return `APIResponse<T>`. `*-stats` endpoints expose a single
 * aggregate snapshot (no pagination); chart and leaderboard endpoints return
 * the full list in one call (also no pagination).
 *
 * Class-wide quirks defended (per PLAN.md §I):
 * - bug #9: `priorityFeesGossipLeaderboard` rows ship an IPv4 in `address`,
 *   not a wallet — the SDK renames it to `nodeIp` on the typed model.
 *
 * @see PLAN.md §I bug #9
 */
export class AnalyticsResource {
  constructor(private readonly http: HttpClient) {}

  /**
   * `GET /analytics/fills/stats` — fills volume / fees / unique-users snapshot
   * for the trailing `hours` window.
   *
   * @param params - Optional snapshot scope.
   * @param params.hours - Look-back window in hours, 1..168 (server defaults to 1 when omitted).
   * @param params.coin - Perp symbol filter (e.g. `"ETH"`). Echoed back on the response.
   * @returns `Single<FillsStatsData>` aggregate snapshot.
   * @throws {ValidationError} when `hours` is not a positive integer or exceeds 168.
   * @throws {ServerError} on upstream 5xx.
   * @throws {NetworkError} on transport failure or timeout.
   */
  async fillsStats(params: FillsStatsParams = {}): Promise<Single<FillsStatsData>> {
    assertOptionalPositiveInt(params.hours, 'hours')
    assertLimit(params.hours, FILLS_STATS_HOURS_CAP, 'hours')
    const raw = await this.http.request<unknown>({
      path: '/analytics/fills/stats',
      query: {
        hours: params.hours,
        coin: params.coin,
      },
    })
    return unwrapSingle<FillsStatsData>(raw, 'apiResponse')
  }

  /**
   * `GET /analytics/priority-fees/stats` — priority-gas snapshot for the
   * trailing `hours` window.
   *
   * @param params - Optional snapshot scope.
   * @param params.hours - Look-back window in hours, 1..168 (server defaults to 1 when omitted).
   * @param params.coin - Perp symbol filter. Echoed back on the response.
   * @returns `Single<PriorityFeesStatsData>` aggregate snapshot of priority-fee KPIs.
   * @throws {ValidationError} when `hours` is not a positive integer or exceeds 168.
   * @throws {ServerError} on upstream 5xx.
   * @throws {NetworkError} on transport failure or timeout.
   */
  async priorityFeesStats(
    params: PriorityFeesStatsParams = {},
  ): Promise<Single<PriorityFeesStatsData>> {
    assertOptionalPositiveInt(params.hours, 'hours')
    assertLimit(params.hours, PRIORITY_FEES_STATS_HOURS_CAP, 'hours')
    const raw = await this.http.request<unknown>({
      path: '/analytics/priority-fees/stats',
      query: {
        hours: params.hours,
        coin: params.coin,
      },
    })
    return unwrapSingle<PriorityFeesStatsData>(raw, 'apiResponse')
  }

  /**
   * `GET /analytics/priority-fees/chart/daily` — full daily series of
   * priority-fee aggregates.
   *
   * @param params - Optional time-window filter.
   * @param params.startTime - Lower bound. Accepts `Date | number | string`; emitted as ISO `Z` snake_case.
   * @param params.endTime - Upper bound. Same shape as `startTime`.
   * @returns `Page<PriorityFeesDailyPoint>` returned in one call (no pagination).
   * @throws {ValidationError} if a date is unparseable.
   * @throws {ServerError} on upstream 5xx.
   * @throws {NetworkError} on transport failure or timeout.
   * @remarks
   * Default server lookback is ~29 days when both bounds are omitted.
   */
  async priorityFeesChartDaily(
    params: PriorityFeesChartDailyParams = {},
  ): Promise<Page<PriorityFeesDailyPoint>> {
    const query: Record<string, string | number | undefined> = {}
    if (params.startTime !== undefined) {
      query['start_time'] = encodeTime(params.startTime, 'isoSnake') as string
    }
    if (params.endTime !== undefined) {
      query['end_time'] = encodeTime(params.endTime, 'isoSnake') as string
    }
    const raw = await this.http.request<unknown>({
      path: '/analytics/priority-fees/chart/daily',
      query,
    })
    return unwrap<PriorityFeesDailyPoint>(raw, 'apiResponse')
  }

  /**
   * `GET /analytics/priority-fees/gossip/leaderboard` — top gossip nodes by
   * priority gas. Returns the full list in one call.
   *
   * @param params - Optional list scope.
   * @param params.limit - Maximum number of rows, 1..200.
   * @returns `Page<GossipLeaderboardEntry>` with rows keyed on `nodeIp` (the renamed upstream `address`).
   * @throws {ValidationError} when `limit` is not a positive integer or exceeds 200.
   * @throws {ServerError} on upstream 5xx.
   * @throws {NetworkError} on transport failure or timeout.
   * @see PLAN.md §I bug #9
   * @remarks
   * The upstream `address` field is an IPv4 string (e.g. `"1.2.3.4"`), not a
   * wallet — calling code that joins it against `/users/*` would silently
   * mismatch. The SDK renames it to `nodeIp` on the typed model to make the
   * semantic explicit.
   */
  async priorityFeesGossipLeaderboard(
    params: GossipLeaderboardParams = {},
  ): Promise<Page<GossipLeaderboardEntry>> {
    assertOptionalPositiveInt(params.limit, 'limit')
    assertLimit(params.limit, GOSSIP_LIMIT_CAP, 'limit')
    const raw = await this.http.request<unknown>({
      path: '/analytics/priority-fees/gossip/leaderboard',
      query: {
        limit: params.limit,
      },
    })
    const page = unwrap<RawGossipLeaderboardEntry>(raw, 'apiResponse')
    const data: GossipLeaderboardEntry[] = page.data.map((row) => ({
      nodeIp: row.address,
      totalGas: row.totalGas,
      count: row.count,
      daysActive: row.daysActive,
    }))
    return { data, meta: page.meta }
  }

  /**
   * `GET /analytics/liquidations/stats` — liquidations snapshot for the
   * trailing `days` window.
   *
   * @param params - Optional snapshot scope.
   * @param params.days - Look-back window in days, 1..30 (server defaults to 1 when omitted).
   * @param params.coin - Perp symbol filter. Note: `top_token_liquidated` ignores this filter (§I #8).
   * @returns `Single<LiquidationsStatsData>` aggregate snapshot.
   * @throws {ValidationError} when `days` is not a positive integer or exceeds 30.
   * @throws {ServerError} on upstream 5xx.
   * @throws {NetworkError} on transport failure or timeout.
   * @see PLAN.md §I bug #8
   * @remarks
   * Per PLAN.md §I #8, the server-side `top_token_liquidated` field ignores
   * the `coin` filter and always returns the global top token. The other
   * aggregates do respect `coin`.
   */
  async liquidationsStats(
    params: LiquidationsStatsParams = {},
  ): Promise<Single<LiquidationsStatsData>> {
    assertOptionalPositiveInt(params.days, 'days')
    assertLimit(params.days, LIQUIDATIONS_STATS_DAYS_CAP, 'days')
    const raw = await this.http.request<unknown>({
      path: '/analytics/liquidations/stats',
      query: {
        days: params.days,
        coin: params.coin,
      },
    })
    return unwrapSingle<LiquidationsStatsData>(raw, 'apiResponse')
  }
}
