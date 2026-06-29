import type { EnvelopeFamily, Page, PageMeta, Single } from '../types/common.js'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function toNumberArray<T>(value: unknown): T[] {
  if (Array.isArray(value)) return value as T[]
  return []
}

function fillApiResponseMeta(raw: Record<string, unknown>, meta: PageMeta): void {
  if (typeof raw['message'] === 'string') meta.message = raw['message']
  if (typeof raw['execution_time_ms'] === 'number') meta.executionMs = raw['execution_time_ms']

  // total_count is never coerced — pass through as number | null when present
  if ('total_count' in raw) {
    const tc = raw['total_count']
    if (tc === null) meta.totalCount = null
    else if (typeof tc === 'number') meta.totalCount = tc
  }

  if ('next_cursor' in raw) {
    const nc = raw['next_cursor']
    if (nc === null) meta.nextCursor = null
    else if (typeof nc === 'string') meta.nextCursor = nc
  }

  if ('has_more' in raw) {
    const hm = raw['has_more']
    if (hm === null) meta.hasMore = null
    else if (typeof hm === 'boolean') meta.hasMore = hm
  }
}

function fillHip4Meta(raw: Record<string, unknown>, meta: PageMeta): void {
  if (raw['status'] === 'live' || raw['status'] === 'not_yet_live') {
    meta.status = raw['status']
  }
  if (typeof raw['message'] === 'string') meta.message = raw['message']
  if (typeof raw['testnet_docs'] === 'string') meta.testnetDocs = raw['testnet_docs']
}

/**
 * Unwrap a list-style response according to its envelope family.
 *
 * Behaviour per family:
 * - `apiResponse`: maps `next_cursor`/`has_more`/`total_count`/`execution_time_ms`/`message`
 *   onto `meta`. `total_count` is passed through raw (`number | null`), never coerced.
 *   If `data` is missing/null, returns an empty array — observed in batch-9 spot 500s.
 * - `bare`: `raw` IS the value. Expected to be an array; null/undefined become `[]`.
 * - `hip4`: `raw` is a {@link Hip4Envelope}. `meta.status`, `meta.message` and
 *   `meta.testnetDocs` are preserved (notably when `status === 'not_yet_live'`).
 */
export function unwrap<T>(raw: unknown, family: EnvelopeFamily): Page<T> {
  if (family === 'bare') {
    const meta: PageMeta = { family: 'bare' }
    if (raw == null) return { data: [], meta }
    return { data: toNumberArray<T>(raw), meta }
  }

  if (family === 'hip4') {
    const meta: PageMeta = { family: 'hip4' }
    if (!isRecord(raw)) return { data: [], meta }
    fillHip4Meta(raw, meta)
    const data = toNumberArray<T>(raw['data'])
    return { data, meta }
  }

  // apiResponse
  const meta: PageMeta = { family: 'apiResponse' }
  if (!isRecord(raw)) return { data: [], meta }
  fillApiResponseMeta(raw, meta)
  const payload = raw['data']
  if (payload == null) return { data: [], meta }
  return { data: toNumberArray<T>(payload), meta }
}

/**
 * Unwrap a single-record response according to its envelope family.
 *
 * Behaviour mirrors {@link unwrap}, but `data` is the scalar payload (not an array).
 * If the underlying payload is missing/null the SDK returns `data: null` (typed as `T`)
 * rather than throwing — several apiResponse endpoints have been observed to drop `data`
 * on partial failures (batch-9 spot 500s).
 */
export function unwrapSingle<T>(raw: unknown, family: EnvelopeFamily): Single<T> {
  if (family === 'bare') {
    const meta: PageMeta = { family: 'bare' }
    return { data: raw as T, meta }
  }

  if (family === 'hip4') {
    const meta: PageMeta = { family: 'hip4' }
    if (!isRecord(raw)) return { data: null as T, meta }
    fillHip4Meta(raw, meta)
    return { data: raw['data'] as T, meta }
  }

  // apiResponse
  const meta: PageMeta = { family: 'apiResponse' }
  if (!isRecord(raw)) return { data: null as T, meta }
  fillApiResponseMeta(raw, meta)
  const payload = raw['data']
  if (payload == null) return { data: null as T, meta }
  return { data: payload as T, meta }
}
