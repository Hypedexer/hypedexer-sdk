import { describe, expect, it, vi } from 'vitest'
import { ValidationError } from '../../src/errors/index.js'
import { BuildersResource } from '../../src/resources/builders.js'
import { HttpClient } from '../../src/transport/HttpClient.js'
import type {
  Builder,
  BuilderAddrStatsData,
  BuilderEntry,
  BuilderStatsBlock,
  BuilderUser,
  BuilderUsersData,
  BuildersStatsAllTimeframesData,
  BuildersStatsData,
  BuildersTopData,
} from '../../src/types/builder.js'
import type { Address } from '../../src/types/common.js'

const VALID_ADDRESS = '0x13ab1fa35000f7332c601b17dd1ea796a85fe803' as Address
const BAD_ADDRESS = '0xnot-an-address'

function mockResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

function buildClient(handler: (url: URL, init: RequestInit | undefined) => Response) {
  const fetchMock = vi.fn(async (input: string | URL, init?: RequestInit) => {
    const url = new URL(input.toString())
    return handler(url, init)
  })
  const http = new HttpClient({
    apiKey: 'test-key',
    fetch: fetchMock as unknown as typeof fetch,
  })
  return { http, fetchMock }
}

function sampleBuilder(overrides: Partial<Builder> = {}): Builder {
  return {
    builder: VALID_ADDRESS,
    builderName: 'Phantom',
    fillCount: 100,
    totalVolume: 1_000_000,
    totalFees: 1234,
    totalBuilderFees: 56,
    uniqueUsers: 7,
    uniqueCoins: 3,
    ...overrides,
  }
}

function sampleStatsBlock(overrides: Partial<BuilderStatsBlock> = {}): BuilderStatsBlock {
  return {
    fillCount: 100,
    totalVolume: 1_000_000,
    totalFees: 1234,
    totalBuilderFees: 56,
    uniqueBuilders: 7,
    uniqueUsers: 50,
    uniqueCoins: 8,
    ...overrides,
  }
}

// -----------------------------------------------------------------------------
// top — GET /builders/top
// -----------------------------------------------------------------------------

