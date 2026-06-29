import { describe, expect, it } from 'vitest'
import { type ParsedCoin, formatCoin, parseCoin } from '../../src/transport/coin.js'

describe('parseCoin — PLAN.md §G.1 examples', () => {
  it('parses a bare perp ticker', () => {
    expect(parseCoin('BTC')).toEqual({ kind: 'perp', ticker: 'BTC' })
  })

  it('parses an @-prefixed spot index', () => {
    expect(parseCoin('@107')).toEqual({ kind: 'spot', index: 107 })
  })

  it('parses a hip3 dex:ticker (xyz dex)', () => {
    expect(parseCoin('xyz:EWY')).toEqual({ kind: 'hip3', dex: 'xyz', ticker: 'EWY' })
  })

  it('parses a hip3 dex:ticker (cash dex)', () => {
    expect(parseCoin('cash:MSFT')).toEqual({ kind: 'hip3', dex: 'cash', ticker: 'MSFT' })
  })

  it('parses a hip3 dex:ticker (km dex, ticker collides with perp namespace)', () => {
    expect(parseCoin('km:BTC')).toEqual({ kind: 'hip3', dex: 'km', ticker: 'BTC' })
  })

  it('parses a #-prefixed hip4 outcome id', () => {
    expect(parseCoin('#290')).toEqual({ kind: 'hip4-outcome', outcomeId: 290 })
  })

  it('parses a +-prefixed hip4 outcome-fee token', () => {
    expect(parseCoin('+290')).toEqual({ kind: 'hip4-outcome-fee', outcomeId: 290 })
  })

  it('parses an empty string as the hip4 fallback outcome', () => {
    expect(parseCoin('')).toEqual({ kind: 'hip4-fallback' })
  })
})

describe('parseCoin — invalid / unknown forms', () => {
  it('falls to unknown when @ is followed by non-digits', () => {
    expect(parseCoin('@abc')).toEqual({ kind: 'unknown', raw: '@abc' })
  })

  it('falls to unknown when # is followed by a signed number', () => {
    expect(parseCoin('#-1')).toEqual({ kind: 'unknown', raw: '#-1' })
  })

  it('falls to unknown when + is followed by non-digits', () => {
    expect(parseCoin('+abc')).toEqual({ kind: 'unknown', raw: '+abc' })
  })

  it('falls to unknown when @ is a bare prefix', () => {
    expect(parseCoin('@')).toEqual({ kind: 'unknown', raw: '@' })
  })

  it('falls to unknown when hip3 has an empty dex', () => {
    expect(parseCoin(':EWY')).toEqual({ kind: 'unknown', raw: ':EWY' })
  })

  it('falls to unknown when hip3 has an empty ticker', () => {
    expect(parseCoin('xyz:')).toEqual({ kind: 'unknown', raw: 'xyz:' })
  })

  it('falls to unknown for a lowercase bare token (not perp shape)', () => {
    expect(parseCoin('btc')).toEqual({ kind: 'unknown', raw: 'btc' })
  })
})

describe('formatCoin — inverse of parseCoin', () => {
  it('formats a perp ticker', () => {
    expect(formatCoin({ kind: 'perp', ticker: 'BTC' })).toBe('BTC')
  })

  it('formats a spot index', () => {
    expect(formatCoin({ kind: 'spot', index: 107 })).toBe('@107')
  })

  it('formats a hip3 dex:ticker', () => {
    expect(formatCoin({ kind: 'hip3', dex: 'xyz', ticker: 'EWY' })).toBe('xyz:EWY')
  })

  it('formats a hip4 outcome id', () => {
    expect(formatCoin({ kind: 'hip4-outcome', outcomeId: 290 })).toBe('#290')
  })

  it('formats a hip4 outcome-fee token', () => {
    expect(formatCoin({ kind: 'hip4-outcome-fee', outcomeId: 290 })).toBe('+290')
  })

  it('formats the hip4 fallback outcome as empty string', () => {
    expect(formatCoin({ kind: 'hip4-fallback' })).toBe('')
  })

  it('formats an unknown coin by emitting its raw form', () => {
    expect(formatCoin({ kind: 'unknown', raw: '???weird' })).toBe('???weird')
  })
})

describe('parseCoin / formatCoin round-trip', () => {
  const samples = ['BTC', 'ETH', '@107', '@0', 'xyz:EWY', 'cash:MSFT', 'km:BTC', '#290', '+290', '']

  for (const s of samples) {
    it(`round-trips ${JSON.stringify(s)}`, () => {
      const parsed: ParsedCoin = parseCoin(s)
      expect(formatCoin(parsed)).toBe(s)
    })
  }
})
