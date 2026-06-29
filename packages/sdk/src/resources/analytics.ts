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
 * the full list in one call (no pagination).
 */
export class AnalyticsResource {
  constructor(private readonly http: HttpClient) {}

  /**
   * GET `/analytics/fills/stats` — fills volume / fees / unique-users snapshot
   * for the trailing `hours` window. Defaults to 1h on the server.
   *
   * `coin` is echoed back on the response when supplied.
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
   * GET `/analytics/priority-fees/stats` — priority-gas snapshot for the
   * trailing `hours` window. Defaults to 1h on the server.
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
   * GET `/analytics/priority-fees/chart/daily` — full daily series of
   * priority-fee aggregates. No pagination; default lookback is ~29 days.
   *
   * `startTime` / `endTime` accept `Date | number | string` and are emitted
   * as ISO `Z` strings (snake_case query params).
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
   * GET `/analytics/priority-fees/gossip/leaderboard` — top gossip nodes by
   * priority gas. Returns the full list in one call.
   *
   * The upstream `address` field is an IPv4 string (not a wallet) and is
   * renamed to `nodeIp` on the typed model — see PLAN.md §I bug #9.
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
   * GET `/analytics/liquidations/stats` — liquidations snapshot for the
   * trailing `days` window. Defaults to 1 day on the server.
   *
   * Known bug (PLAN.md §I #8): `top_token_liquidated` ignores the `coin`
   * filter — the server always returns the global top token.
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
