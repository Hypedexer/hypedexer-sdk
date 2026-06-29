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
 * Class-wide quirks defended in this resource (per PLAN.md §I):
 * - bug #5: `top-traders.sort` silently accepts bogus values and falls back to
 *   `pnl_pos`. SDK validates `sort` client-side against {@link TOP_TRADER_SORTS}.
 * - bug #14: `coin-distribution` returns 200 + empty for bad addresses (no 422).
 *   SDK validates the eth-address pattern client-side before sending; same for
 *   {@link OverviewResource.dailyVolume10d} when scoped to a user.
 *
 * @see PLAN.md §I bug #5
 * @see PLAN.md §I bug #14
 */
export class OverviewResource {
  constructor(private readonly http: HttpClient) {}

  /**
   * `GET /overview/top-traders-24h` — top traders of the last 24h, ordered by
   * the requested `sort` (default `pnl_pos`).
   *
   * @param params - Optional list scope.
   * @param params.sort - One of `'pnl_pos' | 'pnl_neg' | 'volume' | 'trades'`. Validated client-side (§I #5).
   * @param params.limit - Maximum number of rows (server default is 20 when omitted).
   * @returns `Page<TopTraderEntry>` — full list in one call (no pagination).
   * @throws {ValidationError} when `sort` is not in {@link TOP_TRADER_SORTS}.
   * @throws {ServerError} on upstream 5xx.
   * @throws {NetworkError} on transport failure or timeout.
   * @see PLAN.md §I bug #5
   * @remarks
   * The server silently falls back to `pnl_pos` on unknown `sort`. The SDK
   * throws {@link ValidationError} client-side instead, so a typo never yields
   * a different ordering than requested.
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

  /**
   * `GET /overview/total-fees-24h` — split of spot vs perp fees for the last 24h.
   *
   * @returns `Single<TotalFees24h>` with `feesSpot`, `feesPerpUsdc`, and `totalFees`.
   * @throws {ServerError} on upstream 5xx.
   * @throws {NetworkError} on transport failure or timeout.
   */
  async totalFees24h(): Promise<Single<TotalFees24h>> {
    const raw = await this.http.request<APIResponse<TotalFees24h>>({
      path: '/overview/total-fees-24h',
    })
    return unwrapSingle<TotalFees24h>(raw, 'apiResponse')
  }

  /**
   * `GET /overview/active-traders-24h` — unique active addresses in the last
   * 24h with prior-day variation.
   *
   * @returns `Single<ActiveTraders24h>` — a `KpiCard<number>` with `value` and `variationPct` (may be `null`).
   * @throws {ServerError} on upstream 5xx.
   * @throws {NetworkError} on transport failure or timeout.
   * @remarks
   * Slow upstream (~7.5s observed). Callers should cache aggressively rather
   * than hit this on every page load.
   */
  async activeTraders24h(): Promise<Single<ActiveTraders24h>> {
    const raw = await this.http.request<APIResponse<ActiveTraders24h>>({
      path: '/overview/active-traders-24h',
    })
    return unwrapSingle<ActiveTraders24h>(raw, 'apiResponse')
  }

  /**
   * `GET /overview/trading-volume-24h` — total USD volume over the last 24h
   * with prior-day variation.
   *
   * @returns `Single<TradingVolume24h>` — a `KpiCard<number>` with `value` (USD) and `variationPct` (may be `null`).
   * @throws {ServerError} on upstream 5xx.
   * @throws {NetworkError} on transport failure or timeout.
   * @remarks
   * Slow upstream (~3.2s observed). Cache aggressively.
   */
  async tradingVolume24h(): Promise<Single<TradingVolume24h>> {
    const raw = await this.http.request<APIResponse<TradingVolume24h>>({
      path: '/overview/trading-volume-24h',
    })
    return unwrapSingle<TradingVolume24h>(raw, 'apiResponse')
  }

  /**
   * `GET /overview/total-fills-24h` — total fill count over the last 24h with
   * prior-day variation.
   *
   * @returns `Single<TotalFills24h>` — a `KpiCard<number>` with `value` (fill count) and `variationPct` (may be `null`).
   * @throws {ServerError} on upstream 5xx.
   * @throws {NetworkError} on transport failure or timeout.
   * @remarks
   * Slow upstream (~2.5s observed). Cache aggressively.
   */
  async totalFills24h(): Promise<Single<TotalFills24h>> {
    const raw = await this.http.request<APIResponse<TotalFills24h>>({
      path: '/overview/total-fills-24h',
    })
    return unwrapSingle<TotalFills24h>(raw, 'apiResponse')
  }

  /**
   * `GET /overview/daily-volume-10d` — 10-day daily-volume series.
   *
   * @param params - Optional list scope.
   * @param params.user - Hyperliquid wallet address (0x-prefixed, 40 hex chars). Validated client-side (§I #14). Omit for global series.
   * @returns `Page<DailyVolumePoint>` pre-sorted oldest → newest; full list in one call (no pagination).
   * @throws {ValidationError} when `user` is set but is not a valid eth-address.
   * @throws {ServerError} on upstream 5xx.
   * @throws {NetworkError} on transport failure or timeout.
   * @see PLAN.md §I bug #14
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
   * `GET /overview/daily-pnl-10d` — global 10-day PnL series broken down by coin.
   *
   * @returns `Page<DailyPnlEntry>` rows of `(date, coin, pnl)` returned in one call (no pagination).
   * @throws {ServerError} on upstream 5xx.
   * @throws {NetworkError} on transport failure or timeout.
   * @remarks
   * The server does not accept a `user` filter on this endpoint; rows are
   * always the global per-coin breakdown.
   */
  async dailyPnl10d(): Promise<Page<DailyPnlEntry>> {
    const raw = await this.http.request<APIResponse<DailyPnlEntry[]>>({
      path: '/overview/daily-pnl-10d',
    })
    return unwrap<DailyPnlEntry>(raw, 'apiResponse')
  }

  /**
   * `GET /overview/coin-distribution` — per-coin volume + fill count for a
   * given user over the server's lookback window.
   *
   * @param params - Required scope.
   * @param params.user - Hyperliquid wallet address (0x-prefixed, 40 hex chars). Validated client-side (§I #14).
   * @returns `Page<CoinDistributionEntry>` rows of `(coin, volume, fills)`; full list in one call.
   * @throws {ValidationError} when `user` is not a valid eth-address.
   * @throws {ServerError} on upstream 5xx.
   * @throws {NetworkError} on transport failure or timeout.
   * @see PLAN.md §I bug #8
   * @see PLAN.md §I bug #14
   * @remarks
   * Unlike `/fills/user/{addr}` (which 422s on bad addresses), the server
   * returns 200 + empty data for malformed inputs. The SDK throws
   * {@link ValidationError} client-side before sending so the failure mode is
   * symmetric with the rest of the address-scoped surface. Bug #8 also applies
   * to a sibling field (`top_token_liquidated`) on a related endpoint and does
   * not affect this method directly.
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