describe('BuildersResource.top', () => {
  it('GETs /builders/top with typed query params and unwraps Single<BuildersTopData>', async () => {
    const builderRow = sampleBuilder()
    const payload: BuildersTopData = {
      timeframe: '24h',
      sort: 'volume',
      builders: [builderRow],
    }
    const { http, fetchMock } = buildClient((url) => {
      expect(url.pathname).toBe('/builders/top')
      expect(url.searchParams.get('timeframe')).toBe('24h')
      expect(url.searchParams.get('sort')).toBe('volume')
      expect(url.searchParams.get('limit')).toBe('10')
      expect(url.searchParams.get('offset')).toBe('0')
      return mockResponse({
        success: true,
        message: '15 builders found',
        data: payload,
        total_count: null,
        next_cursor: null,
        has_more: null,
        execution_time_ms: 1100,
      })
    })
    const builders = new BuildersResource(http)
    const res = await builders.top({ timeframe: '24h', sort: 'volume', limit: 10, offset: 0 })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(res.data.timeframe).toBe('24h')
    expect(res.data.sort).toBe('volume')
    expect(res.data.builders).toHaveLength(1)
    expect(res.data.builders[0]?.builderName).toBe('Phantom')
    expect(res.meta.family).toBe('apiResponse')
    expect(res.meta.message).toBe('15 builders found')
    expect(res.meta.executionMs).toBe(1100)
  })

  it('omits unset params from the query string', async () => {
    const { http } = buildClient((url) => {
      expect(url.pathname).toBe('/builders/top')
      expect(url.searchParams.has('timeframe')).toBe(false)
      expect(url.searchParams.has('sort')).toBe(false)
      expect(url.searchParams.has('limit')).toBe(false)
      expect(url.searchParams.has('offset')).toBe(false)
      return mockResponse({
        success: true,
        data: { timeframe: '24h', sort: 'volume', builders: [] },
      })
    })
    const builders = new BuildersResource(http)
    const res = await builders.top()
    expect(res.data.builders).toEqual([])
  })

  it('throws ValidationError on a bogus sort (PLAN §I #5 silent fallback)', async () => {
    const { http, fetchMock } = buildClient(() =>
      mockResponse({ success: true, data: { timeframe: '24h', sort: 'volume', builders: [] } }),
    )
    const builders = new BuildersResource(http)
    await expect(builders.top({ sort: 'bogus' as unknown as 'volume' })).rejects.toBeInstanceOf(
      ValidationError,
    )
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('throws ValidationError on a bogus timeframe', async () => {
    const { http, fetchMock } = buildClient(() =>
      mockResponse({ success: true, data: { timeframe: '24h', sort: 'volume', builders: [] } }),
    )
    const builders = new BuildersResource(http)
    await expect(builders.top({ timeframe: '12h' as unknown as '24h' })).rejects.toBeInstanceOf(
      ValidationError,
    )
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('throws ValidationError when limit exceeds the 100 cap', async () => {
    const { http, fetchMock } = buildClient(() =>
      mockResponse({ success: true, data: { timeframe: '24h', sort: 'volume', builders: [] } }),
    )
    const builders = new BuildersResource(http)
    await expect(builders.top({ limit: 101 })).rejects.toBeInstanceOf(ValidationError)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

// -----------------------------------------------------------------------------
// iterateTop — offset pagination over Builder rows
// -----------------------------------------------------------------------------

describe('BuildersResource.iterateTop', () => {
  it('walks two pages via offset until a partial page is returned', async () => {
    const { http, fetchMock } = buildClient((url) => {
      const offset = Number(url.searchParams.get('offset'))
      const limit = Number(url.searchParams.get('limit'))
      expect(limit).toBe(2)
      if (offset === 0) {
        return mockResponse({
          success: true,
          data: {
            timeframe: '24h',
            sort: 'volume',
            builders: [
              sampleBuilder({ builder: '0x0000000000000000000000000000000000000001' as Address }),
              sampleBuilder({ builder: '0x0000000000000000000000000000000000000002' as Address }),
            ],
          },
        })
      }
      expect(offset).toBe(2)
      return mockResponse({
        success: true,
        data: {
          timeframe: '24h',
          sort: 'volume',
          builders: [
            sampleBuilder({ builder: '0x0000000000000000000000000000000000000003' as Address }),
          ],
        },
      })
    })
    const builders = new BuildersResource(http)
    const out: Address[] = []
    for await (const row of builders.iterateTop({ timeframe: '24h', sort: 'volume', limit: 2 })) {
      out.push(row.builder)
    }
    expect(out).toEqual([
      '0x0000000000000000000000000000000000000001',
      '0x0000000000000000000000000000000000000002',
      '0x0000000000000000000000000000000000000003',
    ])
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('refuses a bogus sort synchronously without making a fetch call', async () => {
    const { http, fetchMock } = buildClient(() => mockResponse({ success: true, data: null }))
    const builders = new BuildersResource(http)
    expect(() => builders.iterateTop({ sort: 'bogus' as unknown as 'volume' })).toThrow(
      ValidationError,
    )
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

// -----------------------------------------------------------------------------
// stats — GET /builders/stats
// -----------------------------------------------------------------------------

describe('BuildersResource.stats', () => {
  it('GETs /builders/stats with timeframe and unwraps Single<BuildersStatsData>', async () => {
    const payload: BuildersStatsData = {
      timeframe: '7d',
      current: sampleStatsBlock(),
      previous: sampleStatsBlock({ fillCount: 80 }),
      variations: {
        fillCountPct: 25,
        totalVolumePct: 30,
        totalFeesPct: 12,
        totalBuilderFeesPct: 8,
        uniqueBuildersPct: null,
        uniqueUsersPct: 5,
      },
    }
    const { http, fetchMock } = buildClient((url) => {
      expect(url.pathname).toBe('/builders/stats')
      expect(url.searchParams.get('timeframe')).toBe('7d')
      return mockResponse({ success: true, data: payload })
    })
    const builders = new BuildersResource(http)
    const res = await builders.stats({ timeframe: '7d' })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(res.data.timeframe).toBe('7d')
    expect(res.data.current.uniqueBuilders).toBe(7)
    expect(res.data.variations.uniqueBuildersPct).toBeNull()
  })

  it('omits timeframe when unset', async () => {
    const { http } = buildClient((url) => {
      expect(url.searchParams.has('timeframe')).toBe(false)
      return mockResponse({ success: true, data: null })
    })
    const builders = new BuildersResource(http)
    await builders.stats()
  })

  it('throws ValidationError on a bogus timeframe', async () => {
    const { http, fetchMock } = buildClient(() => mockResponse({ success: true, data: null }))
    const builders = new BuildersResource(http)
    await expect(builders.stats({ timeframe: 'foo' as unknown as '24h' })).rejects.toBeInstanceOf(
      ValidationError,
    )
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

// -----------------------------------------------------------------------------
// statsAllTimeframes — GET /builders/stats/all-timeframes
// -----------------------------------------------------------------------------

describe('BuildersResource.statsAllTimeframes', () => {
  it('GETs /builders/stats/all-timeframes and returns the timeframe-keyed record', async () => {
    const block = {
      current: sampleStatsBlock(),
      previous: sampleStatsBlock(),
      variations: {
        fillCountPct: 0,
        totalVolumePct: 0,
        totalFeesPct: 0,
        totalBuilderFeesPct: 0,
        uniqueBuildersPct: 0,
        uniqueUsersPct: 0,
      },
    }
    const payload: BuildersStatsAllTimeframesData = {
      '1h': block,
      '24h': block,
      '7d': block,
      '30d': block,
    }
    const { http, fetchMock } = buildClient((url) => {
      expect(url.pathname).toBe('/builders/stats/all-timeframes')
      expect([...url.searchParams.keys()]).toHaveLength(0)
      return mockResponse({ success: true, data: payload })
    })
    const builders = new BuildersResource(http)
    const res = await builders.statsAllTimeframes()

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(Object.keys(res.data)).toEqual(['1h', '24h', '7d', '30d'])
    expect(res.data['24h'].current.uniqueBuilders).toBe(7)
  })
})

// -----------------------------------------------------------------------------
// addrStats — GET /builders/{addr}/stats
// -----------------------------------------------------------------------------

describe('BuildersResource.addrStats', () => {
  it('GETs /builders/{addr}/stats with timeframe and unwraps Single<BuilderAddrStatsData>', async () => {
    const payload: BuilderAddrStatsData = {
      builder: VALID_ADDRESS,
      builderName: 'Phantom',
      timeframe: '24h',
      current: sampleStatsBlock(),
      previous: sampleStatsBlock({ fillCount: 90 }),
      variations: {
        fillCountPct: 11.1,
        totalVolumePct: 5,
        totalFeesPct: 2,
        totalBuilderFeesPct: 1,
        uniqueUsersPct: 0,
      },
      coinBreakdown: [
        {
          coin: 'xyz:CL',
          coinMeaning: 'Crude Oil',
          fillCount: 12,
          totalVolume: 5_000,
          totalFees: 12.5,
          totalBuilderFees: 1.2,
          uniqueUsers: 3,
        },
      ],
    }
    const { http, fetchMock } = buildClient((url) => {
      expect(url.pathname).toBe(`/builders/${VALID_ADDRESS}/stats`)
      expect(url.searchParams.get('timeframe')).toBe('24h')
      return mockResponse({ success: true, data: payload })
    })
    const builders = new BuildersResource(http)
    const res = await builders.addrStats(VALID_ADDRESS, { timeframe: '24h' })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(res.data.builder).toBe(VALID_ADDRESS)
    expect(res.data.builderName).toBe('Phantom')
    expect(res.data.coinBreakdown[0]?.coin).toBe('xyz:CL')
  })

  it('preserves builderName: null for an unknown builder (200 with sparse stats)', async () => {
    const { http } = buildClient(() =>
      mockResponse({
        success: true,
        data: {
          builder: VALID_ADDRESS,
          builderName: null,
          timeframe: '24h',
          current: sampleStatsBlock({ uniqueBuilders: undefined }),
          previous: sampleStatsBlock({ uniqueBuilders: undefined }),
          variations: {
            fillCountPct: null,
            totalVolumePct: null,
            totalFeesPct: null,
            totalBuilderFeesPct: null,
            uniqueUsersPct: null,
          },
          coinBreakdown: [],
        },
      }),
    )
    const builders = new BuildersResource(http)
    const res = await builders.addrStats(VALID_ADDRESS)
    expect(res.data.builderName).toBeNull()
    expect(res.data.coinBreakdown).toEqual([])
  })

  it('throws ValidationError on a bad address without making a fetch call (bug #14)', async () => {
    const { http, fetchMock } = buildClient(() => mockResponse({ success: true, data: null }))
    const builders = new BuildersResource(http)
    await expect(builders.addrStats(BAD_ADDRESS)).rejects.toBeInstanceOf(ValidationError)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('throws ValidationError on a bogus timeframe', async () => {
    const { http, fetchMock } = buildClient(() => mockResponse({ success: true, data: null }))
    const builders = new BuildersResource(http)
    await expect(
      builders.addrStats(VALID_ADDRESS, { timeframe: '12h' as unknown as '24h' }),
    ).rejects.toBeInstanceOf(ValidationError)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

// -----------------------------------------------------------------------------
// users — GET /builders/{addr}/users
// -----------------------------------------------------------------------------

describe('BuildersResource.users', () => {
  it('GETs /builders/{addr}/users with typed query params and unwraps Single<BuilderUsersData>', async () => {
    const userRow: BuilderUser = {
      user: VALID_ADDRESS,
      fillCount: 5,
      totalVolume: 1000,
      totalFees: 2.5,
      totalBuilderFees: 0.5,
      uniqueCoins: 2,
    }
    const payload: BuilderUsersData = {
      timeframe: '24h',
      builder: VALID_ADDRESS,
      users: [userRow],
    }
    const { http, fetchMock } = buildClient((url) => {
      expect(url.pathname).toBe(`/builders/${VALID_ADDRESS}/users`)
      expect(url.searchParams.get('timeframe')).toBe('24h')
      expect(url.searchParams.get('limit')).toBe('50')
      expect(url.searchParams.get('offset')).toBe('0')
      return mockResponse({ success: true, data: payload })
    })
    const builders = new BuildersResource(http)
    const res = await builders.users(VALID_ADDRESS, { timeframe: '24h', limit: 50, offset: 0 })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(res.data.builder).toBe(VALID_ADDRESS)
    expect(res.data.users).toHaveLength(1)
    expect(res.data.users[0]?.user).toBe(VALID_ADDRESS)
  })

  it('throws ValidationError on a bad address without making a fetch call (bug #14)', async () => {
    const { http, fetchMock } = buildClient(() => mockResponse({ success: true, data: null }))
    const builders = new BuildersResource(http)
    await expect(builders.users(BAD_ADDRESS)).rejects.toBeInstanceOf(ValidationError)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

// -----------------------------------------------------------------------------
// iterateUsers — offset pagination over BuilderUser rows
// -----------------------------------------------------------------------------

describe('BuildersResource.iterateUsers', () => {
  it('walks two pages via offset until a partial page is returned', async () => {
    const { http, fetchMock } = buildClient((url) => {
      const offset = Number(url.searchParams.get('offset'))
      const limit = Number(url.searchParams.get('limit'))
      expect(limit).toBe(2)
      if (offset === 0) {
        return mockResponse({
          success: true,
          data: {
            timeframe: '24h',
            builder: VALID_ADDRESS,
            users: [
              {
                user: '0x0000000000000000000000000000000000000001',
                fillCount: 1,
                totalVolume: 1,
                totalFees: 0,
                totalBuilderFees: 0,
                uniqueCoins: 1,
              },
              {
                user: '0x0000000000000000000000000000000000000002',
                fillCount: 2,
                totalVolume: 2,
                totalFees: 0,
                totalBuilderFees: 0,
                uniqueCoins: 1,
              },
            ],
          },
        })
      }
      expect(offset).toBe(2)
      return mockResponse({
        success: true,
        data: {
          timeframe: '24h',
          builder: VALID_ADDRESS,
          users: [
            {
              user: '0x0000000000000000000000000000000000000003',
              fillCount: 3,
              totalVolume: 3,
              totalFees: 0,
              totalBuilderFees: 0,
              uniqueCoins: 1,
            },
          ],
        },
      })
    })
    const builders = new BuildersResource(http)
    const out: string[] = []
    for await (const row of builders.iterateUsers(VALID_ADDRESS, { limit: 2 })) {
      out.push(row.user)
    }
    expect(out).toEqual([
      '0x0000000000000000000000000000000000000001',
      '0x0000000000000000000000000000000000000002',
      '0x0000000000000000000000000000000000000003',
    ])
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('refuses a bad address synchronously without making a fetch call', async () => {
    const { http, fetchMock } = buildClient(() => mockResponse({ success: true, data: null }))
    const builders = new BuildersResource(http)
    expect(() => builders.iterateUsers(BAD_ADDRESS)).toThrow(ValidationError)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

// -----------------------------------------------------------------------------
// list — GET /builders/list
// -----------------------------------------------------------------------------

describe('BuildersResource.list', () => {
  it('GETs /builders/list and unwraps Page<BuilderEntry>', async () => {
    const rows: BuilderEntry[] = [
      {
        address: '0x0000000000000000000000000000000000000001' as Address,
        name: 'Phantom',
        referredBy: null,
        referrerStage: 'ready',
      },
      {
        address: '0x0000000000000000000000000000000000000002' as Address,
        name: null,
        referredBy: '0x0000000000000000000000000000000000000001' as Address,
        referrerStage: null,
      },
    ]
    const { http, fetchMock } = buildClient((url) => {
      expect(url.pathname).toBe('/builders/list')
      expect([...url.searchParams.keys()]).toHaveLength(0)
      return mockResponse({
        success: true,
        message: '640 builders found',
        data: rows,
        total_count: null,
      })
    })
    const builders = new BuildersResource(http)
    const page = await builders.list()

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(page.data).toHaveLength(2)
    expect(page.data[0]?.name).toBe('Phantom')
    expect(page.data[1]?.referredBy).toBe('0x0000000000000000000000000000000000000001')
    expect(page.meta.family).toBe('apiResponse')
    expect(page.meta.message).toBe('640 builders found')
    expect(page.meta.totalCount).toBeNull()
  })
})
