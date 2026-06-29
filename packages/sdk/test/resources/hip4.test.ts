import { describe, expect, it, vi } from 'vitest'
import { ValidationError } from '../../src/errors/index.js'
import { Hip4Resource, parseHip4Description } from '../../src/resources/hip4.js'
import { HttpClient } from '../../src/transport/HttpClient.js'
import type { Address } from '../../src/types/common.js'

const VALID_ADDRESS = '0xa17f5c11aa82798658754a5a563141c535441a79' as Address
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
  return { http, fetchMock, resource: new Hip4Resource(http) }
}

// Wire-shape sample rows (mirrored exactly from exploration/samples/batch-5).
function sampleMarketRow() {
  return {
    outcome_id: 290,
    coin: '#290',
    name: 'Recurring',
    description:
      'class:priceBinary|underlying:BTC|expiry:20260512-0600|targetPrice:80813|period:1d',
    class: 'priceBinary',
    underlying: 'BTC',
    expiry: '20260512-0600',
    target_price: 80813.0,
    period: '1d',
    side_specs: '[{"name":"Yes"},{"name":"No"}]',
    question_id: null,
    quote_token: 0,
    block_time: '2026-05-11T06:00:09.378958',
    settled: 1,
    question_name: '',
    question_description: '',
    total_fills: 41163,
    total_volume: 2609243.39,
    unique_users: 1945,
  }
}

function sampleQuestionRow() {
  return {
    question_id: 0,
    name: 'Recurring',
    description:
      'class:priceBucket|underlying:BTC|expiry:20260508-0600|priceThresholds:79303,82540|period:1d',
    fallback_outcome: 6,
    named_outcomes: [7, 8, 9],
    settled_named_outcomes: [],
    updated_at: '2026-05-08T06:00:06.301000',
  }
}

function sampleOutcomeTokenRow() {
  return {
    outcome_id: 1,
    coin: '@1',
    spot_index: 1,
    spot_name: 'PURR',
    deployer_fee_share: 0.0,
    sz_decimals: 0,
    wei_decimals: 5,
    updated_at: '2026-05-04T05:59:06.113000',
  }
}

function sampleFillRow() {
  return {
    user: VALID_ADDRESS,
    coin: '#290',
    outcome_id: 290,
    px: 0.5,
    sz: 35.0,
    side: 'A',
    time_ms: 1778521680500,
    dir: 'Merge Outcome',
    closedPnl: 5.83,
    hash: '0xabc',
    oid: 421268049869,
    tid: 1001022625127337,
    fee: 0.0,
    feeToken: 'USDH',
    fee_usdc: 0.0,
    typeTrade: 'perp',
    market_name: '#290',
    market_description: '',
  }
}

function sampleFeeRow() {
  return {
    user: VALID_ADDRESS,
    coin: '#230',
    feeToken: 'USDH',
    date: '2026-05-11',
    fills: 17,
    total_fee_raw: 3.34,
    total_fee_usdc: 3.34,
    total_notional: 2229.18,
    effective_rate: 0.0015,
  }
}

function sampleSettlementRow() {
  return {
    outcome_id: 20,
    settle_fraction: 1.0,
    details: 'price:80812.7',
    broadcaster: '0x76d335fbd515969ed5facf98611ca6e3ba87ff01',
    block_time: '2026-05-11T06:00:06.936898',
    block_height: 1285928345,
    nonce: 1778478975974,
  }
}

// -----------------------------------------------------------------------------
// parseHip4Description — PLAN.md §I #12
// -----------------------------------------------------------------------------

