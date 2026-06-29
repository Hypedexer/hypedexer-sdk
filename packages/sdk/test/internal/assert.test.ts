import { describe, expect, it } from 'vitest'
import { ValidationError } from '../../src/errors/index.js'
import { assertEnum, assertLimit, assertOptionalEnum } from '../../src/internal/assert.js'

describe('assertEnum', () => {
  const allowed = ['asc', 'desc'] as const

  it('accepts an allowed value and narrows the type', () => {
    const v: unknown = 'asc'
    assertEnum(v, allowed, 'order')
    // Type-narrowing check: after the assertion `v` is `'asc' | 'desc'`.
    const narrowed: 'asc' | 'desc' = v
    expect(narrowed).toBe('asc')
  })

  it('rejects a non-allowed string with ValidationError and ctx.allowed', () => {
    try {
      assertEnum('sideways', allowed, 'order')
      throw new Error('should have thrown')
    } catch (err) {
      expect(err).toBeInstanceOf(ValidationError)
      const v = err as ValidationError
      expect(v.detail).toHaveLength(1)
      const d = v.detail[0] as NonNullable<(typeof v.detail)[number]>
      expect(d.loc).toEqual(['order'])
      expect(d.type).toBe('enum')
      expect(d.input).toBe('sideways')
      expect((d.ctx as { allowed: string[] }).allowed).toEqual(['asc', 'desc'])
      expect(v.field('order')).toBeDefined()
    }
  })

  it('rejects non-string values', () => {
    expect(() => assertEnum(42, allowed, 'order')).toThrow(ValidationError)
    expect(() => assertEnum(undefined, allowed, 'order')).toThrow(ValidationError)
    expect(() => assertEnum(null, allowed, 'order')).toThrow(ValidationError)
  })
})

describe('assertLimit', () => {
  it('accepts undefined (server default)', () => {
    expect(() => assertLimit(undefined, 1000)).not.toThrow()
  })

  it('accepts a value <= cap', () => {
    expect(() => assertLimit(500, 1000)).not.toThrow()
    expect(() => assertLimit(1000, 1000)).not.toThrow()
    expect(() => assertLimit(0, 1000)).not.toThrow()
  })

  it('rejects a value > cap with ctx.cap and default paramName', () => {
    try {
      assertLimit(5000, 1000)
      throw new Error('should have thrown')
    } catch (err) {
      expect(err).toBeInstanceOf(ValidationError)
      const v = err as ValidationError
      const d = v.detail[0] as NonNullable<(typeof v.detail)[number]>
      expect(d.loc).toEqual(['limit'])
      expect(d.type).toBe('limit')
      expect(d.input).toBe(5000)
      expect((d.ctx as { cap: number }).cap).toBe(1000)
    }
  })

  it('uses a custom paramName when provided', () => {
    try {
      assertLimit(101, 100, 'pageSize')
      throw new Error('should have thrown')
    } catch (err) {
      const v = err as ValidationError
      expect(v.detail[0]?.loc).toEqual(['pageSize'])
      expect(v.field('pageSize')).toBeDefined()
    }
  })

  it('rejects non-finite numbers', () => {
    expect(() => assertLimit(Number.POSITIVE_INFINITY, 1000)).toThrow(ValidationError)
    expect(() => assertLimit(Number.NaN, 1000)).toThrow(ValidationError)
  })
})

describe('assertOptionalEnum', () => {
  const allowed = ['B', 'A'] as const

  it('accepts undefined', () => {
    const v: unknown = undefined
    assertOptionalEnum(v, allowed, 'side')
    // Type-narrowing: `v` is `'B' | 'A' | undefined` after the assertion.
    const narrowed: 'B' | 'A' | undefined = v
    expect(narrowed).toBeUndefined()
  })

  it('accepts an allowed value and narrows the type', () => {
    const v: unknown = 'B'
    assertOptionalEnum(v, allowed, 'side')
    const narrowed: 'B' | 'A' | undefined = v
    expect(narrowed).toBe('B')
  })

  it('rejects a non-allowed value via the underlying assertEnum', () => {
    try {
      assertOptionalEnum('X', allowed, 'side')
      throw new Error('should have thrown')
    } catch (err) {
      expect(err).toBeInstanceOf(ValidationError)
      const v = err as ValidationError
      expect(v.detail[0]?.loc).toEqual(['side'])
      expect(v.detail[0]?.type).toBe('enum')
      expect((v.detail[0]?.ctx as { allowed: string[] }).allowed).toEqual(['B', 'A'])
    }
  })
})
