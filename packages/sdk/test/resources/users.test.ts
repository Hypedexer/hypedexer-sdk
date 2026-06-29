import { describe, expect, it, vi } from 'vitest'
import { ValidationError } from '../../src/errors/index.js'
import { iterate } from '../../src/pagination/iterator.js'
import { UsersResource } from '../../src/resources/users.js'
import { HttpClient } from '../../src/transport/HttpClient.js'
import type { Address } from '../../src/types/common.js'

const VALID_ADDRESS = '0x1234567890abcdef1234567890abcdef12345678' as Address
const BAD_ADDRESS = '0xnot-a-valid-address' as Address

function mockResponse(status: number, body: string, contentType = 'application/json'): Response {
  return new Response(body, {
    status,
    headers: { 'content-type': contentType },
  })
}

function makeClient(fetchMock: ReturnType<typeof vi.fn>): HttpClient {
  return new HttpClient({
    apiKey: 'test-key',
    fetch: fetchMock as unknown as typeof fetch,
  })
}

// -----------------------------------------------------------------------------
// overview
// -----------------------------------------------------------------------------

describe('UsersResource.overview', () => {
  it('GETs /users/{user}/overview with no time params and unwraps single', async () => {
    const fetchMock = vi.fn(async (input: string | URL) => {
      const url = new URL(input.toString())
      expect(url.pathname).toBe(`/users/${VALID_ADDRESS}/overview`)
      expect(url.searchParams.has('start_time')).toBe(false)
      expect(url.searchParams.has('end_time')).toBe(false)
      return mockResponse(
        200,
        JSON.stringify({
          success: true,
          data: {
            user: VALID_ADDRESS,
            total_volume: 1000,
            total_fees: 12.5,
            fill_count: 8,
            unique_coins: 3,
            total_pnl: -50,
            total_trades: 4,
            total_priority_gas: 0,
            last_activity: '1970-01-01T00:00:00',
            win_rate: 0.5,
          },
          execution_time_ms: 12,
        }),
      )
    })
    const users = new UsersResource(makeClient(fetchMock))
    const res = await users.overview(VALID_ADDRESS)
    expect(res.data.user).toBe(VALID_ADDRESS)
    expect(res.data.total_pnl).toBe(-50)
    // Sentinel preserved at the wire boundary — callers use parseTimestamp().
    expect(res.data.last_activity).toBe('1970-01-01T00:00:00')
    expect(res.meta.family).toBe('apiResponse')
    expect(res.meta.executionMs).toBe(12)
  })

  it('passes startTime / endTime as ISO snake_case query params', async () => {
    const fetchMock = vi.fn(async (input: string | URL) => {
      const url = new URL(input.toString())
      expect(url.searchParams.get('start_time')).toBe('2026-05-01T00:00:00.000Z')
      expect(url.searchParams.get('end_time')).toBe('2026-05-02T00:00:00.000Z')
      return mockResponse(200, JSON.stringify({ success: true, data: null }))
    })
    const users = new UsersResource(makeClient(fetchMock))
    await users.overview(VALID_ADDRESS, {
      startTime: '2026-05-01T00:00:00Z',
      endTime: '2026-05-02T00:00:00Z',
    })
  })

  it('throws ValidationError for a bad address without making a fetch call (bug #14)', async () => {
    const fetchMock = vi.fn(async () => mockResponse(200, '{"data":null}'))
    const users = new UsersResource(makeClient(fetchMock))
    await expect(users.overview(BAD_ADDRESS)).rejects.toBeInstanceOf(ValidationError)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

// -----------------------------------------------------------------------------
// performance
// -----------------------------------------------------------------------------

describe('UsersResource.performance', () => {
  it('GETs /users/{user}/performance and unwraps single', async () => {
    const fetchMock = vi.fn(async (input: string | URL) => {
      const url = new URL(input.toString())
      expect(url.pathname).toBe(`/users/${VALID_ADDRESS}/performance`)
      return mockResponse(
        200,
        JSON.stringify({
          success: true,
          data: {
            user: VALID_ADDRESS,
            total_trades: 100,
            win_rate: 0.6,
            avg_win: 25,
            avg_loss: 15,
            profit_factor: 1.4,
            max_drawdown: 200,
            avg_trade_size: 500,
            avg_holding_time_s: 370000000000,
            wins: 60,
            losses: 30,
            total_pnl: 1500,
          },
        }),
      )
    })
    const users = new UsersResource(makeClient(fetchMock))
    const res = await users.performance(VALID_ADDRESS)
    expect(res.data.win_rate).toBe(0.6)
    // Documented inflated value — see PLAN §I #8 — pass-through, not corrected.
    expect(res.data.avg_holding_time_s).toBe(370000000000)
  })

  it('throws ValidationError for a bad address without making a fetch call (bug #14)', async () => {
    const fetchMock = vi.fn(async () => mockResponse(200, '{"data":null}'))
    const users = new UsersResource(makeClient(fetchMock))
    await expect(users.performance(BAD_ADDRESS)).rejects.toBeInstanceOf(ValidationError)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

// -----------------------------------------------------------------------------
// coins
// -----------------------------------------------------------------------------

describe('UsersResource.coins', () => {
  it('GETs /users/{user}/coins with limit and offset', async () => {
    const fetchMock = vi.fn(async (input: string | URL) => {
      const url = new URL(input.toString())
      expect(url.pathname).toBe(`/users/${VALID_ADDRESS}/coins`)
      expect(url.searchParams.get('limit')).toBe('50')
      expect(url.searchParams.get('offset')).toBe('100')
      return mockResponse(
        200,
        JSON.stringify({
          success: true,
          data: [
            {
              coin: 'BTC',
              total_volume: 1000,
              fill_count: 5,
              total_fees: 2.5,
              avg_price: 75000,
              price_range: { min: 74000, max: 76000 },
              total_pnl: 100,
            },
          ],
          total_count: 1,
        }),
      )
    })
    const users = new UsersResource(makeClient(fetchMock))
    const res = await users.coins(VALID_ADDRESS, { limit: 50, offset: 100 })
    expect(res.data).toHaveLength(1)
    expect(res.data[0]?.coin).toBe('BTC')
  })

  it('throws ValidationError for a bad address without making a fetch call (bug #14)', async () => {
    const fetchMock = vi.fn(async () => mockResponse(200, '{"data":[]}'))
    const users = new UsersResource(makeClient(fetchMock))
    await expect(users.coins(BAD_ADDRESS)).rejects.toBeInstanceOf(ValidationError)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('throws ValidationError when limit exceeds cap (100)', async () => {
    const fetchMock = vi.fn(async () => mockResponse(200, '{"data":[]}'))
    const users = new UsersResource(makeClient(fetchMock))
    await expect(users.coins(VALID_ADDRESS, { limit: 999 })).rejects.toBeInstanceOf(ValidationError)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('iterate() walks two pages of /users/{user}/coins via offset pagination', async () => {
    const fetchMock = vi.fn(async (input: string | URL) => {
      const url = new URL(input.toString())
      const offset = Number(url.searchParams.get('offset'))
      if (offset === 0) {
        return mockResponse(
          200,
          JSON.stringify({
            success: true,
            data: [
              {
                coin: 'BTC',
                total_volume: 1,
                fill_count: 1,
                total_fees: 0,
                avg_price: 0,
                price_range: { min: 0, max: 0 },
                total_pnl: 0,
              },
              {
                coin: 'ETH',
                total_volume: 2,
                fill_count: 2,
                total_fees: 0,
                avg_price: 0,
                price_range: { min: 0, max: 0 },
                total_pnl: 0,
              },
            ],
          }),
        )
      }
      return mockResponse(
        200,
        JSON.stringify({
          success: true,
          data: [
            {
              coin: 'SOL',
              total_volume: 3,
              fill_count: 3,
              total_fees: 0,
              avg_price: 0,
              price_range: { min: 0, max: 0 },
              total_pnl: 0,
            },
          ],
        }),
      )
    })
    const users = new UsersResource(makeClient(fetchMock))
    const collected: string[] = []
    for await (const row of iterate(
      (p) => users.coins(VALID_ADDRESS, p),
      { limit: 2 },
      { kind: 'offset' },
    )) {
      collected.push(row.coin)
    }
    expect(collected).toEqual(['BTC', 'ETH', 'SOL'])
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })
})

// -----------------------------------------------------------------------------
// leaderboard
// -----------------------------------------------------------------------------

describe('UsersResource.leaderboard', () => {
  it('GETs /users/leaderboard with by=volume and unwraps a list of LeaderboardByVolume', async () => {
    const fetchMock = vi.fn(async (input: string | URL) => {
      const url = new URL(input.toString())
      expect(url.pathname).toBe('/users/leaderboard')
      expect(url.searchParams.get('by')).toBe('volume')
      expect(url.searchParams.get('hours')).toBe('24')
      expect(url.searchParams.get('limit')).toBe('5')
      return mockResponse(
        200,
        JSON.stringify({
          success: true,
          data: [{ user: VALID_ADDRESS, total_volume: 1000, fill_count: 10, unique_coins: 4 }],
        }),
      )
    })
    const users = new UsersResource(makeClient(fetchMock))
    const res = await users.leaderboard({ by: 'volume', hours: 24, limit: 5 })
    expect(res.data).toHaveLength(1)
    // Discriminated overload narrows the row type — these fields are typed.
    expect(res.data[0]?.total_volume).toBe(1000)
    expect(res.data[0]?.unique_coins).toBe(4)
  })

  it('GETs /users/leaderboard with by=pnl and surfaces trade_count', async () => {
    const fetchMock = vi.fn(async (input: string | URL) => {
      const url = new URL(input.toString())
      expect(url.searchParams.get('by')).toBe('pnl')
      return mockResponse(
        200,
        JSON.stringify({
          success: true,
          data: [{ user: VALID_ADDRESS, total_pnl: 500, trade_count: 12 }],
        }),
      )
    })
    const users = new UsersResource(makeClient(fetchMock))
    const res = await users.leaderboard({ by: 'pnl' })
    expect(res.data[0]?.total_pnl).toBe(500)
    expect(res.data[0]?.trade_count).toBe(12)
  })

  it('throws ValidationError for a bogus `by` (PLAN §I #23 client-side guard)', async () => {
    const fetchMock = vi.fn(async () => mockResponse(200, '{"data":[]}'))
    const users = new UsersResource(makeClient(fetchMock))
    await expect(
      // Cast to bypass the literal-union for the negative test.
      users.leaderboard({ by: 'bogus' as 'volume' }),
    ).rejects.toBeInstanceOf(ValidationError)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('throws ValidationError when hours exceeds cap (168)', async () => {
    const fetchMock = vi.fn(async () => mockResponse(200, '{"data":[]}'))
    const users = new UsersResource(makeClient(fetchMock))
    await expect(users.leaderboard({ by: 'volume', hours: 999 })).rejects.toBeInstanceOf(
      ValidationError,
    )
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('throws ValidationError when limit exceeds cap (100)', async () => {
    const fetchMock = vi.fn(async () => mockResponse(200, '{"data":[]}'))
    const users = new UsersResource(makeClient(fetchMock))
    await expect(users.leaderboard({ by: 'volume', limit: 9999 })).rejects.toBeInstanceOf(
      ValidationError,
    )
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

// -----------------------------------------------------------------------------
// active
// -----------------------------------------------------------------------------

describe('UsersResource.active', () => {
  it('GETs /users/active with optional hours / limit', async () => {
    const fetchMock = vi.fn(async (input: string | URL) => {
      const url = new URL(input.toString())
      expect(url.pathname).toBe('/users/active')
      expect(url.searchParams.get('hours')).toBe('24')
      expect(url.searchParams.get('limit')).toBe('10')
      return mockResponse(
        200,
        JSON.stringify({
          success: true,
          data: [
            {
              user: VALID_ADDRESS,
              fill_count: 5,
              total_volume: 1000,
              unique_coins: 2,
              last_activity: '2026-05-11T15:51:21.000000',
            },
          ],
        }),
      )
    })
    const users = new UsersResource(makeClient(fetchMock))
    const res = await users.active({ hours: 24, limit: 10 })
    expect(res.data).toHaveLength(1)
    expect(res.data[0]?.user).toBe(VALID_ADDRESS)
  })

  it('throws ValidationError when hours exceeds cap (168)', async () => {
    const fetchMock = vi.fn(async () => mockResponse(200, '{"data":[]}'))
    const users = new UsersResource(makeClient(fetchMock))
    await expect(users.active({ hours: 999 })).rejects.toBeInstanceOf(ValidationError)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('throws ValidationError when limit exceeds cap (100)', async () => {
    const fetchMock = vi.fn(async () => mockResponse(200, '{"data":[]}'))
    const users = new UsersResource(makeClient(fetchMock))
    await expect(users.active({ limit: 9999 })).rejects.toBeInstanceOf(ValidationError)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('iterate() walks two pages of /users/active via offset pagination', async () => {
    const fetchMock = vi.fn(async (input: string | URL) => {
      const url = new URL(input.toString())
      const offset = Number(url.searchParams.get('offset'))
      if (offset === 0) {
        return mockResponse(
          200,
          JSON.stringify({
            success: true,
            data: [
              {
                user: VALID_ADDRESS,
                fill_count: 1,
                total_volume: 1,
                unique_coins: 1,
                last_activity: '2026-05-11T15:00:00',
              },
              {
                user: VALID_ADDRESS,
                fill_count: 2,
                total_volume: 2,
                unique_coins: 1,
                last_activity: '2026-05-11T15:01:00',
              },
            ],
          }),
        )
      }
      return mockResponse(
        200,
        JSON.stringify({
          success: true,
          data: [
            {
              user: VALID_ADDRESS,
              fill_count: 3,
              total_volume: 3,
              unique_coins: 1,
              last_activity: '2026-05-11T15:02:00',
            },
          ],
        }),
      )
    })
    const users = new UsersResource(makeClient(fetchMock))
    let count = 0
    for await (const row of iterate((p) => users.active(p), { limit: 2 }, { kind: 'offset' })) {
      expect(row.user).toBe(VALID_ADDRESS)
      count++
    }
    expect(count).toBe(3)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })
})
