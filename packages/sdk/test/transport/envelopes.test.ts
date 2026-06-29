import { describe, expect, it } from 'vitest'
import { unwrap, unwrapSingle } from '../../src/transport/envelopes.js'

describe('unwrap — apiResponse family', () => {
  it('maps all envelope fields onto meta and passes data through', () => {
    const raw = {
      success: true,
      message: 'ok',
      data: [
        { tid: 1, px: 100 },
        { tid: 2, px: 101 },
      ],
      total_count: 1234,
      execution_time_ms: 17,
      next_cursor: '1778513002104:444284598976375',
      has_more: true,
    }
    const page = unwrap<{ tid: number; px: number }>(raw, 'apiResponse')
    expect(page.data).toEqual([
      { tid: 1, px: 100 },
      { tid: 2, px: 101 },
    ])
    expect(page.meta).toEqual({
      family: 'apiResponse',
      message: 'ok',
      executionMs: 17,
      totalCount: 1234,
      nextCursor: '1778513002104:444284598976375',
      hasMore: true,
    })
  })

  it('preserves total_count: null without coercion', () => {
    const raw = {
      success: true,
      data: [],
      total_count: null,
      next_cursor: null,
      has_more: null,
    }
    const page = unwrap(raw, 'apiResponse')
    expect(page.meta.totalCount).toBeNull()
    expect(page.meta.nextCursor).toBeNull()
    expect(page.meta.hasMore).toBeNull()
  })

  it('returns empty array when data is missing (batch-9 spot 500 quirk)', () => {
    const raw = { success: false, message: 'partial failure' }
    const page = unwrap(raw, 'apiResponse')
    expect(page.data).toEqual([])
    expect(page.meta.message).toBe('partial failure')
    expect(page.meta.family).toBe('apiResponse')
  })

  it('returns empty array when data is explicitly null', () => {
    const raw = { success: true, data: null }
    const page = unwrap(raw, 'apiResponse')
    expect(page.data).toEqual([])
  })

  it('omits unspecified optional fields from meta', () => {
    const raw = { success: true, data: [{ x: 1 }] }
    const page = unwrap(raw, 'apiResponse')
    expect(page.meta).toEqual({ family: 'apiResponse' })
  })

  it('falls back to empty array when raw is not an object', () => {
    const page = unwrap(null, 'apiResponse')
    expect(page.data).toEqual([])
    expect(page.meta.family).toBe('apiResponse')
  })
})

describe('unwrap — bare family', () => {
  it('treats raw as the array directly', () => {
    const raw = [{ coin: 'BTC' }, { coin: 'ETH' }]
    const page = unwrap<{ coin: string }>(raw, 'bare')
    expect(page.data).toEqual(raw)
    expect(page.meta).toEqual({ family: 'bare' })
  })

  it('returns an empty page when raw is null', () => {
    const page = unwrap(null, 'bare')
    expect(page.data).toEqual([])
    expect(page.meta).toEqual({ family: 'bare' })
  })

  it('returns an empty page when raw is undefined', () => {
    const page = unwrap(undefined, 'bare')
    expect(page.data).toEqual([])
    expect(page.meta).toEqual({ family: 'bare' })
  })

  it('returns an empty page when raw is a scalar (defensive)', () => {
    const page = unwrap('not-an-array', 'bare')
    expect(page.data).toEqual([])
  })
})

