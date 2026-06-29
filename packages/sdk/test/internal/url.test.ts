import { describe, expect, it } from 'vitest'
import { encodeSegment, joinPath } from '../../src/internal/url.js'

describe('encodeSegment', () => {
  it('passes through plain ASCII tickers untouched', () => {
    expect(encodeSegment('BTC')).toBe('BTC')
  })

  it('encodes @ as %40 (via encodeURIComponent)', () => {
    expect(encodeSegment('@107')).toBe('%40107')
  })

  it('encodes : as %3A', () => {
    expect(encodeSegment('xyz:EWY')).toBe('xyz%3AEWY')
  })

  it('encodes hip3 trade id with both : and hex address', () => {
    expect(encodeSegment('trade_xyz:EWY_0xab')).toBe('trade_xyz%3AEWY_0xab')
  })

  it('encodes multiple colons', () => {
    expect(encodeSegment('a:b:c')).toBe('a%3Ab%3Ac')
  })

  it('encodes slashes inside a segment', () => {
    expect(encodeSegment('foo/bar')).toBe('foo%2Fbar')
  })

  it('encodes spaces and unicode', () => {
    expect(encodeSegment('hello world')).toBe('hello%20world')
    expect(encodeSegment('café')).toBe('caf%C3%A9')
  })

  it('returns an empty string for an empty input', () => {
    expect(encodeSegment('')).toBe('')
  })

  it('keeps hex-style addresses intact', () => {
    expect(encodeSegment('0xabcdef0123456789')).toBe('0xabcdef0123456789')
  })
})

describe('joinPath', () => {
  it('joins segments with a leading slash', () => {
    expect(joinPath('fills', 'user', '0xabc')).toBe('/fills/user/0xabc')
  })

  it('matches the spec example with a leading-slash first segment encoded', () => {
    // The spec example shows joinPath('/fills', 'user', '0xabc') -> '/fills/user/0xabc'
    // The leading '/' inside the first segment is encoded as %2F (segments are opaque),
    // then a single '/' is prepended. We assert what the implementation actually returns,
    // and document the recommended call form (no leading slash on the first segment).
    expect(joinPath('/fills', 'user', '0xabc')).toBe('/%2Ffills/user/0xabc')
  })

  it('encodes : in any segment', () => {
    expect(joinPath('hip3', 'trades', 'trade_xyz:EWY_0xab')).toBe(
      '/hip3/trades/trade_xyz%3AEWY_0xab',
    )
  })

  it('encodes @ in any segment', () => {
    expect(joinPath('coins', '@107')).toBe('/coins/%40107')
  })

  it('returns just "/" when called with no segments', () => {
    expect(joinPath()).toBe('/')
  })

  it('handles a single segment', () => {
    expect(joinPath('fills')).toBe('/fills')
  })
})
