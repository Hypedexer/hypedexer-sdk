import { describe, expect, it, vi } from 'vitest'
import { ValidationError } from '../../src/errors/index.js'
import { TwapsResource } from '../../src/resources/twaps.js'
import { HttpClient } from '../../src/transport/HttpClient.js'
import type { Address } from '../../src/types/common.js'
import type { Twap, TwapDetail, TwapFill, TwapsStatsData } from '../../src/types/twap.js'

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

function sampleTwap(overrides: Partial<Twap> = {}): Twap {
  return {
    twapId: 1811495,
    status: 'finished',
    coin: 'BTC',
    user: VALID_ADDRESS,
    side: 'B',
    sz: 1.5,
    executedSz: 1.5,
    executedNtl: 112500,
    minutes: 30,
    reduceOnly: false,
    randomize: true,
    startTime: '2026-05-11T15:00:00',
    updatedAt: '2026-05-11T15:30:00.123456',
    ...overrides,
  }
}

function sampleTwapFill(overrides: Partial<TwapFill> = {}): TwapFill {
  return {
    user: VALID_ADDRESS,
    coin: 'BTC',
    coinMeaning: 'BTC',
    px: 75000,
    sz: 0.1,
    side: 'B',
    time: '2026-05-11T15:05:00.398000',
    hash: '0x0000000000000000000000000000000000000000000000000000000000000000',
    oid: 100,
    tid: 444284598976375,
    fee: 0.05,
    feeToken: 'USDC',
    typeTrade: 'perp',
    builderFee: 0.01,
    notional: 7500,
    priorityGas: null,
    ...overrides,
  }
}

// -----------------------------------------------------------------------------
// list — GET /twaps/
// -----------------------------------------------------------------------------

