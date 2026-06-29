import { describe, expect, it, vi } from 'vitest'
import { createClient } from '../src/index.js'
import { HttpClient } from '../src/transport/HttpClient.js'
import type { Address } from '../src/types/common.js'

const VALID_ADDRESS = '0x13ab1fa35000f7332c601b17dd1ea796a85fe803' as Address

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

type Route = (url: URL) => Response | undefined

function makeFetch(routes: Route[]): typeof fetch {
  return vi.fn(async (input: string | URL) => {
    const url = new URL(input.toString())
    for (const r of routes) {
      const res = r(url)
      if (res) return res
    }
    throw new Error(`Unhandled URL in smoke test: ${url.toString()}`)
  }) as unknown as typeof fetch
}

describe('createClient', () => {
  it('exposes one method-typed handle per Tier-1 resource and the underlying HttpClient', () => {
    const client = createClient({ apiKey: 'test-key', fetch: makeFetch([]) })

    expect(client.http).toBeInstanceOf(HttpClient)

    expect(typeof client.fills.list).toBe('function')
    expect(typeof client.fills.iterate).toBe('function')
    expect(typeof client.fills.recent).toBe('function')
    expect(typeof client.fills.user).toBe('function')
    expect(typeof client.fills.count).toBe('function')
    expect(typeof client.fills.spotList).toBe('function')

    expect(typeof client.analytics.fillsStats).toBe('function')
    expect(typeof client.analytics.priorityFeesStats).toBe('function')
    expect(typeof client.analytics.priorityFeesChartDaily).toBe('function')
    expect(typeof client.analytics.priorityFeesGossipLeaderboard).toBe('function')
    expect(typeof client.analytics.liquidationsStats).toBe('function')

    expect(typeof client.overview.topTraders24h).toBe('function')
    expect(typeof client.overview.totalFees24h).toBe('function')
    expect(typeof client.overview.activeTraders24h).toBe('function')
    expect(typeof client.overview.tradingVolume24h).toBe('function')
    expect(typeof client.overview.totalFills24h).toBe('function')
    expect(typeof client.overview.dailyVolume10d).toBe('function')
    expect(typeof client.overview.dailyPnl10d).toBe('function')
    expect(typeof client.overview.coinDistribution).toBe('function')

    expect(typeof client.users.overview).toBe('function')
    expect(typeof client.users.performance).toBe('function')
    expect(typeof client.users.coins).toBe('function')
    expect(typeof client.users.leaderboard).toBe('function')
    expect(typeof client.users.active).toBe('function')

    expect(typeof client.completedTrades.list).toBe('function')
    expect(typeof client.completedTrades.iterate).toBe('function')
    expect(typeof client.completedTrades.summary).toBe('function')
    expect(typeof client.completedTrades.fills).toBe('function')

    expect(typeof client.liquidations.list).toBe('function')
    expect(typeof client.liquidations.recent).toBe('function')
    expect(typeof client.liquidations.iterate).toBe('function')
  })

  it('invokes one method per resource against a stubbed fetch and returns the expected shape', async () => {
    const routes: Route[] = [
      (url) => {
        if (url.pathname !== '/fills/recent') return undefined
        return jsonResponse({
          success: true,
          data: [
            {
              user: VALID_ADDRESS,
              coin: 'BTC',
              coinMeaning: 'BTC',
              px: 75000,
              sz: 0.1,
              side: 'B',
              time: '2026-05-11T15:22:49.398000',
              hash: '0xabc',
              oid: 100,
              tid: 444284598976375,
              fee: 0.05,
              feeToken: 'USDC',
              typeTrade: 'perp',
              isLiquidation: false,
              liquidationRole: 'none',
              liqMarkPx: null,
              liqMethod: null,
              liquidatedUser: null,
              notional: 7500,
              priorityGas: null,
            },
          ],
          next_cursor: null,
          has_more: false,
          total_count: 1,
          execution_time_ms: 12,
        })
      },
      (url) => {
        if (url.pathname !== '/analytics/fills/stats') return undefined
        return jsonResponse({
          success: true,
          data: {
            total_fills: 1,
            total_volume: 2,
            total_fees: 3,
            total_builder_fees_usdc: 4,
            unique_users: 5,
            unique_coins: 6,
            time_range: { start: '2026-05-10T00:00:00Z', end: '2026-05-11T00:00:00Z' },
          },
        })
      },
      (url) => {
        if (url.pathname !== '/overview/total-fees-24h') return undefined
        return jsonResponse({
          success: true,
          data: { feesSpot: 1, feesPerpUsdc: 2, totalFees: 3 },
        })
      },
      (url) => {
        if (url.pathname !== `/users/${VALID_ADDRESS}/overview`) return undefined
        return jsonResponse({
          success: true,
          data: {
            user: VALID_ADDRESS,
            total_volume: 100,
            total_fees: 1,
            fill_count: 10,
            unique_coins: 2,
            total_pnl: 5,
            total_trades: 3,
            total_priority_gas: 0,
            last_activity: '2026-05-11T15:22:49',
            win_rate: 0.42,
          },
        })
      },
      (url) => {
        if (url.pathname !== '/completed-trades/summary') return undefined
        return jsonResponse({
          success: true,
          data: {
            totalTrades: 0,
            totalPnl: 0,
            avgPnlPct: 0,
            avgDurationS: 0,
            totalFees: 0,
            totalVolume: 0,
            timeRange: { start: '2026-05-10T00:00:00', end: '2026-05-11T00:00:00' },
            directionBreakdown: [],
            topCoins: [],
          },
        })
      },
      (url) => {
        if (url.pathname !== '/liquidations/recent') return undefined
        return jsonResponse({
          success: true,
          data: [],
          next_cursor: null,
          has_more: false,
          total_count: null,
        })
      },
    ]

    const client = createClient({ apiKey: 'test-key', fetch: makeFetch(routes) })

    const fills = await client.fills.recent({ limit: 1 })
    expect(fills.data).toHaveLength(1)
    expect(fills.data[0]?.coin).toBe('BTC')
    expect(fills.meta.family).toBe('apiResponse')

    const stats = await client.analytics.fillsStats()
    expect(stats.data?.total_fills).toBe(1)

    const fees = await client.overview.totalFees24h()
    expect(fees.data?.totalFees).toBe(3)

    const userOverview = await client.users.overview(VALID_ADDRESS)
    expect(userOverview.data?.total_volume).toBe(100)

    const summary = await client.completedTrades.summary()
    expect(summary.data?.totalTrades).toBe(0)

    const recentLiqs = await client.liquidations.recent()
    expect(recentLiqs.data).toEqual([])
    expect(recentLiqs.meta.hasMore).toBe(false)
  })
})
