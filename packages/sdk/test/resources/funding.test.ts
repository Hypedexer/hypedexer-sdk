import { describe, expect, it, vi } from 'vitest'
import { ValidationError } from '../../src/errors/index.js'
import { FundingResource } from '../../src/resources/funding.js'
import { HttpClient } from '../../src/transport/HttpClient.js'
import type { Address } from '../../src/types/common.js'
import type { FundingPayment, FundingRate } from '../../src/types/funding.js'

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

function sampleRate(overrides: Partial<FundingRate> = {}): FundingRate {
  return {
    coin: 'BTC',
    fundingRate: '0.0000125',
    premium: '-0.0000101097',
    time: 1778521680500,
    ...overrides,
  }
}

function samplePayment(overrides: Partial<FundingPayment> = {}): FundingPayment {
  return {
    time: 1778521680500,
    coin: 'BTC',
    usdc: '0.5',
    szi: '0.1',
    delta: '0.01',
    ...overrides,
  }
}

// -----------------------------------------------------------------------------
// predicted — GET /funding/predictedFundings
// -----------------------------------------------------------------------------

describe('FundingResource.predicted', () => {
  it('GETs /funding/predictedFundings and returns bare-envelope Page<FundingRate>', async () => {
    const rows = [sampleRate(), sampleRate({ coin: 'ETH', fundingRate: '-0.0000202' })]
    const { http, fetchMock } = buildClient((url) => {
      expect(url.pathname).toBe('/funding/predictedFundings')
      expect([...url.searchParams.keys()]).toEqual([])
      return mockResponse(rows)
    })
    const funding = new FundingResource(http)

    const page = await funding.predicted()
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(page.data).toEqual(rows)
    expect(page.meta.family).toBe('bare')
    // bare envelope carries no nextCursor / hasMore / executionMs
    expect(page.meta.nextCursor).toBeUndefined()
    expect(page.meta.hasMore).toBeUndefined()
  })

  it('returns an empty array when the server responds with null', async () => {
    const { http } = buildClient(() => mockResponse(null))
    const funding = new FundingResource(http)
    const page = await funding.predicted()
    expect(page.data).toEqual([])
    expect(page.meta.family).toBe('bare')
  })
})

// -----------------------------------------------------------------------------
// history — GET /funding/fundingHistory
// -----------------------------------------------------------------------------