describe('TwapsResource.list', () => {
  it('GETs /twaps/ with all query params and unwraps Page<Twap>', async () => {
    const row = sampleTwap()
    const { http, fetchMock } = buildClient((url) => {
      expect(url.pathname).toBe('/twaps/')
      expect(url.searchParams.get('status')).toBe('finished')
      expect(url.searchParams.get('coin')).toBe('BTC')
      expect(url.searchParams.get('user')).toBe(VALID_ADDRESS)
      expect(url.searchParams.get('order')).toBe('desc')
      expect(url.searchParams.get('limit')).toBe('100')
      expect(url.searchParams.get('offset')).toBe('0')
      return mockResponse({
        success: true,
        data: [row],
        // /twaps/ never populates these (PLAN.md §I #16, batch-6 §Quirks)
        next_cursor: null,
        has_more: null,
        total_count: null,
        message: '1 TWAPs found',
        execution_time_ms: 14,
      })
    })
    const twaps = new TwapsResource(http)

    const page = await twaps.list({
      status: 'finished',
      coin: 'BTC',
      user: VALID_ADDRESS,
      order: 'desc',
      limit: 100,
      offset: 0,
    })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(page.data).toEqual([row])
    expect(page.meta.family).toBe('apiResponse')
    expect(page.meta.message).toBe('1 TWAPs found')
    expect(page.meta.executionMs).toBe(14)
    expect(page.meta.totalCount).toBeNull()
  })

  it('omits unset params from the query string', async () => {
    const { http } = buildClient((url) => {
      expect(url.pathname).toBe('/twaps/')
      expect(url.searchParams.has('status')).toBe(false)
      expect(url.searchParams.has('coin')).toBe(false)
      expect(url.searchParams.has('user')).toBe(false)
      expect(url.searchParams.has('order')).toBe(false)
      expect(url.searchParams.has('limit')).toBe(false)
      expect(url.searchParams.has('offset')).toBe(false)
      return mockResponse({ success: true, data: [] })
    })
    const twaps = new TwapsResource(http)
    const page = await twaps.list()
    expect(page.data).toEqual([])
  })

  it('throws ValidationError when limit exceeds the 500 cap', async () => {
    const { http, fetchMock } = buildClient(() => mockResponse({ success: true, data: [] }))
    const twaps = new TwapsResource(http)
    await expect(twaps.list({ limit: 9999 })).rejects.toBeInstanceOf(ValidationError)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('throws ValidationError on a bogus status value (bug #13: error-prefix strings are NOT valid filters)', async () => {
    const { http, fetchMock } = buildClient(() => mockResponse({ success: true, data: [] }))
    const twaps = new TwapsResource(http)
    await expect(
      twaps.list({ status: 'error: foo' as unknown as 'activated' }),
    ).rejects.toBeInstanceOf(ValidationError)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('throws ValidationError on a bogus order value', async () => {
    const { http, fetchMock } = buildClient(() => mockResponse({ success: true, data: [] }))
    const twaps = new TwapsResource(http)
    await expect(twaps.list({ order: 'sideways' as unknown as 'asc' })).rejects.toBeInstanceOf(
      ValidationError,
    )
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('throws ValidationError when `user` filter is a bad address', async () => {
    const { http, fetchMock } = buildClient(() => mockResponse({ success: true, data: [] }))
    const twaps = new TwapsResource(http)
    await expect(twaps.list({ user: BAD_ADDRESS as Address })).rejects.toBeInstanceOf(
      ValidationError,
    )
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('preserves an `error: ...` status string coming back from the server (bug #13)', async () => {
    // The query filter is narrow, but the WIRE Twap.status can include
    // `error: ${string}` template literals — verify the SDK does not
    // strip / mutate them.
    const errorRow = sampleTwap({ status: 'error: Insufficient margin to place order.' })
    const { http } = buildClient(() => mockResponse({ success: true, data: [errorRow] }))
    const twaps = new TwapsResource(http)
    const page = await twaps.list()
    expect(page.data[0]?.status).toBe('error: Insufficient margin to place order.')
  })
})

// -----------------------------------------------------------------------------
// iterate — GET /twaps/ offset pagination
// -----------------------------------------------------------------------------

describe('TwapsResource.iterate', () => {
  it('pages by offset and stops on the first partial page', async () => {
    const { http, fetchMock } = buildClient((url) => {
      expect(url.pathname).toBe('/twaps/')
      const offset = Number(url.searchParams.get('offset') ?? 0)
      const limit = Number(url.searchParams.get('limit'))
      expect(limit).toBe(2)
      if (offset === 0) {
        return mockResponse({
          success: true,
          data: [sampleTwap({ twapId: 1 }), sampleTwap({ twapId: 2 })],
        })
      }
      // Partial page (< limit) → iterator stops after yielding these rows.
      return mockResponse({
        success: true,
        data: [sampleTwap({ twapId: 3 })],
      })
    })
    const twaps = new TwapsResource(http)
    const ids: number[] = []
    for await (const row of twaps.iterate({ limit: 2 })) ids.push(row.twapId)
    expect(ids).toEqual([1, 2, 3])
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('iterate() defaults limit to the 500 server cap when caller omits it', async () => {
    const { http, fetchMock } = buildClient((url) => {
      expect(url.searchParams.get('limit')).toBe('500')
      return mockResponse({ success: true, data: [] })
    })
    const twaps = new TwapsResource(http)
    for await (const _row of twaps.iterate()) {
      // empty; should make exactly one request and stop on partial page
    }
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('iterate() validates synchronously on a bad limit', () => {
    const { http, fetchMock } = buildClient(() => mockResponse({ success: true, data: [] }))
    const twaps = new TwapsResource(http)
    expect(() => twaps.iterate({ limit: 9999 })).toThrow(ValidationError)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

// -----------------------------------------------------------------------------
// stats — GET /twaps/stats
// -----------------------------------------------------------------------------

describe('TwapsResource.stats', () => {
  it('GETs /twaps/stats and unwraps Single<TwapsStatsData>', async () => {
    const payload: TwapsStatsData = {
      hours: 24,
      totalTwaps: 1200,
      totalExecutedNtl: 5_000_000,
      byStatus: [
        {
          status: 'finished',
          count: 1000,
          totalSz: 100,
          executedSz: 100,
          executedNtl: 4_500_000,
          avgMinutes: 12.3,
          uniqueUsers: 400,
          uniqueCoins: 25,
        },
        // bug #13: error-prefix status surfaces here unchanged
        {
          status: 'error: Insufficient margin to place order.',
          count: 5,
          totalSz: 1,
          executedSz: 0,
          executedNtl: 0,
          avgMinutes: 0,
          uniqueUsers: 5,
          uniqueCoins: 3,
        },
      ],
      fills: {
        count: 5000,
        volume: 5_000_000,
        totalFees: 500,
        uniqueUsers: 400,
        uniqueTwaps: 1200,
      },
    }
    const { http, fetchMock } = buildClient((url) => {
      expect(url.pathname).toBe('/twaps/stats')
      expect(url.searchParams.get('hours')).toBe('24')
      expect(url.searchParams.get('coin')).toBe('BTC')
      return mockResponse({ success: true, data: payload, execution_time_ms: 1900 })
    })
    const twaps = new TwapsResource(http)
    const res = await twaps.stats({ hours: 24, coin: 'BTC' })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(res.data.totalTwaps).toBe(1200)
    expect(res.data.byStatus[1]?.status).toBe('error: Insufficient margin to place order.')
    expect(res.meta.executionMs).toBe(1900)
    expect(res.meta.family).toBe('apiResponse')
  })

  it('omits unset params on stats', async () => {
    const { http } = buildClient((url) => {
      expect(url.pathname).toBe('/twaps/stats')
      expect(url.searchParams.has('hours')).toBe(false)
      expect(url.searchParams.has('coin')).toBe(false)
      return mockResponse({ success: true, data: null })
    })
    const twaps = new TwapsResource(http)
    await twaps.stats()
  })
})

// -----------------------------------------------------------------------------
// user — GET /twaps/user/{addr}
// -----------------------------------------------------------------------------

describe('TwapsResource.user', () => {
  it('GETs /twaps/user/{addr} with status/order/limit/offset', async () => {
    const row = sampleTwap({ executionPct: 100 })
    const { http, fetchMock } = buildClient((url) => {
      expect(url.pathname).toBe(`/twaps/user/${VALID_ADDRESS}`)
      expect(url.searchParams.get('status')).toBe('finished')
      expect(url.searchParams.get('order')).toBe('desc')
      expect(url.searchParams.get('limit')).toBe('50')
      expect(url.searchParams.get('offset')).toBe('0')
      // Verify there is NO `coin` filter on this endpoint per the typed params.
      expect(url.searchParams.has('coin')).toBe(false)
      return mockResponse({ success: true, data: [row] })
    })
    const twaps = new TwapsResource(http)
    const page = await twaps.user(VALID_ADDRESS, {
      status: 'finished',
      order: 'desc',
      limit: 50,
      offset: 0,
    })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(page.data).toEqual([row])
    expect(page.data[0]?.executionPct).toBe(100)
  })

  it('throws ValidationError on a bad address (bug #14 parity) without making a fetch call', async () => {
    const { http, fetchMock } = buildClient(() => mockResponse({ success: true, data: [] }))
    const twaps = new TwapsResource(http)
    await expect(twaps.user(BAD_ADDRESS)).rejects.toBeInstanceOf(ValidationError)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('throws ValidationError when limit exceeds the 200 cap', async () => {
    const { http, fetchMock } = buildClient(() => mockResponse({ success: true, data: [] }))
    const twaps = new TwapsResource(http)
    await expect(twaps.user(VALID_ADDRESS, { limit: 999 })).rejects.toBeInstanceOf(ValidationError)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('iterateUser pages by offset until a partial page', async () => {
    const { http, fetchMock } = buildClient((url) => {
      expect(url.pathname).toBe(`/twaps/user/${VALID_ADDRESS}`)
      const offset = Number(url.searchParams.get('offset') ?? 0)
      const limit = Number(url.searchParams.get('limit'))
      expect(limit).toBe(2)
      if (offset === 0) {
        return mockResponse({
          success: true,
          data: [sampleTwap({ twapId: 10 }), sampleTwap({ twapId: 11 })],
        })
      }
      return mockResponse({ success: true, data: [sampleTwap({ twapId: 12 })] })
    })
    const twaps = new TwapsResource(http)
    const ids: number[] = []
    for await (const row of twaps.iterateUser(VALID_ADDRESS, { limit: 2 })) {
      ids.push(row.twapId)
    }
    expect(ids).toEqual([10, 11, 12])
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('iterateUser refuses a bad address synchronously', () => {
    const { http, fetchMock } = buildClient(() => mockResponse({ success: true, data: [] }))
    const twaps = new TwapsResource(http)
    expect(() => twaps.iterateUser(BAD_ADDRESS)).toThrow(ValidationError)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

// -----------------------------------------------------------------------------
// get — GET /twaps/{id}
// -----------------------------------------------------------------------------

describe('TwapsResource.get', () => {
  it('GETs /twaps/{id} and unwraps Single<TwapDetail>', async () => {
    const detail: TwapDetail = {
      meta: sampleTwap({ executionPct: 100 }),
      events: [
        {
          eventTime: '2026-05-11T15:00:00.000000',
          status: 'activated',
          executedSz: 0,
          executedNtl: 0,
        },
        {
          eventTime: '2026-05-11T15:30:00.000000',
          status: 'finished',
          executedSz: 1.5,
          executedNtl: 112500,
        },
      ],
      fills: {
        fillCount: 12,
        totalNotional: 112500,
        totalSz: 1.5,
        avgPx: 75000,
        minPx: 74500,
        maxPx: 75500,
        totalFees: 5,
        totalBuilderFees: 1,
        firstFill: '2026-05-11T15:01:00.000000',
        lastFill: '2026-05-11T15:29:00.000000',
      },
    }
    const { http, fetchMock } = buildClient((url) => {
      expect(url.pathname).toBe('/twaps/1811495')
      return mockResponse({ success: true, data: detail, execution_time_ms: 22 })
    })
    const twaps = new TwapsResource(http)
    const res = await twaps.get(1811495)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(res.data.meta.twapId).toBe(1811495)
    expect(res.data.events).toHaveLength(2)
    expect(res.data.fills.fillCount).toBe(12)
    expect(res.meta.family).toBe('apiResponse')
    expect(res.meta.executionMs).toBe(22)
  })
})

// -----------------------------------------------------------------------------
// fills — GET /twaps/{id}/fills
// -----------------------------------------------------------------------------

describe('TwapsResource.fills', () => {
  it('GETs /twaps/{id}/fills with limit / offset and unwraps Page<TwapFill>', async () => {
    const row = sampleTwapFill()
    const { http, fetchMock } = buildClient((url) => {
      expect(url.pathname).toBe('/twaps/1811495/fills')
      expect(url.searchParams.get('limit')).toBe('100')
      expect(url.searchParams.get('offset')).toBe('0')
      return mockResponse({
        success: true,
        data: [row],
        // /twaps/{id}/fills IS the one endpoint where total_count is populated
        total_count: 12,
      })
    })
    const twaps = new TwapsResource(http)
    const page = await twaps.fills(1811495, { limit: 100, offset: 0 })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(page.data).toEqual([row])
    expect(page.meta.totalCount).toBe(12)
    // TWAP fills carry an all-zero hash (off-chain executions) — pass-through.
    expect(page.data[0]?.hash).toBe(
      '0x0000000000000000000000000000000000000000000000000000000000000000',
    )
    expect(page.data[0]?.builderFee).toBe(0.01)
  })

  it('throws ValidationError when limit exceeds the 1000 cap', async () => {
    const { http, fetchMock } = buildClient(() => mockResponse({ success: true, data: [] }))
    const twaps = new TwapsResource(http)
    await expect(twaps.fills(1, { limit: 9999 })).rejects.toBeInstanceOf(ValidationError)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('iterateFills pages by offset until a partial page', async () => {
    const { http, fetchMock } = buildClient((url) => {
      expect(url.pathname).toBe('/twaps/42/fills')
      const offset = Number(url.searchParams.get('offset') ?? 0)
      const limit = Number(url.searchParams.get('limit'))
      expect(limit).toBe(2)
      if (offset === 0) {
        return mockResponse({
          success: true,
          data: [sampleTwapFill({ tid: 1 }), sampleTwapFill({ tid: 2 })],
        })
      }
      return mockResponse({ success: true, data: [sampleTwapFill({ tid: 3 })] })
    })
    const twaps = new TwapsResource(http)
    const tids: number[] = []
    for await (const row of twaps.iterateFills(42, { limit: 2 })) tids.push(row.tid)
    expect(tids).toEqual([1, 2, 3])
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })
})