describe('parseHip4Description', () => {
  it('parses a priceBinary description with targetPrice', () => {
    const out = parseHip4Description(
      'class:priceBinary|underlying:BTC|expiry:20260512-0600|targetPrice:80813|period:1d',
    )
    expect(out).toEqual({
      class: 'priceBinary',
      underlying: 'BTC',
      expiry: '20260512-0600',
      targetPrice: 80813,
      period: '1d',
    })
  })

  it('parses a priceBucket description with priceThresholds list', () => {
    const out = parseHip4Description(
      'class:priceBucket|underlying:BTC|expiry:20260508-0600|priceThresholds:79303,82540|period:1d',
    )
    expect(out.class).toBe('priceBucket')
    expect(out.priceThresholds).toEqual([79303, 82540])
    expect(out.expiry).toBe('20260508-0600')
    expect(out.period).toBe('1d')
  })

  it('returns {} for empty input and non-string input', () => {
    expect(parseHip4Description('')).toEqual({})
    expect(parseHip4Description(undefined as unknown as string)).toEqual({})
  })

  it('ignores unknown keys and skips bogus targetPrice values', () => {
    const out = parseHip4Description(
      'unknownKey:foo|class:priceBinary|targetPrice:notANumber|period:1d',
    )
    expect(out.class).toBe('priceBinary')
    expect(out.period).toBe('1d')
    expect(out.targetPrice).toBeUndefined()
    expect((out as Record<string, unknown>)['unknownKey']).toBeUndefined()
  })
})

// -----------------------------------------------------------------------------
// markets.list — GET /hip4/markets
// -----------------------------------------------------------------------------

