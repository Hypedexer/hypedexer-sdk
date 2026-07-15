/**
 * A 20-byte EVM account address as a hex string (e.g. `0x…`).
 */
export type Address = string
/**
 * An arbitrary hex-encoded string (e.g. a tx hash or block hash).
 */
export type Hex = string
/**
 * A market/coin symbol carried verbatim from the wire (perp, spot `@N`, hip3 `dex:coin`, hip4 `#N`).
 */
export type Coin = string

/**
 * An integer amount in base units (wei), branded to prevent mixing with plain strings.
 */
export type Wei = string & { readonly __brand: 'Wei' }

/**
 * Order side discriminator: `'B'` (bid/buy) or `'A'` (ask/sell).
 */
export type Side = 'B' | 'A'

/**
 * The response envelope family a resource payload was unwrapped from.
 *
 * @remarks
 * The three observed shapes are described in PLAN.md §B: `apiResponse`
 * ({@link APIResponse}), `bare` (the model itself), and `hip4`
 * ({@link Hip4Envelope}).
 */
export type EnvelopeFamily = 'apiResponse' | 'bare' | 'hip4'

/**
 * Envelope metadata attached to every {@link Page} and {@link Single}.
 *
 * @remarks
 * Fields are populated per family (see PLAN.md §B.3). `totalCount` is exposed
 * raw and is not authoritative on all endpoints (PLAN.md §B.4); `status` and
 * `testnetDocs` are hip4-only.
 */
export interface PageMeta {
  family: EnvelopeFamily
  message?: string
  executionMs?: number
  totalCount?: number | null
  nextCursor?: string | null
  hasMore?: boolean | null
  status?: 'live' | 'not_yet_live'
  testnetDocs?: string
}

/**
 * One page of results plus its {@link PageMeta} envelope metadata.
 *
 * @remarks
 * The list family described in PLAN.md §B.3. Resource `list()` methods return
 * this directly instead of the raw wire envelope.
 */
export interface Page<T> {
  data: T[]
  meta: PageMeta
}

/**
 * A single record plus its {@link PageMeta} envelope metadata.
 *
 * @remarks
 * The scalar counterpart of {@link Page}, returned by single-record methods
 * such as overview/count/details lookups (PLAN.md §B.3).
 */
export interface Single<T> {
  data: T
  meta: PageMeta
}

/**
 * The `apiResponse` wire envelope used by most REST endpoints.
 *
 * @remarks
 * Raw snake_case shape described in PLAN.md §B.1; the SDK unwraps it to
 * `data` and maps the remaining fields onto {@link PageMeta}.
 */
export interface APIResponse<T> {
  success: boolean
  data: T
  message?: string | null
  next_cursor?: string | null
  has_more?: boolean | null
  total_count?: number | null
  execution_time_ms?: number
}

/**
 * The `hip4` wire envelope used by all `/hip4/*` endpoints.
 *
 * @remarks
 * Raw shape described in PLAN.md §B.1. `status: 'not_yet_live'` signals a
 * gated feature and is materially different from an empty `data` array
 * (PLAN.md §B.3), so it is preserved on {@link PageMeta}.
 */
export interface Hip4Envelope<T> {
  status: 'live' | 'not_yet_live'
  count?: number
  data: T[]
  message?: string
  testnet_docs?: string
}
