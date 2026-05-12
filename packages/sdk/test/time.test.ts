import { describe, expect, it } from 'vitest'
import { encodeTime, parseHip4Expiry, parseTimestamp } from '../src/time/index.js'

describe('parseTimestamp', () => {
  it('parses naive ISO with microseconds as UTC', () => {
    const d = parseTimestamp('2026-05-11T15:22:49.398000', 'iso')
    expect(d).not.toBeNull()
    expect(d?.toISOString()).toBe('2026-05-11T15:22:49.398Z')
  })

  it('parses naive ISO without microseconds as UTC', () => {
    const d = parseTimestamp('2026-05-11T15:46:11', 'iso')
    expect(d?.toISOString()).toBe('2026-05-11T15:46:11.000Z')
  })

  it('respects explicit Z suffix', () => {
    const d = parseTimestamp('2026-05-11T14:40:32Z', 'iso')
    expect(d?.toISOString()).toBe('2026-05-11T14:40:32.000Z')
  })

  it('respects +00:00 suffix', () => {
    const d = parseTimestamp('2026-05-11T15:24:14.018991+00:00', 'iso')
    expect(d?.getUTCFullYear()).toBe(2026)
  })

  it('maps the 1970 sentinel to null', () => {
    expect(parseTimestamp('1970-01-01T00:00:00', 'iso')).toBeNull()
  })

  it('returns null for null/undefined/empty', () => {
    expect(parseTimestamp(null, 'iso')).toBeNull()
    expect(parseTimestamp(undefined, 'iso')).toBeNull()
    expect(parseTimestamp('', 'iso')).toBeNull()
  })

  it('parses epoch ms numbers', () => {
    const d = parseTimestamp(1778521680500, 'epochMs')
    expect(d?.getTime()).toBe(1778521680500)
  })

  it('maps epoch 0 to null', () => {
    expect(parseTimestamp(0, 'epochMs')).toBeNull()
  })

  it('parses YYYY-MM-DD as UTC midnight', () => {
    const d = parseTimestamp('2026-05-02', 'date')
    expect(d?.toISOString()).toBe('2026-05-02T00:00:00.000Z')
  })

  it('rejects malformed date-only input', () => {
    expect(parseTimestamp('not-a-date', 'date')).toBeNull()
  })

  it('dispatches hip4 expiry', () => {
    const d = parseTimestamp('20260512-0600', 'hip4Expiry')
    expect(d?.toISOString()).toBe('2026-05-12T06:00:00.000Z')
  })
})

describe('parseHip4Expiry', () => {
  it('parses the compact format', () => {
    expect(parseHip4Expiry('20260512-0600')?.toISOString()).toBe('2026-05-12T06:00:00.000Z')
  })

  it('returns null for malformed input', () => {
    expect(parseHip4Expiry('garbage')).toBeNull()
  })
})

describe('encodeTime', () => {
  it('encodes Date to ISO snake (default)', () => {
    const out = encodeTime(new Date('2026-01-01T00:00:00Z'), 'isoSnake')
    expect(out).toBe('2026-01-01T00:00:00.000Z')
  })

  it('encodes number to epoch ms', () => {
    expect(encodeTime(1700000000000, 'epochCamel')).toBe(1700000000000)
  })

  it('encodes string ISO to epoch ms', () => {
    expect(encodeTime('2026-01-01T00:00:00Z', 'epochCamel')).toBe(
      new Date('2026-01-01T00:00:00Z').getTime(),
    )
  })

  it('encodes to date-only', () => {
    expect(encodeTime(new Date('2026-05-02T15:30:00Z'), 'isoBare')).toBe('2026-05-02')
  })

  it('throws on invalid string', () => {
    expect(() => encodeTime('not a time', 'isoSnake')).toThrow(RangeError)
  })
})
