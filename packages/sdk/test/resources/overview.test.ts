import { describe, expect, it, vi } from 'vitest'
import { ValidationError } from '../../src/errors/index.js'
import { OverviewResource } from '../../src/resources/overview.js'
import { HttpClient } from '../../src/transport/HttpClient.js'

function mockResponse(status: number, body: string, contentType = 'application/json'): Response {
  return new Response(body, { status, headers: { 'content-type': contentType } })
}

function buildResource(fetchMock: ReturnType<typeof vi.fn>): OverviewResource {
  const client = new HttpClient({
    apiKey: 'test-key',
    fetch: fetchMock as unknown as typeof fetch,
  })
  return new OverviewResource(client)
}

const VALID_ADDR = '0x1111111111111111111111111111111111111111'
const BAD_ADDR = '0x123'

describe('OverviewResource.topTraders24h', () => {
  it('forwards sort + limit and unwraps the apiResponse envelope', async () => {
    const fetchMock = vi.fn(async (input: string | URL) => {
      const url = new URL(input.toString())
      expect(url.pathname).toBe('/overview/top-traders-24h')
      expect(url.searchParams.get('sort')).toBe('volume')
      expect(url.searchParams.get('limit')).toBe('5')
      return mockResponse(
        200,
        JSON.stringify({
          success: true,
          data: [
            {
              user: VALID_ADDR,
              tradeCount: 12,
              totalVolume: 100,
              winRate: 0.6,
              totalPnl: 50,
            },
          ],
          execution_time_ms: 870,
          total_count: null,
          next_cursor: null,
          has_more: null,
        }),
      )
    })
    const overview = buildResource(fetchMock)
    const page = await overview.topTraders24h({ sort: 'volume', limit: 5 })
    expect(page.data).toHaveLength(1)
    expect(page.data[0]?.user).toBe(VALID_ADDR)
    expect(page.data[0]?.totalPnl).toBe(50)
    expect(page.meta.family).toBe('apiResponse')
    expect(page.meta.executionMs).toBe(870)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('omits sort + limit when not provided', async () => {
    const fetchMock = vi.fn(async (input: string | URL) => {
      const url = new URL(input.toString())
      expect(url.searchParams.has('sort')).toBe(false)
      expect(url.searchParams.has('limit')).toBe(false)
      return mockResponse(200, JSON.stringify({ success: true, data: [] }))
    })
    const overview = buildResource(fetchMock)
    const page = await overview.topTraders24h()
    expect(page.data).toEqual([])
  })

  it('throws ValidationError for bogus sort and never calls fetch (PLAN.md §I #5)', async () => {
    const fetchMock = vi.fn()
    const overview = buildResource(fetchMock)
    await expect(
      // Bypass the typed enum so we can assert the runtime defence.
      overview.topTraders24h({ sort: 'bogus' as unknown as 'pnl_pos' }),
    ).rejects.toBeInstanceOf(ValidationError)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('OverviewResource.totalFees24h', () => {
  it('returns a Single<TotalFees24h>', async () => {
    const fetchMock = vi.fn(async (input: string | URL) => {
      const url = new URL(input.toString())
      expect(url.pathname).toBe('/overview/total-fees-24h')
      return mockResponse(
        200,
        JSON.stringify({
          success: true,
          data: { feesSpot: 100, feesPerpUsdc: 200, totalFees: 300 },
          execution_time_ms: 1710,
        }),
      )
    })
    const overview = buildResource(fetchMock)
    const res = await overview.totalFees24h()
    expect(res.data.feesSpot).toBe(100)
    expect(res.data.feesPerpUsdc).toBe(200)
    expect(res.data.totalFees).toBe(300)
    expect(res.meta.family).toBe('apiResponse')
    expect(res.meta.executionMs).toBe(1710)
  })
})

describe('OverviewResource.activeTraders24h', () => {
  it('returns a Single<KpiCard<number>>', async () => {
    const fetchMock = vi.fn(async (input: string | URL) => {
      const url = new URL(input.toString())
      expect(url.pathname).toBe('/overview/active-traders-24h')
      return mockResponse(
        200,
        JSON.stringify({
          success: true,
          data: { value: 1234, variationPct: 0.05 },
        }),
      )
    })
    const overview = buildResource(fetchMock)
    const res = await overview.activeTraders24h()
    expect(res.data.value).toBe(1234)
    expect(res.data.variationPct).toBe(0.05)
  })
})

describe('OverviewResource.tradingVolume24h', () => {
  it('returns a Single<KpiCard<number>> and tolerates null variationPct', async () => {
    const fetchMock = vi.fn(async (input: string | URL) => {
      const url = new URL(input.toString())
      expect(url.pathname).toBe('/overview/trading-volume-24h')
      return mockResponse(
        200,
        JSON.stringify({
          success: true,
          data: { value: 1_000_000, variationPct: null },
        }),
      )
    })
    const overview = buildResource(fetchMock)
    const res = await overview.tradingVolume24h()
    expect(res.data.value).toBe(1_000_000)
    expect(res.data.variationPct).toBeNull()
  })
})

describe('OverviewResource.totalFills24h', () => {
  it('returns a Single<KpiCard<number>>', async () => {
    const fetchMock = vi.fn(async (input: string | URL) => {
      const url = new URL(input.toString())
      expect(url.pathname).toBe('/overview/total-fills-24h')
      return mockResponse(
        200,
        JSON.stringify({
          success: true,
          data: { value: 500, variationPct: 0.1 },
        }),
      )
    })
    const overview = buildResource(fetchMock)
    const res = await overview.totalFills24h()
    expect(res.data.value).toBe(500)
    expect(res.data.variationPct).toBe(0.1)
  })
})

describe('OverviewResource.dailyVolume10d', () => {
  it('omits the user query param when none is supplied', async () => {
    const fetchMock = vi.fn(async (input: string | URL) => {
      const url = new URL(input.toString())
      expect(url.pathname).toBe('/overview/daily-volume-10d')
      expect(url.searchParams.has('user')).toBe(false)
      return mockResponse(
        200,
        JSON.stringify({
          success: true,
          data: [
            { date: '2026-05-02', volume: 1000 },
            { date: '2026-05-03', volume: 1500 },
          ],
        }),
      )
    })
    const overview = buildResource(fetchMock)
    const page = await overview.dailyVolume10d()
    expect(page.data).toHaveLength(2)
    expect(page.data[0]?.date).toBe('2026-05-02')
  })

  it('forwards the user filter when valid', async () => {
    const fetchMock = vi.fn(async (input: string | URL) => {
      const url = new URL(input.toString())
      expect(url.searchParams.get('user')).toBe(VALID_ADDR)
      return mockResponse(200, JSON.stringify({ success: true, data: [] }))
    })
    const overview = buildResource(fetchMock)
    await overview.dailyVolume10d({ user: VALID_ADDR })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('throws ValidationError for a malformed user and never calls fetch', async () => {
    const fetchMock = vi.fn()
    const overview = buildResource(fetchMock)
    await expect(overview.dailyVolume10d({ user: BAD_ADDR })).rejects.toBeInstanceOf(
      ValidationError,
    )
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('OverviewResource.dailyPnl10d', () => {
  it('returns rows for the global per-coin series', async () => {
    const fetchMock = vi.fn(async (input: string | URL) => {
      const url = new URL(input.toString())
      expect(url.pathname).toBe('/overview/daily-pnl-10d')
      // The endpoint accepts no `user` filter — verify we never send one.
      expect(url.searchParams.has('user')).toBe(false)
      return mockResponse(
        200,
        JSON.stringify({
          success: true,
          data: [
            { date: '2026-05-02', coin: 'BTC', pnl: 1000 },
            { date: '2026-05-02', coin: 'ETH', pnl: -50 },
          ],
        }),
      )
    })
    const overview = buildResource(fetchMock)
    const page = await overview.dailyPnl10d()
    expect(page.data).toHaveLength(2)
    expect(page.data[0]?.coin).toBe('BTC')
    expect(page.data[1]?.pnl).toBe(-50)
  })
})

describe('OverviewResource.coinDistribution', () => {
  it('returns rows when the address is valid', async () => {
    const fetchMock = vi.fn(async (input: string | URL) => {
      const url = new URL(input.toString())
      expect(url.pathname).toBe('/overview/coin-distribution')
      expect(url.searchParams.get('user')).toBe(VALID_ADDR)
      return mockResponse(
        200,
        JSON.stringify({
          success: true,
          data: [
            { coin: 'BTC', volume: 100, fills: 10 },
            { coin: '@107', volume: 50, fills: 5 },
          ],
        }),
      )
    })
    const overview = buildResource(fetchMock)
    const page = await overview.coinDistribution({ user: VALID_ADDR })
    expect(page.data).toHaveLength(2)
    expect(page.data[0]?.coin).toBe('BTC')
    expect(page.data[1]?.coin).toBe('@107')
  })

  it('rejects a malformed user before fetch (PLAN.md §I #14)', async () => {
    const fetchMock = vi.fn()
    const overview = buildResource(fetchMock)
    await expect(overview.coinDistribution({ user: BAD_ADDR })).rejects.toBeInstanceOf(
      ValidationError,
    )
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