describe('Hip4Resource.markets', () => {
  it('GETs /hip4/markets with typed filters, omits the buggy `coin` filter (bug #22), and unwraps Hip4 envelope', async () => {
    const row = sampleMarketRow()
    const { resource, fetchMock } = buildClient((url) => {
      expect(url.pathname).toBe('/hip4/markets')
      expect(url.searchParams.get('outcome_id')).toBe('290')
      expect(url.searchParams.get('class')).toBe('priceBinary')
      expect(url.searchParams.get('underlying')).toBe('BTC')
      expect(url.searchParams.get('question_id')).toBe('0')
      expect(url.searchParams.get('limit')).toBe('5')
      // Bug #22: SDK does not expose `coin` filter — must not leak into query.
      expect(url.searchParams.has('coin')).toBe(false)
      return mockResponse({ status: 'live', count: 1, data: [row] })
    })
    const page = await resource.markets.list({
      outcomeId: 290,
      class: 'priceBinary',
      underlying: 'BTC',
      questionId: 0,
      limit: 5,
    })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(page.data).toEqual([row])
    expect(page.meta.family).toBe('hip4')
    expect(page.meta.status).toBe('live')
  })

  it('typed surface forbids passing `coin` to markets.list (compile-time defense for bug #22)', async () => {
    // Runtime sanity: even if the user tries to smuggle `coin` via an `any` cast,
    // the SDK query builder ignores it because there is no branch for it.
    const { resource, fetchMock } = buildClient((url) => {
      expect(url.searchParams.has('coin')).toBe(false)
      return mockResponse({ status: 'live', count: 0, data: [] })
    })
    await resource.markets.list({ ...({ coin: '#290' } as object) })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('throws ValidationError when limit exceeds the 1000 cap', async () => {
    const { resource, fetchMock } = buildClient(() =>
      mockResponse({ status: 'live', count: 0, data: [] }),
    )
    await expect(resource.markets.list({ limit: 1001 })).rejects.toBeInstanceOf(ValidationError)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('throws ValidationError on a bogus `class` enum', async () => {
    const { resource, fetchMock } = buildClient(() =>
      mockResponse({ status: 'live', count: 0, data: [] }),
    )
    await expect(
      resource.markets.list({ class: 'bogus' as unknown as 'priceBinary' }),
    ).rejects.toBeInstanceOf(ValidationError)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('iterate pages by offset until a partial page is returned', async () => {
    const { resource, fetchMock } = buildClient((url) => {
      const offset = url.searchParams.get('offset')
      const limit = url.searchParams.get('limit')
      expect(limit).toBe('2')
      if (offset === '0' || offset === null) {
        return mockResponse({
          status: 'live',
          count: 2,
          data: [sampleMarketRow(), { ...sampleMarketRow(), outcome_id: 291, coin: '#291' }],
        })
      }
      expect(offset).toBe('2')
      return mockResponse({
        status: 'live',
        count: 1,
        data: [{ ...sampleMarketRow(), outcome_id: 292, coin: '#292' }],
      })
    })
    const ids: number[] = []
    for await (const row of resource.markets.iterate({ limit: 2 })) {
      ids.push(row.outcome_id)
    }
    expect(ids).toEqual([290, 291, 292])
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })
})

// -----------------------------------------------------------------------------
// outcomes.list — alias of markets, distinct path
// -----------------------------------------------------------------------------

describe('Hip4Resource.outcomes (alias of markets)', () => {
  it('hits /hip4/outcomes (not /hip4/markets) and returns the same Hip4Outcome shape', async () => {
    const row = sampleMarketRow()
    const { resource, fetchMock } = buildClient((url) => {
      expect(url.pathname).toBe('/hip4/outcomes')
      return mockResponse({ status: 'live', count: 1, data: [row] })
    })
    const page = await resource.outcomes.list({ limit: 1 })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(page.data[0]?.outcome_id).toBe(290)
  })
})

// -----------------------------------------------------------------------------
// questions.list / iterate — GET /hip4/questions
// -----------------------------------------------------------------------------

describe('Hip4Resource.questions', () => {
  it('GETs /hip4/questions and preserves the pipe-delimited description (parser is opt-in per PLAN §I #12)', async () => {
    const row = sampleQuestionRow()
    const { resource } = buildClient((url) => {
      expect(url.pathname).toBe('/hip4/questions')
      expect(url.searchParams.get('question_id')).toBe('0')
      return mockResponse({ status: 'live', count: 1, data: [row] })
    })
    const page = await resource.questions.list({ questionId: 0 })
    expect(page.data[0]?.description).toContain('class:priceBucket')
    // Caller opts into structured form via the exported helper.
    const parsed = parseHip4Description(page.data[0]?.description ?? '')
    expect(parsed.priceThresholds).toEqual([79303, 82540])
  })

  it('throws ValidationError when limit exceeds the 1000 cap', async () => {
    const { resource, fetchMock } = buildClient(() =>
      mockResponse({ status: 'live', count: 0, data: [] }),
    )
    await expect(resource.questions.list({ limit: 5000 })).rejects.toBeInstanceOf(ValidationError)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

// -----------------------------------------------------------------------------
// outcomeTokens.list — GET /hip4/outcome-tokens
// -----------------------------------------------------------------------------

describe('Hip4Resource.outcomeTokens', () => {
  it('GETs /hip4/outcome-tokens with `coin=@N` filter (works upstream, PLAN ENDPOINTS HIP-4)', async () => {
    const row = sampleOutcomeTokenRow()
    const { resource } = buildClient((url) => {
      expect(url.pathname).toBe('/hip4/outcome-tokens')
      expect(url.searchParams.get('coin')).toBe('@1')
      return mockResponse({ status: 'live', count: 1, data: [row] })
    })
    const page = await resource.outcomeTokens.list({ coin: '@1' })
    expect(page.data[0]?.spot_name).toBe('PURR')
    expect(page.data[0]?.coin).toBe('@1')
  })
})

// -----------------------------------------------------------------------------
// fills.list / iterate — GET /hip4/fills
// -----------------------------------------------------------------------------

describe('Hip4Resource.fills', () => {
  it('GETs /hip4/fills with `start`/`end` (not start_time/end_time), validates user address', async () => {
    const row = sampleFillRow()
    const { resource } = buildClient((url) => {
      expect(url.pathname).toBe('/hip4/fills')
      expect(url.searchParams.get('user')).toBe(VALID_ADDRESS)
      expect(url.searchParams.get('coin')).toBe('#290')
      expect(url.searchParams.get('outcome_id')).toBe('290')
      // iso-bare encoding → YYYY-MM-DD
      expect(url.searchParams.get('start')).toBe('2026-05-10')
      expect(url.searchParams.get('end')).toBe('2026-05-11')
      expect(url.searchParams.has('start_time')).toBe(false)
      expect(url.searchParams.has('end_time')).toBe(false)
      return mockResponse({ status: 'live', count: 1, data: [row] })
    })
    const page = await resource.fills.list({
      user: VALID_ADDRESS,
      coin: '#290',
      outcomeId: 290,
      startTime: '2026-05-10T00:00:00Z',
      endTime: new Date('2026-05-11T00:00:00Z'),
      limit: 50,
    })
    expect(page.data[0]?.time_ms).toBe(1778521680500)
    expect(page.data[0]?.fee_usdc).toBe(0.0)
    expect(page.data[0]?.feeToken).toBe('USDH')
    expect(page.meta.status).toBe('live')
  })

  it('throws ValidationError on a bad address without making a fetch call', async () => {
    const { resource, fetchMock } = buildClient(() =>
      mockResponse({ status: 'live', count: 0, data: [] }),
    )
    await expect(resource.fills.list({ user: BAD_ADDRESS })).rejects.toBeInstanceOf(ValidationError)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('throws ValidationError when limit exceeds the 1000 cap', async () => {
    const { resource, fetchMock } = buildClient(() =>
      mockResponse({ status: 'live', count: 0, data: [] }),
    )
    await expect(resource.fills.list({ limit: 1001 })).rejects.toBeInstanceOf(ValidationError)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('iterate pages by offset += limit until a partial page is returned', async () => {
    const { resource, fetchMock } = buildClient((url) => {
      const offset = url.searchParams.get('offset')
      const limit = url.searchParams.get('limit')
      expect(limit).toBe('1')
      if (offset === '0' || offset === null) {
        return mockResponse({
          status: 'live',
          count: 1,
          data: [{ ...sampleFillRow(), tid: 1 }],
        })
      }
      expect(offset).toBe('1')
      return mockResponse({ status: 'live', count: 0, data: [] })
    })
    const tids: number[] = []
    for await (const row of resource.fills.iterate({ limit: 1 })) tids.push(row.tid)
    expect(tids).toEqual([1])
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })
})

// -----------------------------------------------------------------------------
// fees.list — GET /hip4/fees
// -----------------------------------------------------------------------------

describe('Hip4Resource.fees', () => {
  it('GETs /hip4/fees with iso-bare time params and unwraps daily aggregates', async () => {
    const row = sampleFeeRow()
    const { resource } = buildClient((url) => {
      expect(url.pathname).toBe('/hip4/fees')
      expect(url.searchParams.get('user')).toBe(VALID_ADDRESS)
      expect(url.searchParams.get('coin')).toBe('#290')
      expect(url.searchParams.get('start')).toBe('2026-05-01')
      return mockResponse({ status: 'live', count: 1, data: [row] })
    })
    const page = await resource.fees.list({
      user: VALID_ADDRESS,
      coin: '#290',
      startTime: '2026-05-01T00:00:00Z',
    })
    expect(page.data[0]?.effective_rate).toBe(0.0015)
    expect(page.data[0]?.date).toBe('2026-05-11')
  })

  it('throws ValidationError on a bad address', async () => {
    const { resource, fetchMock } = buildClient(() =>
      mockResponse({ status: 'live', count: 0, data: [] }),
    )
    await expect(resource.fees.list({ user: BAD_ADDRESS })).rejects.toBeInstanceOf(ValidationError)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

// -----------------------------------------------------------------------------
// settlements.list — GET /hip4/settlements
// -----------------------------------------------------------------------------

describe('Hip4Resource.settlements', () => {
  it('GETs /hip4/settlements with outcome_id filter and surfaces block fields', async () => {
    const row = sampleSettlementRow()
    const { resource } = buildClient((url) => {
      expect(url.pathname).toBe('/hip4/settlements')
      expect(url.searchParams.get('outcome_id')).toBe('20')
      return mockResponse({ status: 'live', count: 1, data: [row] })
    })
    const page = await resource.settlements.list({ outcomeId: 20 })
    expect(page.data[0]?.block_height).toBe(1285928345)
    expect(page.data[0]?.nonce).toBe(1778478975974)
  })
})

// -----------------------------------------------------------------------------
// feeScales.list — GET /hip4/fee-scales (status: not_yet_live)
// -----------------------------------------------------------------------------

describe('Hip4Resource.feeScales', () => {
  it('preserves not_yet_live status, message, and testnet_docs URL in meta (special envelope handling)', async () => {
    const { resource } = buildClient((url) => {
      expect(url.pathname).toBe('/hip4/fee-scales')
      return mockResponse({
        status: 'not_yet_live',
        message: 'HIP-4 is not yet live on mainnet. No data available.',
        testnet_docs: 'https://docs.hypedexer.com/testnet/overview',
        count: 0,
        data: [],
      })
    })
    const page = await resource.feeScales.list()
    expect(page.data).toEqual([])
    expect(page.meta.family).toBe('hip4')
    expect(page.meta.status).toBe('not_yet_live')
    expect(page.meta.testnetDocs).toBe('https://docs.hypedexer.com/testnet/overview')
    expect(page.meta.message).toContain('not yet live')
  })
})

// -----------------------------------------------------------------------------
// analytics.list / iterate — GET /hip4/analytics
// -----------------------------------------------------------------------------

describe('Hip4Resource.analytics', () => {
  it('GETs /hip4/analytics, validates interval enum, and serialises coin arrays as comma-separated', async () => {
    const { resource } = buildClient((url) => {
      expect(url.pathname).toBe('/hip4/analytics')
      expect(url.searchParams.get('interval')).toBe('1d')
      // numeric / string coin ids joined with commas (server normalises ints to #NNN)
      expect(url.searchParams.get('coin')).toBe('290,291')
      expect(url.searchParams.get('limit')).toBe('100')
      return mockResponse({
        status: 'live',
        count: 2,
        data: [
          {
            bucket: '2026-05-11T00:00:00',
            coin: '#290',
            fills: 855,
            volume: 34319.2,
            buy_volume: 22631.34,
            sell_volume: 11687.85,
            fees_usdc: 3.1,
            unique_users: 76,
          },
          {
            bucket: '2026-05-11T00:00:00',
            coin: '#291',
            fills: 433,
            volume: 25663.65,
            buy_volume: 14814.49,
            sell_volume: 10849.16,
            fees_usdc: 0.45,
            unique_users: 30,
          },
        ],
      })
    })
    const page = await resource.analytics.list({
      interval: '1d',
      coin: [290, 291],
      limit: 100,
    })
    expect(page.data).toHaveLength(2)
    // Narrowed by-coin row
    expect(page.data[0] !== undefined && 'coin' in page.data[0]).toBe(true)
  })

  it('throws ValidationError when limit exceeds the 2000 cap', async () => {
    const { resource, fetchMock } = buildClient(() =>
      mockResponse({ status: 'live', count: 0, data: [] }),
    )
    await expect(resource.analytics.list({ limit: 2001 })).rejects.toBeInstanceOf(ValidationError)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('throws ValidationError on bogus interval', async () => {
    const { resource, fetchMock } = buildClient(() =>
      mockResponse({ status: 'live', count: 0, data: [] }),
    )
    await expect(
      resource.analytics.list({ interval: 'bogus' as unknown as '1d' }),
    ).rejects.toBeInstanceOf(ValidationError)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

// -----------------------------------------------------------------------------
// userActions.list — GET /hip4/user-actions (status: not_yet_live + validation bypass)
// -----------------------------------------------------------------------------

describe('Hip4Resource.userActions', () => {
  it('preserves status: not_yet_live and still client-side-validates the action_type enum (PLAN §I #5)', async () => {
    const { resource, fetchMock } = buildClient((url) => {
      expect(url.pathname).toBe('/hip4/user-actions')
      expect(url.searchParams.get('action_type')).toBe('Split')
      return mockResponse({
        status: 'not_yet_live',
        message: 'HIP-4 is not yet live on mainnet.',
        testnet_docs: 'https://docs.hypedexer.com/testnet/overview',
        count: 0,
        data: [],
      })
    })
    const page = await resource.userActions.list({ actionType: 'Split' })
    expect(page.data).toEqual([])
    expect(page.meta.status).toBe('not_yet_live')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('throws ValidationError on bogus action_type even though the server would silently accept it', async () => {
    const { resource, fetchMock } = buildClient(() =>
      mockResponse({ status: 'not_yet_live', count: 0, data: [] }),
    )
    await expect(
      resource.userActions.list({ actionType: 'bogus' as unknown as 'Split' }),
    ).rejects.toBeInstanceOf(ValidationError)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