describe('FundingResource.history', () => {
  it('GETs /funding/fundingHistory with epoch-camel time params', async () => {
    const rows = [sampleRate()]
    const { http, fetchMock } = buildClient((url) => {
      expect(url.pathname).toBe('/funding/fundingHistory')
      expect(url.searchParams.get('coin')).toBe('BTC')
      // epoch-camel: numeric ms, camelCase key names
      expect(url.searchParams.get('startTime')).toBe(
        String(new Date('2026-05-01T00:00:00Z').getTime()),
      )
      expect(url.searchParams.get('endTime')).toBe(String(1778521680500))
      expect(url.searchParams.get('limit')).toBe('100')
      return mockResponse(rows)
    })
    const funding = new FundingResource(http)

    const page = await funding.history({
      coin: 'BTC',
      startTime: '2026-05-01T00:00:00Z',
      endTime: 1778521680500,
      limit: 100,
    })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(page.data).toEqual(rows)
    expect(page.meta.family).toBe('bare')
  })

  it('omits unset optional params from the query string', async () => {
    const { http } = buildClient((url) => {
      expect(url.searchParams.has('startTime')).toBe(false)
      expect(url.searchParams.has('endTime')).toBe(false)
      expect(url.searchParams.has('limit')).toBe(false)
      expect(url.searchParams.get('coin')).toBe('BTC')
      return mockResponse([])
    })
    const funding = new FundingResource(http)
    const page = await funding.history({ coin: 'BTC' })
    expect(page.data).toEqual([])
  })

  it('throws ValidationError when limit exceeds the 5000 cap', async () => {
    const { http, fetchMock } = buildClient(() => mockResponse([]))
    const funding = new FundingResource(http)
    await expect(funding.history({ coin: 'BTC', limit: 5001 })).rejects.toBeInstanceOf(
      ValidationError,
    )
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

// -----------------------------------------------------------------------------
// iterateHistory — time-window pagination
// -----------------------------------------------------------------------------

describe('FundingResource.iterateHistory', () => {
  it('decrements endTime to oldest row.time across pages and stops on empty', async () => {
    const page1 = [
      sampleRate({ time: 3000 }),
      sampleRate({ time: 2000 }),
      sampleRate({ time: 1500 }),
    ]
    const page2 = [sampleRate({ time: 1000 }), sampleRate({ time: 800 })]

    let call = 0
    const { http, fetchMock } = buildClient((url) => {
      call += 1
      expect(url.pathname).toBe('/funding/fundingHistory')
      expect(url.searchParams.get('coin')).toBe('BTC')
      if (call === 1) {
        expect(url.searchParams.has('endTime')).toBe(false)
        return mockResponse(page1)
      }
      if (call === 2) {
        // After page1, endTime should be oldest.time - 1 = 1500 - 1 = 1499
        expect(url.searchParams.get('endTime')).toBe('1499')
        return mockResponse(page2)
      }
      // After page2, endTime = 800 - 1 = 799 → empty page terminates
      expect(url.searchParams.get('endTime')).toBe('799')
      return mockResponse([])
    })
    const funding = new FundingResource(http)

    const times: number[] = []
    for await (const row of funding.iterateHistory({ coin: 'BTC' })) {
      times.push(row.time)
    }

    expect(times).toEqual([3000, 2000, 1500, 1000, 800])
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })
})

// -----------------------------------------------------------------------------
// userFunding — GET /funding/userFunding
// -----------------------------------------------------------------------------

describe('FundingResource.userFunding', () => {
  it('GETs /funding/userFunding with epoch-camel params and the user query', async () => {
    const rows = [samplePayment()]
    const { http, fetchMock } = buildClient((url) => {
      expect(url.pathname).toBe('/funding/userFunding')
      expect(url.searchParams.get('user')).toBe(VALID_ADDRESS)
      expect(url.searchParams.get('startTime')).toBe(String(1778000000000))
      expect(url.searchParams.get('endTime')).toBe(String(1778521680500))
      expect(url.searchParams.get('limit')).toBe('500')
      return mockResponse(rows)
    })
    const funding = new FundingResource(http)

    const page = await funding.userFunding({
      user: VALID_ADDRESS,
      startTime: 1778000000000,
      endTime: 1778521680500,
      limit: 500,
    })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(page.data).toEqual(rows)
    expect(page.meta.family).toBe('bare')
  })

  it('returns an empty page when upstream returns [] (bug #25 — every tested user)', async () => {
    const { http, fetchMock } = buildClient((url) => {
      expect(url.pathname).toBe('/funding/userFunding')
      expect(url.searchParams.get('user')).toBe(VALID_ADDRESS)
      return mockResponse([])
    })
    const funding = new FundingResource(http)
    const page = await funding.userFunding({ user: VALID_ADDRESS })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(page.data).toEqual([])
    expect(page.meta.family).toBe('bare')
  })

  it('throws ValidationError on a bad address without making a fetch call', async () => {
    const { http, fetchMock } = buildClient(() => mockResponse([]))
    const funding = new FundingResource(http)
    await expect(funding.userFunding({ user: BAD_ADDRESS as Address })).rejects.toBeInstanceOf(
      ValidationError,
    )
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('throws ValidationError when limit exceeds the 5000 cap', async () => {
    const { http, fetchMock } = buildClient(() => mockResponse([]))
    const funding = new FundingResource(http)
    await expect(funding.userFunding({ user: VALID_ADDRESS, limit: 9999 })).rejects.toBeInstanceOf(
      ValidationError,
    )
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('iterateUserFunding refuses a bad address synchronously', async () => {
    const { http, fetchMock } = buildClient(() => mockResponse([]))
    const funding = new FundingResource(http)
    expect(() => funding.iterateUserFunding({ user: BAD_ADDRESS as Address })).toThrow(
      ValidationError,
    )
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('iterateUserFunding decrements endTime across pages and terminates on empty', async () => {
    const page1 = [samplePayment({ time: 5000 }), samplePayment({ time: 4000 })]
    const page2 = [samplePayment({ time: 3000 })]

    let call = 0
    const { http, fetchMock } = buildClient((url) => {
      call += 1
      expect(url.pathname).toBe('/funding/userFunding')
      expect(url.searchParams.get('user')).toBe(VALID_ADDRESS)
      if (call === 1) {
        expect(url.searchParams.has('endTime')).toBe(false)
        return mockResponse(page1)
      }
      if (call === 2) {
        expect(url.searchParams.get('endTime')).toBe('3999')
        return mockResponse(page2)
      }
      expect(url.searchParams.get('endTime')).toBe('2999')
      return mockResponse([])
    })
    const funding = new FundingResource(http)

    const out: number[] = []
    for await (const row of funding.iterateUserFunding({ user: VALID_ADDRESS })) {
      out.push(row.time)
    }

    expect(out).toEqual([5000, 4000, 3000])
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })
})
