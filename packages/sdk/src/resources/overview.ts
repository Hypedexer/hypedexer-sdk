import { assertAddress } from '../internal/address.js'
import { assertEnum } from '../internal/assert.js'
import type { HttpClient } from '../transport/HttpClient.js'
import { unwrap, unwrapSingle } from '../transport/envelopes.js'
import type { APIResponse, Page, Single } from '../types/common.js'
import type {
  ActiveTraders24h,
  CoinDistributionEntry,
  CoinDistributionParams,
  DailyPnlEntry,
  DailyVolumeParams,
  DailyVolumePoint,
  TopTraderEntry,
  TopTradersParams,
  TotalFees24h,
  TotalFills24h,
  TradingVolume24h,
} from '../types/overview.js'
import { TOP_TRADER_SORTS } from '../types/overview.js'

/**
 * `/overview/*` endpoint surface. All responses use the `apiResponse` envelope
 * and are non-paginated (either `none` = single record or `none-list` = full
 * list returned in one call). See ENDPOINTS.md §"Overview (batch-2)".
 *
 * Defended bugs (per PLAN.md §I):
 * - #5: `top-traders.sort` silently accepts bogus values. SDK validates client-side.
 * - #14: `coin-distribution` returns 200 + empty for bad addresses (no 422). SDK
 *   validates the eth-address pattern client-side before sending.
 */
export class OverviewResource {
  constructor(private readonly http: HttpClient) {}

  /**
   * `GET /overview/top-traders-24h` — top traders of the last 24h, ordered by
   * the requested `sort` (default `pnl_pos`).
   *
   * **§I #5:** server silently falls back to `pnl_pos` on unknown `sort`. This
   * SDK throws {@link ValidationError} client-side instead.
   */
  async topTraders24h(params: TopTradersParams = {}): Promise<Page<TopTraderEntry>> {
    if (params.sort !== undefined) assertEnum(params.sort, TOP_TRADER_SORTS, 'sort')
    const raw = await this.http.request<APIResponse<TopTraderEntry[]>>({
      path: '/overview/top-traders-24h',
      query: {
        sort: params.sort,
        limit: params.limit,
      },
    })
    return unwrap<TopTraderEntry>(raw, 'apiResponse')
  }

  /** `GET /overview/total-fees-24h` — split of spot vs perp fees for the last 24h. */
  async totalFees24h(): Promise<Single<TotalFees24h>> {
    const raw = await this.http.request<APIResponse<TotalFees24h>>({
      path: '/overview/total-fees-24h',
    })
    return unwrapSingle<TotalFees24h>(raw, 'apiResponse')
  }

  /**
   * `GET /overview/active-traders-24h` — unique active addresses in the last
   * 24h with prior-day variation. **Slow upstream** (~7.5s); callers should cache.
   */
  async activeTraders24h(): Promise<Single<ActiveTraders24h>> {
    const raw = await this.http.request<APIResponse<ActiveTraders24h>>({
      path: '/overview/active-traders-24h',
    })
    return unwrapSingle<ActiveTraders24h>(raw, 'apiResponse')
  }

  /**
   * `GET /overview/trading-volume-24h` — total USD volume over the last 24h
   * with prior-day variation. Slow upstream (~3.2s); cache aggressively.
   */
  async tradingVolume24h(): Promise<Single<TradingVolume24h>> {
    const raw = await this.http.request<APIResponse<TradingVolume24h>>({
      path: '/overview/trading-volume-24h',
    })
    return unwrapSingle<TradingVolume24h>(raw, 'apiResponse')
  }

  /**
   * `GET /overview/total-fills-24h` — total fill count over the last 24h with
   * prior-day variation. Slow upstream (~2.5s); cache aggressively.
   */
  async totalFills24h(): Promise<Single<TotalFills24h>> {
    const raw = await this.http.request<APIResponse<TotalFills24h>>({
      path: '/overview/total-fills-24h',
    })
    return unwrapSingle<TotalFills24h>(raw, 'apiResponse')
  }

  /**
   * `GET /overview/daily-volume-10d` — 10-day daily-volume series. Pass
   * `params.user` to scope the series to a single trader. Series is pre-sorted
   * oldest → newest.
   */
  async dailyVolume10d(params: DailyVolumeParams = {}): Promise<Page<DailyVolumePoint>> {
    if (params.user !== undefined) assertAddress(params.user, 'user')
    const raw = await this.http.request<APIResponse<DailyVolumePoint[]>>({
      path: '/overview/daily-volume-10d',
      query: { user: params.user },
    })
    return unwrap<DailyVolumePoint>(raw, 'apiResponse')
  }

  /**
   * `GET /overview/daily-pnl-10d` — global 10-day PnL series broken down by
   * coin. No `user` filter is accepted by the server.
   */
  async dailyPnl10d(): Promise<Page<DailyPnlEntry>> {
    const raw = await this.http.request<APIResponse<DailyPnlEntry[]>>({
      path: '/overview/daily-pnl-10d',
    })
    return unwrap<DailyPnlEntry>(raw, 'apiResponse')
  }

  /**
   * `GET /overview/coin-distribution` — per-coin volume + fill count for a
   * given user over the lookback window.
   *
   * **§I #14:** server returns 200 + empty data for malformed addresses (no
   * 422), unlike `/fills/user/{addr}` which 422s. The SDK throws
   * {@link ValidationError} client-side before sending.
   */
  async coinDistribution(params: CoinDistributionParams): Promise<Page<CoinDistributionEntry>> {
    assertAddress(params.user, 'user')
    const raw = await this.http.request<APIResponse<CoinDistributionEntry[]>>({
      path: '/overview/coin-distribution',
      query: { user: params.user },
    })
    return unwrap<CoinDistributionEntry>(raw, 'apiResponse')
  }
}
