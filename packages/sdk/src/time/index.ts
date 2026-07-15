/**
 * Selects how {@link parseTimestamp} decodes an incoming timestamp value.
 *
 * @remarks
 * One mode per upstream encoding (PLAN.md §E): `'iso'` for ISO strings
 * (naive strings are treated as UTC), `'epochMs'` for epoch milliseconds,
 * `'date'` for bare `YYYY-MM-DD`, and `'hip4Expiry'` for the HIP-4 compact
 * `YYYYMMDD-HHMM` form.
 */
export type TimestampMode = 'iso' | 'epochMs' | 'date' | 'hip4Expiry'

/**
 * Any value {@link encodeTime} accepts: a `Date`, epoch milliseconds as a
 * number, or a string (ISO or numeric).
 */
export type TimeInput = Date | number | string

/**
 * Selects the wire form {@link encodeTime} produces: `'isoSnake'` and
 * `'isoBare'` yield ISO strings (full timestamp and `YYYY-MM-DD` date-only
 * respectively), while `'epochCamel'` yields epoch milliseconds as a number.
 */
export type TimeEncodeTarget = 'isoSnake' | 'epochCamel' | 'isoBare'

const ISO_SENTINEL = '1970-01-01T00:00:00'

function ensureUtc(iso: string): string {
  return /[zZ]|[+-]\d{2}:?\d{2}$/.test(iso) ? iso : `${iso}Z`
}

/**
 * Decode a raw upstream timestamp into a `Date`, or `null` when it is absent
 * or a sentinel.
 *
 * @remarks
 * `null`, `undefined`, empty strings, epoch `0`, and the `1970-01-01T00:00:00`
 * sentinel all decode to `null` (PLAN.md §E.2). Naive ISO strings (no zone)
 * are interpreted as UTC. Invalid inputs return `null` rather than throwing.
 *
 * @param value - The raw value; a string, number, `null`, or `undefined`.
 * @param mode - How to interpret `value`; see {@link TimestampMode}.
 * @returns The decoded `Date`, or `null` for missing/sentinel/invalid input.
 *
 * @example
 * ```ts
 * parseTimestamp('2026-05-12T06:00:00', 'iso')   // Date (UTC)
 * parseTimestamp(0, 'epochMs')                    // null (sentinel)
 * parseTimestamp('20260512-0600', 'hip4Expiry')   // Date
 * ```
 */
export function parseTimestamp(
  value: string | number | null | undefined,
  mode: TimestampMode,
): Date | null {
  if (value === null || value === undefined) return null

  if (mode === 'epochMs') {
    const n = typeof value === 'number' ? value : Number(value)
    if (!Number.isFinite(n) || n === 0) return null
    return new Date(n)
  }

  if (mode === 'hip4Expiry') {
    return parseHip4Expiry(String(value))
  }

  if (mode === 'date') {
    const s = String(value)
    if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null
    return new Date(`${s}T00:00:00Z`)
  }

  // mode === 'iso'
  const s = String(value)
  if (s === '' || s === ISO_SENTINEL) return null
  const d = new Date(ensureUtc(s))
  return Number.isNaN(d.getTime()) ? null : d
}

/**
 * Parse the HIP-4 compact expiry format `YYYYMMDD-HHMM` into a UTC `Date`.
 *
 * @remarks
 * Dedicated parser for encoding format #8 (PLAN.md §E). Returns `null` when
 * the string does not match the exact pattern or the components form an
 * invalid date.
 *
 * @param s - The compact expiry string, e.g. `'20260512-0600'`.
 * @returns The decoded UTC `Date`, or `null` when `s` is malformed.
 *
 * @example
 * ```ts
 * parseHip4Expiry('20260512-0600') // 2026-05-12T06:00:00Z
 * parseHip4Expiry('not-a-date')    // null
 * ```
 */
export function parseHip4Expiry(s: string): Date | null {
  const m = /^(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})$/.exec(s)
  if (!m) return null
  const [, y, mo, d, h, mi] = m
  const iso = `${y}-${mo}-${d}T${h}:${mi}:00Z`
  const date = new Date(iso)
  return Number.isNaN(date.getTime()) ? null : date
}

function toEpochMs(input: TimeInput): number {
  if (input instanceof Date) return input.getTime()
  if (typeof input === 'number') return input
  const n = Number(input)
  if (Number.isFinite(n) && String(n) === input.trim()) return n
  const d = new Date(ensureUtc(input))
  if (Number.isNaN(d.getTime())) throw new RangeError(`invalid time input: ${input}`)
  return d.getTime()
}

/**
 * Encode a time value into a wire form for use as a request parameter.
 *
 * @remarks
 * Normalizes the input to epoch milliseconds first. Naive ISO strings are
 * treated as UTC. Purely numeric strings are read as epoch milliseconds.
 *
 * @param value - A `Date`, epoch milliseconds, or a string; see
 *   {@link TimeInput}.
 * @param target - The desired wire form; see {@link TimeEncodeTarget}.
 * @returns A number for `'epochCamel'`, otherwise an ISO string (full for
 *   `'isoSnake'`, `YYYY-MM-DD` for `'isoBare'`).
 * @throws `RangeError` when a string input cannot be parsed to a valid time.
 *
 * @example
 * ```ts
 * encodeTime(new Date('2026-05-12T06:00:00Z'), 'epochCamel') // 1778...000
 * encodeTime('2026-05-12T06:00:00Z', 'isoBare')              // '2026-05-12'
 * ```
 */
export function encodeTime(value: TimeInput, target: TimeEncodeTarget): string | number {
  const ms = toEpochMs(value)
  if (target === 'epochCamel') return ms
  if (target === 'isoBare') return new Date(ms).toISOString().slice(0, 10)
  return new Date(ms).toISOString()
}
