import { describe, expect, it } from 'vitest'
import { parseFundingRate, toBigInt, toNumber } from '../../src/transport/numbers.js'

describe('toBigInt', () => {
  it('round-trips zero from string and number', () => {
    expect(toBigInt('0')).toBe(0n)
    expect(toBigInt(0)).toBe(0n)
  })

  it('parses Wei-style integer strings', () => {
    expect(toBigInt('1000000000000000000')).toBe(1000000000000000000n)
  })

  it('parses negative integers from both shapes', () => {
    expect(toBigInt('-42')).toBe(-42n)
    expect(toBigInt(-42)).toBe(-42n)
  })

  it('parses very large positive integers beyond MAX_SAFE_INTEGER', () => {
    // 2^64 - 1, a representative Wei magnitude
    expect(toBigInt('18446744073709551615')).toBe(18446744073709551615n)
  })

  it('throws RangeError on empty string', () => {
    expect(() => toBigInt('')).toThrow(RangeError)
  })

  it('throws RangeError on non-numeric strings', () => {
    expect(() => toBigInt('abc')).toThrow(RangeError)
    expect(() => toBigInt('0x10')).toThrow(RangeError)
    expect(() => toBigInt(' 10')).toThrow(RangeError)
  })

  it('throws RangeError on decimal strings', () => {
    expect(() => toBigInt('1.5')).toThrow(RangeError)
    expect(() => toBigInt('0.0')).toThrow(RangeError)
  })

  it('throws RangeError on scientific notation', () => {
    expect(() => toBigInt('1e10')).toThrow(RangeError)
    expect(() => toBigInt('1E10')).toThrow(RangeError)
    expect(() => toBigInt('-2.5e3')).toThrow(RangeError)
  })

  it('throws RangeError on non-integer numbers', () => {
    expect(() => toBigInt(1.5)).toThrow(RangeError)
    expect(() => toBigInt(Number.NaN)).toThrow(RangeError)
    expect(() => toBigInt(Number.POSITIVE_INFINITY)).toThrow(RangeError)
  })
})

describe('toNumber', () => {
  it('returns zero from string and number', () => {
    expect(toNumber('0')).toBe(0)
    expect(toNumber(0)).toBe(0)
  })

  it('handles the MAX_SAFE_INTEGER boundary exactly', () => {
    expect(toNumber(String(Number.MAX_SAFE_INTEGER))).toBe(Number.MAX_SAFE_INTEGER)
    expect(toNumber(Number.MAX_SAFE_INTEGER)).toBe(Number.MAX_SAFE_INTEGER)
    expect(toNumber(String(-Number.MAX_SAFE_INTEGER))).toBe(-Number.MAX_SAFE_INTEGER)
  })

  it('throws on the precision-loss boundary (MAX_SAFE_INTEGER + 1) from string', () => {
    // 9007199254740992 === MAX_SAFE_INTEGER + 1, where IEEE-754 starts skipping
    expect(() => toNumber('9007199254740992')).toThrow(RangeError)
    expect(() => toNumber('-9007199254740992')).toThrow(RangeError)
  })

  it('throws on the precision-loss boundary from number input', () => {
    expect(() => toNumber(Number.MAX_SAFE_INTEGER + 1)).toThrow(RangeError)
  })

  it('parses decimal strings via Number()', () => {
    expect(toNumber('1.5')).toBe(1.5)
    expect(toNumber('-0.25')).toBe(-0.25)
  })

  it('throws on empty / non-numeric / scientific strings', () => {
    expect(() => toNumber('')).toThrow(RangeError)
    expect(() => toNumber('abc')).toThrow(RangeError)
    expect(() => toNumber('1e3')).toThrow(RangeError)
  })

  it('throws on non-finite number inputs', () => {
    expect(() => toNumber(Number.NaN)).toThrow(RangeError)
    expect(() => toNumber(Number.POSITIVE_INFINITY)).toThrow(RangeError)
    expect(() => toNumber(Number.NEGATIVE_INFINITY)).toThrow(RangeError)
  })
})

describe('parseFundingRate', () => {
  it('parses a negative funding rate', () => {
    expect(parseFundingRate('-0.0000101097')).toBeCloseTo(-0.0000101097, 12)
  })

  it('parses a positive funding rate', () => {
    expect(parseFundingRate('0.0000125')).toBeCloseTo(0.0000125, 12)
  })

  it('parses zero', () => {
    expect(parseFundingRate('0')).toBe(0)
    expect(parseFundingRate('0.0')).toBe(0)
  })

  it('throws on empty string', () => {
    expect(() => parseFundingRate('')).toThrow(RangeError)
  })

  it('throws on non-numeric input', () => {
    expect(() => parseFundingRate('abc')).toThrow(RangeError)
    expect(() => parseFundingRate('-')).toThrow(RangeError)
  })

  it('throws on scientific notation', () => {
    expect(() => parseFundingRate('1e-5')).toThrow(RangeError)
  })
})
