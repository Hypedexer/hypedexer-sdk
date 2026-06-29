import { ValidationError } from '../errors/index.js'

/**
 * Asserts that `value` is one of the allowed string literals.
 * Throws ValidationError with `type: 'enum'` and `ctx.allowed` listing the
 * permitted values, pointed at `paramName`.
 */
export function assertEnum<T extends string>(
  value: unknown,
  allowed: readonly T[],
  paramName: string,
): asserts value is T {
  if (typeof value !== 'string' || !(allowed as readonly string[]).includes(value)) {
    throw new ValidationError(`invalid value for "${paramName}"`, [
      {
        msg: `value must be one of: ${allowed.join(', ')}`,
        loc: [paramName],
        type: 'enum',
        input: value,
        ctx: { allowed: [...allowed] },
      },
    ])
  }
}

/**
 * Asserts that an optional numeric `limit` does not exceed `cap`. Pass
 * `undefined` to defer to the server's default. Throws ValidationError with
 * `type: 'limit'` and `ctx.cap` when the cap is exceeded.
 */
export function assertLimit(limit: number | undefined, cap: number, paramName = 'limit'): void {
  if (limit === undefined) return
  if (typeof limit !== 'number' || !Number.isFinite(limit) || limit > cap) {
    throw new ValidationError(`"${paramName}" exceeds cap`, [
      {
        msg: `value must be <= ${cap}`,
        loc: [paramName],
        type: 'limit',
        input: limit,
        ctx: { cap },
      },
    ])
  }
}

/**
 * Like {@link assertEnum} but accepts `undefined` as a valid value (caller
 * intends to defer to the server / a downstream default).
 */
export function assertOptionalEnum<T extends string>(
  value: unknown,
  allowed: readonly T[],
  paramName: string,
): asserts value is T | undefined {
  if (value === undefined) return
  assertEnum(value, allowed, paramName)
}
