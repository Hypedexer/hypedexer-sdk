import { describe, expect, it, vi } from 'vitest'
import { NotFoundError, ValidationError } from '../../src/errors/index.js'
import { CompletedTradesResource } from '../../src/resources/completed-trades.js'
import { HttpClient } from '../../src/transport/HttpClient.js'

function mockResponse(status: number, body: string): Response {
  return new Response(body, {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

interface Capture {
  url: URL
  init?: RequestInit
}

function makeClient(handler: (cap: Capture) => Response | Promise<Response>) {
  const calls: Capture[] = []
  const fetchMock = vi.fn(async (input: string | URL, init?: RequestInit) => {
    const url = new URL(typeof input === 'string' ? input : input.toString())
    const cap: Capture = { url, init }
    calls.push(cap)
    return handler(cap)
  })
  const http = new HttpClient({
    apiKey: 'test-key',
    fetch: fetchMock as unknown as typeof fetch,
  })
  return {
    resource: new CompletedTradesResource(http),
    fetchMock,
    calls,
  }
}

const TRADE_ROW = {
  user: '0x1111111111111111111111111111111111111111',
  coin: 'BTC',
  direction: 'long',
  startTime: '2026-05-11T15:22:49.398000',
  endTime: '2026-05-11T16:00:00.000000',
  durationS: 2230,
  entryPrice: 65000,
  exitPrice: 65500,
  sizeClose: 0.1,
  pnlRealized: 50,
  leverageType: 'cross',
  positionValue: 6500,
  totalFills: 2,
  totalFees: 0.5,
  avgFillPrice: 65250,
  firstFillTime: '2026-05-11T15:22:49.398000',
  lastFillTime: '2026-05-11T16:00:00.000000',
  totalVolume: 13000,
  tradeId: 'trade_BTC_0xabcdef01',
  closeHash: '0xdeadbeef',
  createdAt: '2026-05-11T16:00:00.000000',
}

const TRADE_FILL_ROW = {
  user: '0x1111111111111111111111111111111111111111',
  coin: 'xyz:EWY',
  coinMeaning: 'EWY',
  px: 65000,
  sz: 0.1,
  side: 'B',
  time: '2026-05-11T15:22:49.398000',
  startPosition: 0,
  dir: 'Open Long',
  closedPnl: 0,
  hash: '0xfeedcafe',
  oid: 123456,
  crossed: true,
  tid: 444284598976375,
  cloid: `0x${'00'.repeat(32)}`,
  fee: 0.25,
  feeToken: 'USDC',
  // Wire would also ship `feeUsdc: "perp"` and `typeTrade: <ISO>`; SDK type drops them.
  feeUsdc: 'perp',
  typeTrade: '2026-05-11T15:22:49.398000',
}

describe('CompletedTradesResource.list', () => {
  it('hits /completed-trades/, attaches X-API-Key, serializes time and enum params, and unwraps APIResponse', async () => {
    const { resource, calls } = makeClient(({ url }) => {
      expect(url.pathname).toBe('/completed-trades/')
      expect(url.searchParams.get('coin')).toBe('BTC')
      expect(url.searchParams.get('direction')).toBe('long')
      expect(url.searchParams.get('limit')).toBe('50')
      expect(url.searchParams.get('offset')).toBe('0')
      expect(url.searchParams.get('sort_by')).toBe('pnl')
      expect(url.searchParams.get('sort_dir')).toBe('desc')
      expect(url.searchParams.get('start_time')).toBe('2026-05-10T00:00:00.000Z')
      return mockResponse(
        200,
        JSON.stringify({
          success: true,
          data: [TRADE_ROW],
          total_count: 1,
          execution_time_ms: null,
        }),
      )
    })

    const page = await resource.list({
      coin: 'BTC',
      direction: 'long',
      limit: 50,
      offset: 0,
      sortBy: 'pnl',
      sortDir: 'desc',
      startTime: new Date('2026-05-10T00:00:00Z'),
    })

    expect(page.data).toHaveLength(1)
    expect(page.data[0]?.coin).toBe('BTC')
    expect(page.meta.family).toBe('apiResponse')
    expect(page.meta.totalCount).toBe(1)
    expect(calls).toHaveLength(1)
    const headers = calls[0]?.init?.headers as Record<string, string>
    expect(headers['X-API-Key']).toBe('test-key')
  })

  it('rejects limit > 100 with ValidationError before making any request (bug #2 hard cap)', async () => {
    const { resource, fetchMock } = makeClient(() => mockResponse(200, '{}'))
    await expect(resource.list({ limit: 101 })).rejects.toBeInstanceOf(ValidationError)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('rejects unknown sortBy with ValidationError (bug #5 silent fallback defense)', async () => {
    const { resource, fetchMock } = makeClient(() => mockResponse(200, '{}'))
    await expect(
      // @ts-expect-error testing invalid enum at runtime
      resource.list({ sortBy: 'bogus' }),
    ).rejects.toBeInstanceOf(ValidationError)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('rejects unknown sortDir with ValidationError', async () => {
    const { resource, fetchMock } = makeClient(() => mockResponse(200, '{}'))
    await expect(
      // @ts-expect-error testing invalid enum at runtime
      resource.list({ sortDir: 'sideways' }),
    ).rejects.toBeInstanceOf(ValidationError)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('rejects unknown direction with ValidationError', async () => {
    const { resource, fetchMock } = makeClient(() => mockResponse(200, '{}'))
    await expect(
      // @ts-expect-error testing invalid enum at runtime
      resource.list({ direction: 'flat' }),
    ).rejects.toBeInstanceOf(ValidationError)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('rejects invalid user address with ValidationError', async () => {
    const { resource, fetchMock } = makeClient(() => mockResponse(200, '{}'))
    await expect(resource.list({ user: '0xnothex' })).rejects.toBeInstanceOf(ValidationError)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('CompletedTradesResource.iterate', () => {
  it('walks pages by incrementing offset until a partial page is returned', async () => {
    let callIdx = 0
    const { resource } = makeClient(({ url }) => {
      expect(url.pathname).toBe('/completed-trades/')
      const offset = Number(url.searchParams.get('offset'))
      const limit = Number(url.searchParams.get('limit'))
      expect(limit).toBe(2)
      let data: (typeof TRADE_ROW)[] = []
      if (offset === 0) data = [TRADE_ROW, { ...TRADE_ROW, tradeId: 'trade_BTC_0x02' }]
      else if (offset === 2) data = [{ ...TRADE_ROW, tradeId: 'trade_BTC_0x03' }] // partial
      callIdx++
      return mockResponse(200, JSON.stringify({ success: true, data }))
    })

    const out: string[] = []
    for await (const trade of resource.iterate({ limit: 2 })) {
      out.push(trade.tradeId)
    }
    expect(out).toEqual(['trade_BTC_0xabcdef01', 'trade_BTC_0x02', 'trade_BTC_0x03'])
    expect(callIdx).toBe(2)
  })

  it('propagates validation errors immediately (does not start iterating)', async () => {
    const { resource, fetchMock } = makeClient(() => mockResponse(200, '{}'))
    expect(() => resource.iterate({ limit: 999 })).toThrow(ValidationError)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('CompletedTradesResource.summary', () => {
  it('hits /completed-trades/summary and unwraps the single record', async () => {
    const summaryRow = {
      totalTrades: 12,
      totalPnl: 100,
      avgPnlPct: 1.09,
      avgDurationS: 3600,
      totalFees: 5,
      totalVolume: 100000,
      timeRange: { start: '2026-05-01T00:00:00', end: '2026-05-11T00:00:00' },
      directionBreakdown: [{ direction: 'long', count: 8, totalPnl: 60 }],
      topCoins: [{ coin: 'BTC', tradeCount: 8, totalPnl: 60, totalVolume: 80000 }],
    }
    const { resource } = makeClient(({ url }) => {
      expect(url.pathname).toBe('/completed-trades/summary')
      expect(url.searchParams.get('coin')).toBe('BTC')
      return mockResponse(
        200,
        JSON.stringify({ success: true, data: summaryRow, execution_time_ms: null }),
      )
    })

    const res = await resource.summary({ coin: 'BTC' })
    expect(res.data.totalTrades).toBe(12)
    expect(res.data.avgPnlPct).toBe(1.09)
    expect(res.meta.family).toBe('apiResponse')
  })

  it('rejects invalid direction on summary', async () => {
    const { resource, fetchMock } = makeClient(() => mockResponse(200, '{}'))
    await expect(
      // @ts-expect-error testing invalid enum at runtime
      resource.summary({ direction: 'mu' }),
    ).rejects.toBeInstanceOf(ValidationError)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('rejects invalid user on summary', async () => {
    const { resource, fetchMock } = makeClient(() => mockResponse(200, '{}'))
    await expect(resource.summary({ user: '0xbad' })).rejects.toBeInstanceOf(ValidationError)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('CompletedTradesResource.get', () => {
  it('hits /completed-trades/{trade_id}, omits include_fills by default, and unwraps the single trade', async () => {
    const { resource, calls } = makeClient(({ url }) => {
      expect(url.pathname).toBe('/completed-trades/trade_BTC_0xabcdef01')
      expect(url.searchParams.has('include_fills')).toBe(false)
      return mockResponse(
        200,
        JSON.stringify({ success: true, data: TRADE_ROW, execution_time_ms: null }),
      )
    })

    const res = await resource.get('trade_BTC_0xabcdef01')
    expect(res.data.tradeId).toBe('trade_BTC_0xabcdef01')
    expect(res.data.coin).toBe('BTC')
    expect(res.data.fills).toBeUndefined()
    expect(res.meta.family).toBe('apiResponse')
    const headers = calls[0]?.init?.headers as Record<string, string>
    expect(headers['X-API-Key']).toBe('test-key')
  })

  it('sends include_fills=true and surfaces the embedded fills when requested', async () => {
    const { resource } = makeClient(({ url }) => {
      expect(url.pathname).toBe('/completed-trades/trade_BTC_0xabcdef01')
      expect(url.searchParams.get('include_fills')).toBe('true')
      return mockResponse(
        200,
        JSON.stringify({
          success: true,
          data: { ...TRADE_ROW, fills: [TRADE_FILL_ROW] },
        }),
      )
    })

    const res = await resource.get('trade_BTC_0xabcdef01', { includeFills: true })
    expect(res.data.fills).toHaveLength(1)
    expect(res.data.fills?.[0]?.feeToken).toBe('USDC')
  })

  it('URL-encodes `:` in tradeId path segment as %3A (HIP-3 coin segment safety)', async () => {
    const { resource } = makeClient(({ url }) => {
      expect(url.pathname).toContain('%3A')
      expect(url.pathname.endsWith('/fills')).toBe(false)
      return mockResponse(200, JSON.stringify({ success: true, data: TRADE_ROW }))
    })
    await resource.get('trade_xyz:EWY_0xabcdef01')
  })

  it('propagates NotFoundError on a 404 for an unknown trade id (real 404, not the fills quirk)', async () => {
    const { resource } = makeClient(({ url }) => {
      expect(url.pathname).toBe('/completed-trades/not-a-real-id')
      return mockResponse(404, JSON.stringify({ detail: 'trade not found' }))
    })
    await expect(resource.get('not-a-real-id')).rejects.toBeInstanceOf(NotFoundError)
  })
})

describe('CompletedTradesResource.fills', () => {
  it('URL-encodes `:` in tradeId path segment as %3A (HIP-3 coin segment safety)', async () => {
    const { resource } = makeClient(({ url }) => {
      // Path is decoded back to ':' when reading from url.pathname; check raw href instead.
      expect(url.pathname).toContain('%3A')
      expect(url.pathname.endsWith('/fills')).toBe(true)
      return mockResponse(200, JSON.stringify({ success: true, data: [TRADE_FILL_ROW] }))
    })
    const page = await resource.fills('trade_xyz:EWY_0xabcdef01')
    expect(page.data).toHaveLength(1)
    expect(page.data[0]?.coin).toBe('xyz:EWY')
  })

  it('returns empty page on bogus tradeId (200 + empty data; bug #15: no synthetic 404)', async () => {
    const { resource } = makeClient(({ url }) => {
      expect(url.pathname).toBe('/completed-trades/not-a-real-id/fills')
      return mockResponse(200, JSON.stringify({ success: true, data: [] }))
    })
    const page = await resource.fills('not-a-real-id')
    expect(page.data).toEqual([])
    expect(page.meta.family).toBe('apiResponse')
  })

  it('does not surface shifted-key fields feeUsdc / typeTrade on the typed model (bug #3)', async () => {
    const { resource } = makeClient(() =>
      mockResponse(200, JSON.stringify({ success: true, data: [TRADE_FILL_ROW] })),
    )
    const page = await resource.fills('trade_BTC_0xabcdef01')
    const fill = page.data[0]
    // Compile-time: keyof TradeFill must not include 'feeUsdc' / 'typeTrade'.
    // Runtime guard: the raw object still has the fields (pass-through) but
    // SDK consumers using the typed shape don't see them in autocomplete.
    // We assert that the documented SDK-visible fields are correct.
    expect(fill?.feeToken).toBe('USDC')
    expect(fill?.tid).toBe(444284598976375)
    expect(fill?.crossed).toBe(true)
    // Compile-time check: these accesses are TS errors against the typed shape.
    // @ts-expect-error feeUsdc is intentionally omitted from TradeFill per PLAN.md §I #3.
    void fill?.feeUsdc
    // @ts-expect-error typeTrade is intentionally omitted from TradeFill per PLAN.md §I #3.
    void fill?.typeTrade
  })
})
