import { describe, expect, it, vi } from 'vitest'
import { ValidationError } from '../../src/errors/index.js'
import { AnalyticsResource } from '../../src/resources/analytics.js'
import { HttpClient } from '../../src/transport/HttpClient.js'

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

function client(fetchFn: typeof fetch): AnalyticsResource {
  const http = new HttpClient({ apiKey: 'test-key', fetch: fetchFn })
  return new AnalyticsResource(http)
}

describe('AnalyticsResource.fillsStats', () => {
  it('hits /analytics/fills/stats, attaches API key, and returns Single<FillsStatsData>', async () => {
    const fetchMock = vi.fn(async (input: string | URL, init?: RequestInit) => {
      const url = new URL(input.toString())
      expect(url.pathname).toBe('/analytics/fills/stats')
      expect(url.searchParams.get('hours')).toBe('24')
      expect(url.searchParams.get('coin')).toBe('BTC')
      const headers = init?.headers as Record<string, string>
      expect(headers['X-API-Key']).toBe('test-key')
      return jsonResponse({
        success: true,
        message: 'Fill stats for the last 24 hours',
        data: {
          total_fills: 12345,
          total_volume: 1.23e8,
          total_fees: 4321,
          total_builder_fees_usdc: 17,
          unique_users: 901,
          unique_coins: 42,
          time_range: { start: '2026-05-10T14:40:32Z', end: '2026-05-11T14:40:32Z' },
          coin: 'BTC',
        },
        execution_time_ms: 850,
        total_count: null,
        next_cursor: null,
        has_more: null,
      })
    })
    const analytics = client(fetchMock as unknown as typeof fetch)
    const res = await analytics.fillsStats({ hours: 24, coin: 'BTC' })

    expect(res.data?.total_fills).toBe(12345)
    expect(res.data?.coin).toBe('BTC')
    expect(res.data?.time_range.end).toBe('2026-05-11T14:40:32Z')
    expect(res.meta.family).toBe('apiResponse')
    expect(res.meta.executionMs).toBe(850)
    expect(res.meta.message).toBe('Fill stats for the last 24 hours')
  })

  it('omits hours and coin when no params are passed', async () => {
    const fetchMock = vi.fn(async (input: string | URL) => {
      const url = new URL(input.toString())
      expect(url.searchParams.has('hours')).toBe(false)
      expect(url.searchParams.has('coin')).toBe(false)
      return jsonResponse({ success: true, data: null })
    })
    const analytics = client(fetchMock as unknown as typeof fetch)
    await analytics.fillsStats()
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('rejects hours > 168 client-side before fetch', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({}))
    const analytics = client(fetchMock as unknown as typeof fetch)
    await expect(analytics.fillsStats({ hours: 999 })).rejects.toBeInstanceOf(ValidationError)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('rejects non-integer hours client-side', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({}))
    const analytics = client(fetchMock as unknown as typeof fetch)
    await expect(analytics.fillsStats({ hours: 1.5 })).rejects.toBeInstanceOf(ValidationError)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('rejects hours < 1 client-side', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({}))
    const analytics = client(fetchMock as unknown as typeof fetch)
    await expect(analytics.fillsStats({ hours: 0 })).rejects.toBeInstanceOf(ValidationError)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('AnalyticsResource.priorityFeesStats', () => {
  it('hits /analytics/priority-fees/stats and unwraps to Single<PriorityFeesStatsData>', async () => {
    const fetchMock = vi.fn(async (input: string | URL) => {
      const url = new URL(input.toString())
      expect(url.pathname).toBe('/analytics/priority-fees/stats')
      expect(url.searchParams.get('hours')).toBe('1')
      return jsonResponse({
        success: true,
        data: {
          total_fills_with_priority: 100,
          total_priority_gas: 42.0,
          avg_priority_gas: 0.42,
          min_priority_gas: 0.01,
          max_priority_gas: 5.0,
          unique_users: 50,
          time_range: { start: '2026-05-11T13:40:32Z', end: '2026-05-11T14:40:32Z' },
        },
        execution_time_ms: 17,
      })
    })
    const analytics = client(fetchMock as unknown as typeof fetch)
    const res = await analytics.priorityFeesStats({ hours: 1 })
    expect(res.data?.total_fills_with_priority).toBe(100)
    expect(res.data?.coin).toBeUndefined()
    expect(res.meta.executionMs).toBe(17)
  })

  it('rejects hours > 168 client-side before fetch', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({}))
    const analytics = client(fetchMock as unknown as typeof fetch)
    await expect(analytics.priorityFeesStats({ hours: 200 })).rejects.toBeInstanceOf(
      ValidationError,
    )
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('AnalyticsResource.priorityFeesChartDaily', () => {
  it('returns Page<PriorityFeesDailyPoint> and emits ISO Z time params', async () => {
    const fetchMock = vi.fn(async (input: string | URL) => {
      const url = new URL(input.toString())
      expect(url.pathname).toBe('/analytics/priority-fees/chart/daily')
      expect(url.searchParams.get('start_time')).toMatch(/^2026-05-04T00:00:00\.000Z$/)
      expect(url.searchParams.get('end_time')).toMatch(/^2026-05-11T00:00:00\.000Z$/)
      return jsonResponse({
        success: true,
        message: '(8 days)',
        data: [
          { date: '2026-05-04', fills: 1, fillsWithFee: 1, totalGas: 0.1, uniqueUsers: 1 },
          { date: '2026-05-05', fills: 2, fillsWithFee: 2, totalGas: 0.2, uniqueUsers: 2 },
        ],
        execution_time_ms: 870,
      })
    })
    const analytics = client(fetchMock as unknown as typeof fetch)
    const page = await analytics.priorityFeesChartDaily({
      startTime: new Date('2026-05-04T00:00:00Z'),
      endTime: new Date('2026-05-11T00:00:00Z'),
    })

    expect(page.data).toHaveLength(2)
    expect(page.data[0]?.date).toBe('2026-05-04')
    expect(page.data[0]?.fills).toBe(1)
    expect(page.meta.family).toBe('apiResponse')
    expect(page.meta.message).toBe('(8 days)')
  })

  it('omits time params when none are supplied (default lookback)', async () => {
    const fetchMock = vi.fn(async (input: string | URL) => {
      const url = new URL(input.toString())
      expect(url.searchParams.has('start_time')).toBe(false)
      expect(url.searchParams.has('end_time')).toBe(false)
      return jsonResponse({ success: true, data: [] })
    })
    const analytics = client(fetchMock as unknown as typeof fetch)
    const page = await analytics.priorityFeesChartDaily()
    expect(page.data).toEqual([])
  })

  it('accepts string and number time inputs', async () => {
    const fetchMock = vi.fn(async (input: string | URL) => {
      const url = new URL(input.toString())
      // string ISO without TZ → ensureUtc adds Z; number ms passes through
      expect(url.searchParams.get('start_time')).toBe('2026-05-04T00:00:00.000Z')
      const end = url.searchParams.get('end_time')
      expect(end).not.toBeNull()
      return jsonResponse({ success: true, data: [] })
    })
    const analytics = client(fetchMock as unknown as typeof fetch)
    await analytics.priorityFeesChartDaily({
      startTime: '2026-05-04T00:00:00',
      endTime: Date.UTC(2026, 4, 11),
    })
  })
})

describe('AnalyticsResource.priorityFeesGossipLeaderboard', () => {
  it('renames upstream address → nodeIp and returns Page<GossipLeaderboardEntry>', async () => {
    const fetchMock = vi.fn(async (input: string | URL) => {
      const url = new URL(input.toString())
      expect(url.pathname).toBe('/analytics/priority-fees/gossip/leaderboard')
      expect(url.searchParams.get('limit')).toBe('5')
      return jsonResponse({
        success: true,
        message: '(17 wallets)',
        data: [
          { address: '54.64.2.87', totalGas: 12.5, count: 100, daysActive: 7 },
          { address: '10.0.0.1', totalGas: 8.1, count: 50, daysActive: 3 },
        ],
        execution_time_ms: 690,
      })
    })
    const analytics = client(fetchMock as unknown as typeof fetch)
    const page = await analytics.priorityFeesGossipLeaderboard({ limit: 5 })

    expect(page.data).toHaveLength(2)
    // Bug #9 defense: upstream `address` becomes `nodeIp`.
    expect(page.data[0]?.nodeIp).toBe('54.64.2.87')
    expect(page.data[0]?.totalGas).toBe(12.5)
    expect(page.data[0]?.count).toBe(100)
    expect(page.data[0]?.daysActive).toBe(7)
    // Confirm no raw `address` leaked through the typed model.
    expect((page.data[0] as unknown as { address?: string }).address).toBeUndefined()
    expect(page.meta.message).toBe('(17 wallets)')
  })

  it('omits limit when not provided', async () => {
    const fetchMock = vi.fn(async (input: string | URL) => {
      const url = new URL(input.toString())
      expect(url.searchParams.has('limit')).toBe(false)
      return jsonResponse({ success: true, data: [] })
    })
    const analytics = client(fetchMock as unknown as typeof fetch)
    await analytics.priorityFeesGossipLeaderboard()
  })

  it('rejects limit > 200 client-side before fetch', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({}))
    const analytics = client(fetchMock as unknown as typeof fetch)
    await expect(analytics.priorityFeesGossipLeaderboard({ limit: 500 })).rejects.toBeInstanceOf(
      ValidationError,
    )
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('rejects non-positive limit client-side', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({}))
    const analytics = client(fetchMock as unknown as typeof fetch)
    await expect(analytics.priorityFeesGossipLeaderboard({ limit: 0 })).rejects.toBeInstanceOf(
      ValidationError,
    )
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('AnalyticsResource.liquidationsStats', () => {
  it('hits /analytics/liquidations/stats and surfaces top_token_liquidated even when filtered (bug #8)', async () => {
    const fetchMock = vi.fn(async (input: string | URL) => {
      const url = new URL(input.toString())
      expect(url.pathname).toBe('/analytics/liquidations/stats')
      expect(url.searchParams.get('days')).toBe('7')
      expect(url.searchParams.get('coin')).toBe('ETH')
      return jsonResponse({
        success: true,
        data: {
          number_liquidation: 42,
          number_long_liquidated: 20,
          number_short_liquidated: 22,
          amount_liquidated_usd: 1.5e6,
          total_fees: 1234,
          // Server returns BTC even when filtering by ETH — see PLAN.md §I #8.
          top_token_liquidated: 'BTC',
          time_range: {
            start: '2026-05-04T15:40:43.737038Z',
            end: '2026-05-11T15:40:43.737038Z',
          },
          coin: 'ETH',
        },
        execution_time_ms: 710,
      })
    })
    const analytics = client(fetchMock as unknown as typeof fetch)
    const res = await analytics.liquidationsStats({ days: 7, coin: 'ETH' })

    expect(res.data?.number_liquidation).toBe(42)
    expect(res.data?.coin).toBe('ETH')
    // The SDK exposes the buggy value as-is so callers can detect/work around it.
    expect(res.data?.top_token_liquidated).toBe('BTC')
    expect(res.meta.executionMs).toBe(710)
  })

  it('rejects days > 30 client-side before fetch', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({}))
    const analytics = client(fetchMock as unknown as typeof fetch)
    await expect(analytics.liquidationsStats({ days: 999 })).rejects.toBeInstanceOf(ValidationError)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('rejects non-integer days client-side', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({}))
    const analytics = client(fetchMock as unknown as typeof fetch)
    await expect(analytics.liquidationsStats({ days: 2.5 })).rejects.toBeInstanceOf(ValidationError)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('rejects days < 1 client-side', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({}))
    const analytics = client(fetchMock as unknown as typeof fetch)
    await expect(analytics.liquidationsStats({ days: 0 })).rejects.toBeInstanceOf(ValidationError)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
