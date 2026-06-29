import { describe, expect, it, vi } from 'vitest'
import { ValidationError } from '../../src/errors/index.js'
import { Liquidations } from '../../src/resources/liquidations.js'
import { HttpClient } from '../../src/transport/HttpClient.js'
import type { Liquidation } from '../../src/types/liquidation.js'

function mockResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

function sampleLiquidation(overrides: Partial<Liquidation> = {}): Liquidation {
  return {
    time: '2026-05-11T15:46:11',
    time_ms: 1778514371378,
    coin: 'BTC',
    hash: '0x5ba0915cd55053045d1a043b29ea3502012c0042705371d6ff693caf94542cee',
    liquidated_user: '0x13ab1fa35000f7332c601b17dd1ea796a85fe803',
    size_total: 0.95,
    notional_total: 419.7005,
    fill_px_vwap: 441.79,
    mark_px: 441.48,
    method: 'market',
    fee_total_liquidated: 0.032635,
    liquidators: ['0x9ede7d6c60c40755352f9f84e146eb9f0ee25327'],
    liquidator_count: 1,
    liq_dir: 'Short',
    tid: 189766161360284,
    ...overrides,
  }
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

describe('Liquidations.list', () => {
  it('returns a Page<Liquidation> on the happy path and forwards typed query params', async () => {
    const row = sampleLiquidation()
    const { http, fetchMock } = buildClient((url) => {
      expect(url.pathname).toBe('/liquidations/')
      expect(url.searchParams.get('coin')).toBe('BTC')
      expect(url.searchParams.get('user')).toBe('0x13ab1fa35000f7332c601b17dd1ea796a85fe803')
      expect(url.searchParams.get('limit')).toBe('50')
      expect(url.searchParams.get('order')).toBe('desc')
      expect(url.searchParams.get('amount_dollars')).toBe('1000')
      // start_time/end_time are encoded ISO with Z
      expect(url.searchParams.get('start_time')).toMatch(/^2026-05-01T00:00:00\.000Z$/)
      expect(url.searchParams.get('end_time')).toMatch(/^2026-05-11T00:00:00\.000Z$/)
      return mockResponse({
        success: true,
        data: [row],
        next_cursor: '1778514365496:438396392217777',
        has_more: true,
        total_count: 805628,
        execution_time_ms: 12.5,
      })
    })
    const res = new Liquidations(http)

    const page = await res.list({
      coin: 'BTC',
      user: '0x13ab1fa35000f7332c601b17dd1ea796a85fe803',
      start_time: '2026-05-01T00:00:00Z',
      end_time: new Date('2026-05-11T00:00:00Z'),
      amount_dollars: 1000,
      limit: 50,
      order: 'desc',
    })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(page.data).toEqual([row])
    expect(page.meta.family).toBe('apiResponse')
    expect(page.meta.nextCursor).toBe('1778514365496:438396392217777')
    expect(page.meta.hasMore).toBe(true)
    expect(page.meta.totalCount).toBe(805628)
  })

  it('omits unset params from the query string', async () => {
    const { http } = buildClient((url) => {
      expect(url.pathname).toBe('/liquidations/')
      expect(url.searchParams.has('coin')).toBe(false)
      expect(url.searchParams.has('user')).toBe(false)
      expect(url.searchParams.has('start_time')).toBe(false)
      expect(url.searchParams.has('end_time')).toBe(false)
      expect(url.searchParams.has('amount_dollars')).toBe(false)
      expect(url.searchParams.has('cursor')).toBe(false)
      expect(url.searchParams.has('limit')).toBe(false)
      expect(url.searchParams.has('order')).toBe(false)
      return mockResponse({ success: true, data: [], has_more: false, next_cursor: null })
    })
    const res = new Liquidations(http)

    const page = await res.list()
    expect(page.data).toEqual([])
  })

  it('accepts order=asc on the first page (bug #4)', async () => {
    const { http, fetchMock } = buildClient((url) => {
      expect(url.searchParams.get('order')).toBe('asc')
      return mockResponse({
        success: true,
        data: [sampleLiquidation()],
        // server emits a corrupt year-2245 cursor here — list returns it as-is
        next_cursor: '20911751377956:0',
        has_more: true,
        total_count: null,
      })
    })
    const res = new Liquidations(http)

    const page = await res.list({ order: 'asc' })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(page.meta.nextCursor).toBe('20911751377956:0')
  })

  it('throws ValidationError on an unknown order value (bug #5) without making a request', async () => {
    const { http, fetchMock } = buildClient(() => mockResponse({ success: true, data: [] }))
    const res = new Liquidations(http)

    await expect(res.list({ order: 'bogus' as unknown as 'asc' })).rejects.toBeInstanceOf(
      ValidationError,
    )
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('throws ValidationError when limit exceeds the 100 cap', async () => {
    const { http, fetchMock } = buildClient(() => mockResponse({ success: true, data: [] }))
    const res = new Liquidations(http)

    await expect(res.list({ limit: 999 })).rejects.toBeInstanceOf(ValidationError)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('throws ValidationError on a malformed user address', async () => {
    const { http, fetchMock } = buildClient(() => mockResponse({ success: true, data: [] }))
    const res = new Liquidations(http)

    await expect(
      res.list({ user: '0xnot-an-address' as unknown as `0x${string}` }),
    ).rejects.toBeInstanceOf(ValidationError)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('Liquidations.recent', () => {
  it('hits /liquidations/recent and unwraps the response', async () => {
    const { http, fetchMock } = buildClient((url) => {
      expect(url.pathname).toBe('/liquidations/recent')
      expect(url.searchParams.get('coin')).toBe('ETH')
      expect(url.searchParams.get('limit')).toBe('25')
      return mockResponse({
        success: true,
        data: [sampleLiquidation({ coin: 'ETH' })],
        // recent is the 24h hot cache — total_count is always null here
        total_count: null,
        next_cursor: 'cursor-1',
        has_more: true,
      })
    })
    const res = new Liquidations(http)

    const page = await res.recent({ coin: 'ETH', limit: 25 })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(page.data[0]?.coin).toBe('ETH')
    expect(page.meta.totalCount).toBeNull()
    expect(page.meta.nextCursor).toBe('cursor-1')
  })

  it('throws ValidationError when limit exceeds the 100 cap', async () => {
    const { http, fetchMock } = buildClient(() => mockResponse({ success: true, data: [] }))
    const res = new Liquidations(http)

    await expect(res.recent({ limit: 200 })).rejects.toBeInstanceOf(ValidationError)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('Liquidations.iterate', () => {
  it('refuses order=asc synchronously (bug #4) without making a request', async () => {
    const { http, fetchMock } = buildClient(() => mockResponse({ success: true, data: [] }))
    const res = new Liquidations(http)

    expect(() => res.iterate({ order: 'asc' })).toThrow(ValidationError)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('refuses unknown order values synchronously', async () => {
    const { http, fetchMock } = buildClient(() => mockResponse({ success: true, data: [] }))
    const res = new Liquidations(http)

    expect(() => res.iterate({ order: 'sideways' as unknown as 'desc' })).toThrow(ValidationError)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('refuses a malformed user address synchronously', async () => {
    const { http, fetchMock } = buildClient(() => mockResponse({ success: true, data: [] }))
    const res = new Liquidations(http)

    expect(() => res.iterate({ user: '0xnope' as unknown as `0x${string}` })).toThrow(
      ValidationError,
    )
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('follows next_cursor across two pages and stops on has_more=false', async () => {
    const page1 = [sampleLiquidation({ tid: 1 }), sampleLiquidation({ tid: 2 })]
    const page2 = [sampleLiquidation({ tid: 3 })]

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
    const res = new Liquidations(http)

    const out: Liquidation[] = []
    for await (const row of res.iterate({ coin: 'BTC' })) {
      out.push(row)
    }

    expect(out.map((r) => r.tid)).toEqual([1, 2, 3])
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })
})
