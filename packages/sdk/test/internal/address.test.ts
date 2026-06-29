import { describe, expect, it } from 'vitest'
import { ValidationError } from '../../src/errors/index.js'
import {
  ADDRESS_REGEX,
  assertAddress,
  isValidAddress,
  normalizeAddress,
} from '../../src/internal/address.js'

const CHECKSUM_ADDR = '0x5aA3B5b8b3fC5C538b3aEe6E2a8d6fAa6F0f3F11'
const LOWER_ADDR = '0x5aa3b5b8b3fc5c538b3aee6e2a8d6faa6f0f3f11'
const UPPER_ADDR = '0x5AA3B5B8B3FC5C538B3AEE6E2A8D6FAA6F0F3F11'
const TOO_SHORT = '0x5aA3B5b8b3fC5C538b3aEe6E2a8d6fAa6F0f3F1'
const TOO_LONG = '0x5aA3B5b8b3fC5C538b3aEe6E2a8d6fAa6F0f3F111'
const NO_PREFIX = '5aA3B5b8b3fC5C538b3aEe6E2a8d6fAa6F0f3F11'
const NON_HEX = '0x5aA3B5b8b3fC5C538b3aEe6E2a8d6fAa6F0f3Fzz'

describe('ADDRESS_REGEX', () => {
  it('matches valid mixed-case (checksum) addresses', () => {
    expect(ADDRESS_REGEX.test(CHECKSUM_ADDR)).toBe(true)
  })

  it('matches all-lowercase addresses', () => {
    expect(ADDRESS_REGEX.test(LOWER_ADDR)).toBe(true)
  })

  it('matches all-uppercase hex addresses', () => {
    expect(ADDRESS_REGEX.test(UPPER_ADDR)).toBe(true)
  })

  it('rejects wrong-length addresses', () => {
    expect(ADDRESS_REGEX.test(TOO_SHORT)).toBe(false)
    expect(ADDRESS_REGEX.test(TOO_LONG)).toBe(false)
  })

  it('rejects missing 0x prefix', () => {
    expect(ADDRESS_REGEX.test(NO_PREFIX)).toBe(false)
  })

  it('rejects non-hex characters', () => {
    expect(ADDRESS_REGEX.test(NON_HEX)).toBe(false)
  })
})

describe('isValidAddress', () => {
  it('returns true for a checksum address', () => {
    expect(isValidAddress(CHECKSUM_ADDR)).toBe(true)
  })

  it('returns true for a lowercase address', () => {
    expect(isValidAddress(LOWER_ADDR)).toBe(true)
  })

  it('returns false for wrong length', () => {
    expect(isValidAddress(TOO_SHORT)).toBe(false)
    expect(isValidAddress(TOO_LONG)).toBe(false)
  })

  it('returns false for missing 0x', () => {
    expect(isValidAddress(NO_PREFIX)).toBe(false)
  })

  it('returns false for non-hex', () => {
    expect(isValidAddress(NON_HEX)).toBe(false)
  })

  it('returns false for non-string types', () => {
    expect(isValidAddress(undefined)).toBe(false)
    expect(isValidAddress(null)).toBe(false)
    expect(isValidAddress(42)).toBe(false)
    expect(isValidAddress({})).toBe(false)
    expect(isValidAddress([CHECKSUM_ADDR])).toBe(false)
  })
})

describe('normalizeAddress', () => {
  it('returns the lowercased form of a checksum address', () => {
    expect(normalizeAddress(CHECKSUM_ADDR)).toBe(LOWER_ADDR)
  })

  it('returns the lowercased form of an uppercase address', () => {
    expect(normalizeAddress(UPPER_ADDR)).toBe(LOWER_ADDR)
  })

  it('returns lowercase input untouched', () => {
    expect(normalizeAddress(LOWER_ADDR)).toBe(LOWER_ADDR)
  })

  it('throws ValidationError for wrong-length input', () => {
    expect(() => normalizeAddress(TOO_SHORT)).toThrow(ValidationError)
    expect(() => normalizeAddress(TOO_LONG)).toThrow(ValidationError)
  })

  it('throws ValidationError for missing 0x prefix', () => {
    expect(() => normalizeAddress(NO_PREFIX)).toThrow(ValidationError)
  })

  it('throws ValidationError with sdk_validation detail for non-hex input', () => {
    try {
      normalizeAddress(NON_HEX)
      expect.fail('should have thrown')
    } catch (err) {
      expect(err).toBeInstanceOf(ValidationError)
      const v = err as ValidationError
      expect(v.detail[0]?.type).toBe('sdk_validation')
      expect(v.detail[0]?.loc).toEqual(['address'])
    }
  })

  it('throws ValidationError when called with non-string (runtime guard)', () => {
    // Cast away types to simulate a JS caller passing the wrong type.
    expect(() => normalizeAddress(undefined as unknown as string)).toThrow(ValidationError)
    expect(() => normalizeAddress(null as unknown as string)).toThrow(ValidationError)
    expect(() => normalizeAddress(123 as unknown as string)).toThrow(ValidationError)
  })
})

describe('assertAddress', () => {
  it('does not throw on valid input', () => {
    expect(() => assertAddress(CHECKSUM_ADDR, 'user')).not.toThrow()
    expect(() => assertAddress(LOWER_ADDR, 'user')).not.toThrow()
  })

  it('narrows the type after asserting (compile-time, smoke-check at runtime)', () => {
    const v: unknown = CHECKSUM_ADDR
    assertAddress(v, 'user')
    // After the assertion, v is typed as Address. Use it as a string.
    expect(v.startsWith('0x')).toBe(true)
  })

  it('throws ValidationError with paramName in loc for wrong length', () => {
    try {
      assertAddress(TOO_SHORT, 'user')
      expect.fail('should have thrown')
    } catch (err) {
      expect(err).toBeInstanceOf(ValidationError)
      const v = err as ValidationError
      expect(v.detail[0]?.loc).toEqual(['user'])
      expect(v.detail[0]?.type).toBe('sdk_validation')
      expect(v.field('user')).toBeDefined()
    }
  })

  it('throws ValidationError for missing 0x', () => {
    expect(() => assertAddress(NO_PREFIX, 'addr')).toThrow(ValidationError)
  })

  it('throws ValidationError for non-hex', () => {
    expect(() => assertAddress(NON_HEX, 'addr')).toThrow(ValidationError)
  })

  it('throws ValidationError for non-string types', () => {
    expect(() => assertAddress(undefined, 'addr')).toThrow(ValidationError)
    expect(() => assertAddress(null, 'addr')).toThrow(ValidationError)
    expect(() => assertAddress(42, 'addr')).toThrow(ValidationError)
    expect(() => assertAddress({}, 'addr')).toThrow(ValidationError)
  })

  it('includes the failing input in the detail entry', () => {
    try {
      assertAddress(42, 'user')
      expect.fail('should have thrown')
    } catch (err) {
      const v = err as ValidationError
      expect(v.detail[0]?.input).toBe(42)
    }
  })
})
