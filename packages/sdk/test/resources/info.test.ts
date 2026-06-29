import { describe, expect, it, vi } from 'vitest'
import { ServerError, ValidationError } from '../../src/errors/index.js'
import { InfoResource } from '../../src/resources/info.js'
import { HttpClient } from '../../src/transport/HttpClient.js'
import type { Address } from '../../src/types/common.js'

const VALID_ADDRESS = '0x13ab1fa35000f7332c601b17dd1ea796a85fe803' as Address
const BAD_ADDRESS = '0xnot-an-address'

function mockResponse(body: unknown, status = 200): Response {
  return new Response(typeof body === 'string' ? body : JSON.stringify(body), {
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

function readBody(init: RequestInit | undefined): Record<string, unknown> {
  expect(init?.method).toBe('POST')
  expect(typeof init?.body).toBe('string')
  return JSON.parse(init?.body as string) as Record<string, unknown>
}

// -----------------------------------------------------------------------------
// Common dispatch behaviour — POST shape, no-undefined leak, returns .data
// -----------------------------------------------------------------------------

describe('InfoResource.info — dispatcher basics', () => {
  it('POSTs to /info with {type, ...rest} and unwraps APIResponse.data', async () => {
    const fillRow = {
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
    }
    const { http, fetchMock } = buildClient((url, init) => {
      expect(url.pathname).toBe('/info')
      const body = readBody(init)
      expect(body['type']).toBe('fills')
      expect(body['coin']).toBe('BTC')
      expect(body['side']).toBe('B')
      expect(body['has_priority_gas']).toBe(true)
      expect(body['limit']).toBe(100)
      expect(body['start_time']).toBe('2026-05-01T00:00:00.000Z')
      expect(body['end_time']).toBe('2026-05-11T00:00:00.000Z')
      expect('cursor' in body).toBe(false)
      return mockResponse({
        success: true,
        data: [fillRow],
        next_cursor: 'c1',
        has_more: true,
      })
    })
    const info = new InfoResource(http)

    const result = await info.info({
      type: 'fills',
      coin: 'BTC',
      side: 'B',
      has_priority_gas: true,
      limit: 100,
      start_time: '2026-05-01T00:00:00Z',
      end_time: new Date('2026-05-11T00:00:00Z'),
    })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(Array.isArray(result)).toBe(true)
    expect(result).toHaveLength(1)
    expect(result[0]?.tid).toBe(444284598976375)
  })

  it('omits undefined keys from the body and forwards minimal payloads', async () => {
    const { http, fetchMock } = buildClient((_url, init) => {
      const body = readBody(init)
      expect(body).toEqual({ type: 'recentFills' })
      return mockResponse({ success: true, data: [] })
    })
    const info = new InfoResource(http)
    const result = await info.info({ type: 'recentFills' })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(result).toEqual([])
  })

  it('forwards no-param types as just {type}', async () => {
    const { http, fetchMock } = buildClient((_url, init) => {
      const body = readBody(init)
      expect(body).toEqual({ type: 'volume24h' })
      return mockResponse({
        success: true,
        data: { value: 1_234_567, variationPct: 4.2 },
      })
    })
    const info = new InfoResource(http)
    const result = await info.info({ type: 'volume24h' })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(result.value).toBe(1_234_567)
    expect(result.variationPct).toBe(4.2)
  })
})

// -----------------------------------------------------------------------------
// fillsByTradeId — single required `tradeId` body param
// -----------------------------------------------------------------------------

describe('InfoResource.info — fillsByTradeId', () => {
  it('POSTs the tradeId verbatim in the body and returns TradeFill[]', async () => {
    const tradeId = 'trade_xyz:EWY_0xabcdef01'
    const { http, fetchMock } = buildClient((_url, init) => {
      const body = readBody(init)
      expect(body).toEqual({ type: 'fillsByTradeId', tradeId })
      return mockResponse({
        success: true,
        data: [
          {
            user: VALID_ADDRESS,
            coin: 'xyz:EWY',
            coinMeaning: 'EWY',
            px: 10,
            sz: 1,
            side: 'A',
            time: '2026-05-11T15:22:49.398000',
            startPosition: 0,
            dir: 'Open Long',
            closedPnl: 0,
            hash: '0xabc',
            oid: 1,
            crossed: true,
            tid: 1,
            cloid: '0x0',
            fee: 0.1,
            feeToken: 'USDC',
          },
        ],
      })
    })
    const info = new InfoResource(http)
    const result = await info.info({ type: 'fillsByTradeId', tradeId })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(result).toHaveLength(1)
    expect(result[0]?.coin).toBe('xyz:EWY')
  })
})

// -----------------------------------------------------------------------------
// accountOverview — user is required and validated client-side (bug #14)
// -----------------------------------------------------------------------------

describe('InfoResource.info — accountOverview', () => {
  it('validates user address client-side and POSTs it in the body', async () => {
    const { http, fetchMock } = buildClient((_url, init) => {
      const body = readBody(init)
      expect(body['type']).toBe('accountOverview')
      expect(body['user']).toBe(VALID_ADDRESS)
      expect(body['start_time']).toBe('2026-05-01T00:00:00.000Z')
      return mockResponse({
        success: true,
        data: {
          user: VALID_ADDRESS,
          total_volume: 1000,
          total_fees: 2,
          fill_count: 10,
          unique_coins: 3,
          total_pnl: 5,
          total_trades: 4,
          total_priority_gas: 0,
          last_activity: '2026-05-11T10:00:00',
          win_rate: 0.6,
        },
      })
    })
    const info = new InfoResource(http)
    const result = await info.info({
      type: 'accountOverview',
      user: VALID_ADDRESS,
      start_time: '2026-05-01T00:00:00Z',
    })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(result.user).toBe(VALID_ADDRESS)
    expect(result.total_volume).toBe(1000)
  })

  it('rejects a bad address synchronously without making a fetch call (bug #14)', async () => {
    const { http, fetchMock } = buildClient(() =>
      mockResponse({ success: true, data: { user: BAD_ADDRESS } }),
    )
    const info = new InfoResource(http)
    await expect(
      info.info({ type: 'accountOverview', user: BAD_ADDRESS as Address }),
    ).rejects.toBeInstanceOf(ValidationError)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('rejects a bad address for tradeHistory as well', async () => {
    const { http, fetchMock } = buildClient(() => mockResponse({ success: true, data: [] }))
    const info = new InfoResource(http)
    await expect(
      info.info({ type: 'tradeHistory', user: BAD_ADDRESS as Address }),
    ).rejects.toBeInstanceOf(ValidationError)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

// -----------------------------------------------------------------------------
// PLAN.md §I bug #11 — currentFundingRates + vaultList unwrap
// -----------------------------------------------------------------------------

describe('InfoResource.info — bug #11 unwrap (currentFundingRates / vaultList)', () => {
  it('unwraps APIResponse-wrapped currentFundingRates back to a bare FundingRate[]', async () => {
    const rates = [
      { coin: 'BTC', fundingRate: '-0.0000101097', premium: '0.0001', time: 1715000000000 },
      { coin: 'ETH', fundingRate: '0.00000125', premium: '-0.0002', time: 1715000000000 },
    ]
    const { http, fetchMock } = buildClient((_url, init) => {
      const body = readBody(init)
      expect(body).toEqual({ type: 'currentFundingRates' })
      // /info wraps the otherwise-bare REST response in APIResponse (bug #11)
      return mockResponse({
        success: true,
        data: rates,
        message: 'wrapped by /info',
      })
    })
    const info = new InfoResource(http)
    const result = await info.info({ type: 'currentFundingRates' })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(Array.isArray(result)).toBe(true)
    expect(result).toEqual(rates)
    expect(result[0]?.fundingRate).toBe('-0.0000101097')
  })

  it('unwraps APIResponse-wrapped vaultList back to a bare VaultSummary[]', async () => {
    const vaults = [
      {
        vaultAddress: VALID_ADDRESS,
        name: 'HLP',
        leader: VALID_ADDRESS,
        leaderCommission: 0.1,
        isClosed: false,
        followerCount: 100,
        snapshotTime: 1715000000000,
        createTime: 1700000000000,
      },
    ]
    const { http, fetchMock } = buildClient((_url, init) => {
      const body = readBody(init)
      expect(body['type']).toBe('vaultList')
      expect(body['limit']).toBe(50)
      expect(body['includeClosed']).toBe(true)
      // /info wraps the otherwise-bare REST response in APIResponse (bug #11)
      return mockResponse({ success: true, data: vaults })
    })
    const info = new InfoResource(http)
    const result = await info.info({
      type: 'vaultList',
      limit: 50,
      includeClosed: true,
    })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(result).toEqual(vaults)
  })
})

// -----------------------------------------------------------------------------
// PLAN.md §I bug #1 — spot* types still 500, passthrough ServerError via parseError
// -----------------------------------------------------------------------------

describe('InfoResource.info — bug #1 spot passthrough', () => {
  it('propagates the 500 ClickHouse error as a ServerError for spotTokenList', async () => {
    const { http, fetchMock } = buildClient((_url, init) => {
      const body = readBody(init)
      expect(body).toEqual({ type: 'spotTokenList' })
      return new Response(
        "Code: 47. DB::Exception: Unknown table expression identifier 'hl_spot_tokens'",
        { status: 500, headers: { 'content-type': 'text/plain' } },
      )
    })
    const info = new InfoResource(http)
    await expect(info.info({ type: 'spotTokenList' })).rejects.toBeInstanceOf(ServerError)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('propagates the 500 ClickHouse error as a ServerError for spotPairList', async () => {
    const { http, fetchMock } = buildClient(
      () => new Response('boom', { status: 500, headers: { 'content-type': 'text/plain' } }),
    )
    const info = new InfoResource(http)
    await expect(info.info({ type: 'spotPairList' })).rejects.toBeInstanceOf(ServerError)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})

// -----------------------------------------------------------------------------
// PLAN.md §I bug #21 — 400 {error: string} maps to ValidationError via parseError
// -----------------------------------------------------------------------------

describe('InfoResource.info — bug #21 dispatcher error shape', () => {
  it('maps a 400 {error: string} response to ValidationError via parseError', async () => {
    const { http, fetchMock } = buildClient(() =>
      mockResponse({ error: 'Unknown type: bogus' }, 400),
    )
    const info = new InfoResource(http)
    await expect(
      // cast through unknown to bypass the discriminated union at the test boundary
      info.info({ type: 'bogus' as unknown as 'fills' }),
    ).rejects.toBeInstanceOf(ValidationError)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('maps a 400 {error: "JSON body required"} on empty body to ValidationError', async () => {
    const { http, fetchMock } = buildClient(() =>
      mockResponse({ error: 'JSON body required' }, 400),
    )
    const info = new InfoResource(http)
    await expect(info.info({ type: 'volume24h' })).rejects.toBeInstanceOf(ValidationError)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})
