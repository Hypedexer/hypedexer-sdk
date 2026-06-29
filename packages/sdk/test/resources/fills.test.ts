import { describe, expect, it, vi } from 'vitest'
import { ServerError, ValidationError } from '../../src/errors/index.js'
import { Fills } from '../../src/resources/fills.js'
import { HttpClient } from '../../src/transport/HttpClient.js'
import type { Address } from '../../src/types/common.js'
import type { Fill } from '../../src/types/fill.js'

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

function sampleFill(overrides: Partial<Fill> = {}): Fill {
  return {
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
    ...overrides,
  }
}

// -----------------------------------------------------------------------------
// list — GET /fills/
// -----------------------------------------------------------------------------

describe('Fills.list', () => {
  it('GETs /fills/ with typed query params and unwraps Page<Fill>', async () => {
    const row = sampleFill()
    const { http, fetchMock } = buildClient((url) => {
      expect(url.pathname).toBe('/fills/')
      expect(url.searchParams.get('coin')).toBe('BTC')
      expect(url.searchParams.get('side')).toBe('B')
      expect(url.searchParams.get('limit')).toBe('100')
      expect(url.searchParams.get('has_priority_gas')).toBe('true')
      expect(url.searchParams.get('start_time')).toBe('2026-05-01T00:00:00.000Z')
      expect(url.searchParams.get('end_time')).toBe('2026-05-11T00:00:00.000Z')
      return mockResponse({
        success: true,
        data: [row],
        next_cursor: '1778513002104:444284598976375',
        has_more: true,
        total_count: 1234,
        execution_time_ms: 17,
      })
    })
    const fills = new Fills(http)

    const page = await fills.list({
      coin: 'BTC',
      side: 'B',
      hasPriorityGas: true,
      startTime: '2026-05-01T00:00:00Z',
      endTime: new Date('2026-05-11T00:00:00Z'),
      limit: 100,
    })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(page.data).toEqual([row])
    expect(page.meta.family).toBe('apiResponse')
    expect(page.meta.nextCursor).toBe('1778513002104:444284598976375')
    expect(page.meta.hasMore).toBe(true)
    expect(page.meta.totalCount).toBe(1234)
    expect(page.meta.executionMs).toBe(17)
  })

  it('omits unset params from the query string', async () => {
    const { http } = buildClient((url) => {
      expect(url.pathname).toBe('/fills/')
      expect(url.searchParams.has('coin')).toBe(false)
      expect(url.searchParams.has('side')).toBe(false)
      expect(url.searchParams.has('has_priority_gas')).toBe(false)
      expect(url.searchParams.has('cursor')).toBe(false)
      expect(url.searchParams.has('limit')).toBe(false)
      expect(url.searchParams.has('start_time')).toBe(false)
      expect(url.searchParams.has('end_time')).toBe(false)
      return mockResponse({ success: true, data: [], has_more: false, next_cursor: null })
    })
    const fills = new Fills(http)
    const page = await fills.list()
    expect(page.data).toEqual([])
  })

  it('throws ValidationError when limit exceeds the 1000 cap', async () => {
    const { http, fetchMock } = buildClient(() => mockResponse({ success: true, data: [] }))
    const fills = new Fills(http)
    await expect(fills.list({ limit: 9999 })).rejects.toBeInstanceOf(ValidationError)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('throws ValidationError on a bogus side value', async () => {
    const { http, fetchMock } = buildClient(() => mockResponse({ success: true, data: [] }))
    const fills = new Fills(http)
    await expect(fills.list({ side: 'bogus' as unknown as 'A' })).rejects.toBeInstanceOf(
      ValidationError,
    )
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

// -----------------------------------------------------------------------------
// iterate — GET /fills/ cursor pagination
// -----------------------------------------------------------------------------

describe('Fills.iterate', () => {
  it('follows next_cursor across two pages and stops on has_more=false', async () => {
    const page1 = [sampleFill({ tid: 1 }), sampleFill({ tid: 2 })]
    const page2 = [sampleFill({ tid: 3 })]

    const { http, fetchMock } = buildClient((url) => {
      const cursor = url.searchParams.get('cursor')
      if (cursor === null) {
        expect(url.searchParams.get('coin')).toBe('BTC')
        return mockResponse({
          success: true,
          data: page1,
          next_cursor: 'cursor-2',
          has_more: true,
        })
      }
      expect(cursor).toBe('cursor-2')
      expect(url.searchParams.get('coin')).toBe('BTC')
      return mockResponse({
        success: true,
        data: page2,
        next_cursor: null,
        has_more: false,
      })
    })
    const fills = new Fills(http)

    const out: Fill[] = []
    for await (const row of fills.iterate({ coin: 'BTC' })) {
      out.push(row)
    }

    expect(out.map((r) => r.tid)).toEqual([1, 2, 3])
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })
})

// -----------------------------------------------------------------------------
// recent — GET /fills/recent
// -----------------------------------------------------------------------------

describe('Fills.recent', () => {
  it('GETs /fills/recent and unwraps the response', async () => {
    const row = sampleFill({ coin: 'ETH' })
    const { http, fetchMock } = buildClient((url) => {
      expect(url.pathname).toBe('/fills/recent')
      expect(url.searchParams.get('coin')).toBe('ETH')
      expect(url.searchParams.get('limit')).toBe('25')
      return mockResponse({
        success: true,
        data: [row],
        total_count: null,
        next_cursor: 'cursor-1',
        has_more: true,
      })
    })
    const fills = new Fills(http)
    const page = await fills.recent({ coin: 'ETH', limit: 25 })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(page.data[0]?.coin).toBe('ETH')
    expect(page.meta.nextCursor).toBe('cursor-1')
  })

  it('throws ValidationError when limit exceeds the 1000 cap', async () => {
    const { http, fetchMock } = buildClient(() => mockResponse({ success: true, data: [] }))
    const fills = new Fills(http)
    await expect(fills.recent({ limit: 1001 })).rejects.toBeInstanceOf(ValidationError)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('iterateRecent walks two pages via cursor', async () => {
    const { http, fetchMock } = buildClient((url) => {
      expect(url.pathname).toBe('/fills/recent')
      const cursor = url.searchParams.get('cursor')
      if (cursor === null) {
        return mockResponse({
          success: true,
          data: [sampleFill({ tid: 10 })],
          next_cursor: 'next',
          has_more: true,
        })
      }
      expect(cursor).toBe('next')
      return mockResponse({
        success: true,
        data: [sampleFill({ tid: 11 })],
        next_cursor: null,
        has_more: false,
      })
    })
    const fills = new Fills(http)
    const tids: number[] = []
    for await (const row of fills.iterateRecent()) tids.push(row.tid)
    expect(tids).toEqual([10, 11])
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })
})

// -----------------------------------------------------------------------------
// user — GET /fills/user/{address}
// -----------------------------------------------------------------------------

describe('Fills.user', () => {
  it('GETs /fills/user/{address} with time_range param', async () => {
    const row = sampleFill()
    const { http, fetchMock } = buildClient((url) => {
      expect(url.pathname).toBe(`/fills/user/${VALID_ADDRESS}`)
      expect(url.searchParams.get('time_range')).toBe('24h')
      expect(url.searchParams.get('limit')).toBe('50')
      return mockResponse({
        success: true,
        data: [row],
        next_cursor: null,
        has_more: false,
      })
    })
    const fills = new Fills(http)
    const page = await fills.user(VALID_ADDRESS, { timeRange: '24h', limit: 50 })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(page.data).toEqual([row])
  })

  it('throws ValidationError on a bogus timeRange', async () => {
    const { http, fetchMock } = buildClient(() => mockResponse({ success: true, data: [] }))
    const fills = new Fills(http)
    await expect(
      fills.user(VALID_ADDRESS, { timeRange: '1y' as unknown as '1h' }),
    ).rejects.toBeInstanceOf(ValidationError)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('throws ValidationError on a bad address without making a fetch call (bug #14)', async () => {
    const { http, fetchMock } = buildClient(() => mockResponse({ success: true, data: [] }))
    const fills = new Fills(http)
    await expect(fills.user(BAD_ADDRESS)).rejects.toBeInstanceOf(ValidationError)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('iterateUser follows next_cursor across two pages', async () => {
    const { http, fetchMock } = buildClient((url) => {
      expect(url.pathname).toBe(`/fills/user/${VALID_ADDRESS}`)
      const cursor = url.searchParams.get('cursor')
      if (cursor === null) {
        return mockResponse({
          success: true,
          data: [sampleFill({ tid: 100 }), sampleFill({ tid: 101 })],
          next_cursor: 'page-2',
          has_more: true,
        })
      }
      expect(cursor).toBe('page-2')
      return mockResponse({
        success: true,
        data: [sampleFill({ tid: 102 })],
        next_cursor: null,
        has_more: false,
      })
    })
    const fills = new Fills(http)
    const tids: number[] = []
    for await (const row of fills.iterateUser(VALID_ADDRESS)) tids.push(row.tid)
    expect(tids).toEqual([100, 101, 102])
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('iterateUser refuses a bad address synchronously', async () => {
    const { http, fetchMock } = buildClient(() => mockResponse({ success: true, data: [] }))
    const fills = new Fills(http)
    expect(() => fills.iterateUser(BAD_ADDRESS)).toThrow(ValidationError)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

// -----------------------------------------------------------------------------
// count — GET /fills/count
// -----------------------------------------------------------------------------

describe('Fills.count', () => {
  it('GETs /fills/count and unwraps Single<FillsCount>', async () => {
    const { http, fetchMock } = buildClient((url) => {
      expect(url.pathname).toBe('/fills/count')
      return mockResponse({
        success: true,
        data: {
          count: 42,
          timestamp: '2026-05-11T15:24:14.018991+00:00',
          execution_time_ms: 9,
        },
        // envelope.execution_time_ms is null upstream — payload carries it instead
        execution_time_ms: null,
      })
    })
    const fills = new Fills(http)
    const res = await fills.count()
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(res.data.count).toBe(42)
    expect(res.data.timestamp).toBe('2026-05-11T15:24:14.018991+00:00')
    expect(res.data.execution_time_ms).toBe(9)
    expect(res.meta.family).toBe('apiResponse')
  })
})

// -----------------------------------------------------------------------------
// spotList / spotUser — throw ServerError without network (bug #1)
// -----------------------------------------------------------------------------

describe('Fills.spotList', () => {
  it('throws ServerError synchronously without making a fetch call (bug #1)', async () => {
    const { http, fetchMock } = buildClient(() => mockResponse({ success: true, data: [] }))
    const fills = new Fills(http)
    await expect(fills.spotList()).rejects.toBeInstanceOf(ServerError)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('still runs client-side validation (limit cap) before the spot throw', async () => {
    const { http, fetchMock } = buildClient(() => mockResponse({ success: true, data: [] }))
    const fills = new Fills(http)
    await expect(fills.spotList({ limit: 9999 })).rejects.toBeInstanceOf(ValidationError)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('Fills.spotUser', () => {
  it('throws ServerError synchronously without making a fetch call (bug #1)', async () => {
    const { http, fetchMock } = buildClient(() => mockResponse({ success: true, data: [] }))
    const fills = new Fills(http)
    await expect(fills.spotUser(VALID_ADDRESS)).rejects.toBeInstanceOf(ServerError)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('throws ValidationError on a bad address (before the spot throw)', async () => {
    const { http, fetchMock } = buildClient(() => mockResponse({ success: true, data: [] }))
    const fills = new Fills(http)
    await expect(fills.spotUser(BAD_ADDRESS)).rejects.toBeInstanceOf(ValidationError)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
