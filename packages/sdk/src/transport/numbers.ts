/**
 * Numeric helpers — per PLAN.md §F.
 *
 * The Hypedexer API encodes most numerics as JS-safe `number`s but a few
 * fields are intentionally strings:
 *   - `value_wei` (EVM transactions) and `amount_raw` (EVM ledger) — bigint-class.
 *   - `fundingRate` / `premium` on funding endpoints — preserve precision.
 *
 * This module exposes three helpers used at the resource boundary:
 *   - `toBigInt(value)`  — parse an integer (Wei string, plain int string, or
 *     integer number) into `bigint`. Strict: rejects empty input, decimals,
 *     scientific notation, and non-numeric strings.
 *   - `toNumber(value)`  — convert an integer string or number into `number`,
 *     throwing if the value would lose precision (abs > MAX_SAFE_INTEGER).
 *     Also accepts decimal strings (precision is the caller's problem there).
 *   - `parseFundingRate(s)` — parse a Hyperliquid decimal funding rate
 *     (e.g. `-0.0000101097`) to `number`. v0.1 returns `number`; a future
 *     `mode: 'bigDecimal'` flag is reserved for v0.2.
 */

const INTEGER_LITERAL = /^-?\d+$/
const DECIMAL_LITERAL = /^-?(?:\d+(?:\.\d+)?|\.\d+)$/

const MAX_SAFE_BIGINT = BigInt(Number.MAX_SAFE_INTEGER)
const MIN_SAFE_BIGINT = -MAX_SAFE_BIGINT

function rejectsScientificNotation(value: string): boolean {
  return /[eE]/.test(value)
}

/**
 * Parse an integer value into `bigint`.
 *
 * Accepts:
 *   - Wei-style integer strings (`"1000000000000000000"`)
 *   - Plain integer strings (`"0"`, `"-42"`)
 *   - Integer `number`s (`0`, `-42`)
 *
 * Throws `RangeError` for:
 *   - Empty strings
 *   - Non-numeric strings
 *   - Decimal strings (`"1.5"`)
 *   - Scientific notation (`"1e10"`)
 *   - Non-integer `number`s (`1.5`, `NaN`, `Infinity`)
 */
export function toBigInt(value: string | number): bigint {
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new RangeError(`toBigInt: non-finite number ${value}`)
    }
    if (!Number.isInteger(value)) {
      throw new RangeError(`toBigInt: expected an integer, got ${value}`)
    }
    return BigInt(value)
  }
  if (typeof value === 'string') {
    if (value.length === 0) {
      throw new RangeError('toBigInt: empty string')
    }
    if (rejectsScientificNotation(value)) {
      throw new RangeError(`toBigInt: scientific notation is not accepted: "${value}"`)
    }
    if (!INTEGER_LITERAL.test(value)) {
      throw new RangeError(`toBigInt: not an integer literal: "${value}"`)
    }
    return BigInt(value)
  }
  throw new RangeError(`toBigInt: unsupported input type ${typeof value}`)
}

/**
 * Convert a numeric value to `number`, refusing silent precision loss for
 * integer-shaped inputs.
 *
 * Accepts:
 *   - Plain integer strings; throws if abs > MAX_SAFE_INTEGER.
 *   - Decimal strings (e.g. `"1.5"`); returned via `Number(value)`.
 *   - `number`s; throws if non-finite or abs > MAX_SAFE_INTEGER.
 *
 * Rejects empty / non-numeric / scientific-notation strings with `RangeError`.
 */
export function toNumber(value: string | number): number {
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new RangeError(`toNumber: non-finite number ${value}`)
    }
    if (Math.abs(value) > Number.MAX_SAFE_INTEGER) {
      throw new RangeError(`toNumber: precision loss for ${value}`)
    }
    return value
  }
  if (typeof value === 'string') {
    if (value.length === 0) {
      throw new RangeError('toNumber: empty string')
    }
    if (rejectsScientificNotation(value)) {
      throw new RangeError(`toNumber: scientific notation is not accepted: "${value}"`)
    }
    if (INTEGER_LITERAL.test(value)) {
      const big = BigInt(value)
      if (big > MAX_SAFE_BIGINT || big < MIN_SAFE_BIGINT) {
        throw new RangeError(`toNumber: precision loss for "${value}"`)
      }
      return Number(big)
    }
    if (!DECIMAL_LITERAL.test(value)) {
      throw new RangeError(`toNumber: not a numeric literal: "${value}"`)
    }
    const n = Number(value)
    if (!Number.isFinite(n)) {
      throw new RangeError(`toNumber: produced non-finite from "${value}"`)
    }
    return n
  }
  throw new RangeError(`toNumber: unsupported input type ${typeof value}`)
}

/**
 * Parse a Hyperliquid funding rate string (e.g. `-0.0000101097`) to `number`.
 *
 * Throws `RangeError` on empty, non-numeric, or scientific-notation input.
 * v0.1 only — a future `mode: 'bigDecimal'` is reserved (PLAN §F.2).
 */
export function parseFundingRate(s: string): number {
  if (typeof s !== 'string') {
    throw new RangeError(`parseFundingRate: expected string, got ${typeof s}`)
  }
  if (s.length === 0) {
    throw new RangeError('parseFundingRate: empty string')
  }
  if (rejectsScientificNotation(s)) {
    throw new RangeError(`parseFundingRate: scientific notation is not accepted: "${s}"`)
  }
  if (!DECIMAL_LITERAL.test(s)) {
    throw new RangeError(`parseFundingRate: not a numeric literal: "${s}"`)
  }
  const n = Number(s)
  if (!Number.isFinite(n)) {
    throw new RangeError(`parseFundingRate: produced non-finite from "${s}"`)
  }
  return n
}