describe('unwrap — hip4 family', () => {
  it('extracts data array and preserves status/message/testnet_docs', () => {
    const raw = {
      status: 'live',
      count: 2,
      data: [{ outcomeId: 290 }, { outcomeId: 291 }],
      message: 'serving live data',
      testnet_docs: 'https://docs.example.com/hip4',
    }
    const page = unwrap<{ outcomeId: number }>(raw, 'hip4')
    expect(page.data).toEqual([{ outcomeId: 290 }, { outcomeId: 291 }])
    expect(page.meta).toEqual({
      family: 'hip4',
      status: 'live',
      message: 'serving live data',
      testnetDocs: 'https://docs.example.com/hip4',
    })
  })

  it('preserves status/message/testnetDocs when status === "not_yet_live"', () => {
    const raw = {
      status: 'not_yet_live',
      count: 0,
      data: [],
      message: 'HIP-4 not yet live on mainnet',
      testnet_docs: 'https://docs.example.com/hip4/testnet',
    }
    const page = unwrap(raw, 'hip4')
    expect(page.data).toEqual([])
    expect(page.meta.status).toBe('not_yet_live')
    expect(page.meta.message).toBe('HIP-4 not yet live on mainnet')
    expect(page.meta.testnetDocs).toBe('https://docs.example.com/hip4/testnet')
  })

  it('returns empty array when data is missing', () => {
    const raw = { status: 'live' }
    const page = unwrap(raw, 'hip4')
    expect(page.data).toEqual([])
    expect(page.meta.status).toBe('live')
  })

  it('falls back to empty page when raw is not an object', () => {
    const page = unwrap(null, 'hip4')
    expect(page.data).toEqual([])
    expect(page.meta).toEqual({ family: 'hip4' })
  })
})

describe('unwrapSingle — apiResponse family', () => {
  it('returns the scalar data with mapped meta', () => {
    const raw = {
      success: true,
      data: { count: 42, timestamp: '2026-05-11T15:24:14.018991+00:00' },
      execution_time_ms: 9,
      total_count: null,
    }
    const single = unwrapSingle<{ count: number; timestamp: string }>(raw, 'apiResponse')
    expect(single.data).toEqual({ count: 42, timestamp: '2026-05-11T15:24:14.018991+00:00' })
    expect(single.meta).toEqual({
      family: 'apiResponse',
      executionMs: 9,
      totalCount: null,
    })
  })

  it('returns null data when payload is missing (no throw)', () => {
    const raw = { success: false, message: 'spot 500' }
    const single = unwrapSingle<{ count: number }>(raw, 'apiResponse')
    expect(single.data).toBeNull()
    expect(single.meta.message).toBe('spot 500')
  })

  it('returns null data when raw is not an object', () => {
    const single = unwrapSingle<unknown>(null, 'apiResponse')
    expect(single.data).toBeNull()
    expect(single.meta.family).toBe('apiResponse')
  })
})

describe('unwrapSingle — bare family', () => {
  it('returns raw scalar as data', () => {
    const raw = { coin: 'BTC', price: 75000 }
    const single = unwrapSingle<{ coin: string; price: number }>(raw, 'bare')
    expect(single.data).toEqual(raw)
    expect(single.meta).toEqual({ family: 'bare' })
  })

  it('passes through a primitive scalar', () => {
    const single = unwrapSingle<number>(7, 'bare')
    expect(single.data).toBe(7)
  })

  it('passes through null as data', () => {
    const single = unwrapSingle<null>(null, 'bare')
    expect(single.data).toBeNull()
  })
})

describe('unwrapSingle — hip4 family', () => {
  it('returns the data field with status/message/testnetDocs meta', () => {
    const raw = {
      status: 'live',
      data: { settled: 12, openMarkets: 4 },
      message: 'ok',
      testnet_docs: 'https://docs.example.com/hip4',
    }
    const single = unwrapSingle<{ settled: number; openMarkets: number }>(raw, 'hip4')
    expect(single.data).toEqual({ settled: 12, openMarkets: 4 })
    expect(single.meta).toEqual({
      family: 'hip4',
      status: 'live',
      message: 'ok',
      testnetDocs: 'https://docs.example.com/hip4',
    })
  })

  it('returns null data when raw is not an object', () => {
    const single = unwrapSingle<unknown>(undefined, 'hip4')
    expect(single.data).toBeNull()
    expect(single.meta).toEqual({ family: 'hip4' })
  })
})
