import { ValidationError } from '../errors/index.js'
import type { Address } from '../types/common.js'

/**
 * Regular expression matching a checksum-agnostic ETH-style address:
 * 0x-prefixed, exactly 40 hexadecimal characters.
 */
export const ADDRESS_REGEX = /^0x[0-9a-fA-F]{40}$/

/**
 * Type guard for ETH-style addresses. Returns true if `value` is a string
 * matching {@link ADDRESS_REGEX}.
 */
export function isValidAddress(value: unknown): value is Address {
  return typeof value === 'string' && ADDRESS_REGEX.test(value)
}

/**
 * Validates and returns the lowercased form of an ETH-style address.
 * Throws ValidationError if the input is not a valid address string.
 */
export function normalizeAddress(value: string): Address {
  if (typeof value !== 'string' || !ADDRESS_REGEX.test(value)) {
    throw new ValidationError('invalid address', [
      {
        msg: 'value is not a valid 0x-prefixed 20-byte hex address',
        loc: ['address'],
        type: 'sdk_validation',
        input: value,
      },
    ])
  }
  return value.toLowerCase() as Address
}

/**
 * Assertion helper for ETH-style addresses. Throws ValidationError pointing
 * at `paramName` when `value` is not a valid address.
 */
export function assertAddress(value: unknown, paramName: string): asserts value is Address {
  if (!isValidAddress(value)) {
    throw new ValidationError(`invalid address for "${paramName}"`, [
      {
        msg: 'value is not a valid 0x-prefixed 20-byte hex address',
        loc: [paramName],
        type: 'sdk_validation',
        input: value,
      },
    ])
  }
}
