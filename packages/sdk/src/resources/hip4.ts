import { assertAddress } from '../internal/address.js'
import { assertLimit, assertOptionalEnum } from '../internal/assert.js'
import { iterate } from '../pagination/iterator.js'
import { encodeTime } from '../time/index.js'
import type { HttpClient } from '../transport/HttpClient.js'
import { unwrap } from '../transport/envelopes.js'
import type { Coin, Page } from '../types/common.js'
import {
  HIP4_ACTION_TYPES,
  HIP4_CLASSES,
  HIP4_INTERVALS,
  type Hip4AnalyticsParams,
  type Hip4AnalyticsRow,
  type Hip4Fee,
  type Hip4FeeScale,
  type Hip4FeesParams,
  type Hip4Fill,
  type Hip4FillsParams,
  type Hip4MarketsParams,
  type Hip4Outcome,
  type Hip4OutcomeToken,
  type Hip4OutcomeTokensParams,
  type Hip4OutcomesParams,
  type Hip4Question,
  type Hip4QuestionsParams,
  type Hip4Settlement,
  type Hip4SettlementsParams,
  type Hip4UserAction,
  type Hip4UserActionsParams,
  type ParsedHip4Description,
} from '../types/hip4.js'

// ---------------------------------------------------------------------------
// Per-endpoint limit caps (server-enforced via 422 — see ENDPOINTS.md HIP-4).
// ---------------------------------------------------------------------------

const MARKETS_LIMIT_CAP = 1000
const QUESTIONS_LIMIT_CAP = 1000
const OUTCOME_TOKENS_LIMIT_CAP = 1000
const FILLS_LIMIT_CAP = 1000
const FEES_LIMIT_CAP = 1000
const SETTLEMENTS_LIMIT_CAP = 1000
const ANALYTICS_LIMIT_CAP = 2000
const USER_ACTIONS_LIMIT_CAP = 1000

type Query = Record<string, string | number | boolean | null | undefined>

// ---------------------------------------------------------------------------
// parseHip4Description — PLAN.md §I bug #12 helper.
//
// HIP-4 `description` is a pipe-delimited mini-format
// (`class:priceBinary|underlying:BTC|expiry:20260512-0600|targetPrice:80813|period:1d`)
// instead of a structured JSON object. The SDK parses it lazily so callers
// don't have to ship a regex per usage site. Unknown keys are ignored.
// ---------------------------------------------------------------------------

type MutableParsedHip4Description = {
  -readonly [K in keyof ParsedHip4Description]: ParsedHip4Description[K]
}

/**
 * Parse the pipe-delimited `description` payload returned on
 * {@link Hip4Outcome.description} and {@link Hip4Question.description}.
 *
 * @example
 * parseHip4Description('class:priceBinary|underlying:BTC|expiry:20260512-0600|targetPrice:80813|period:1d')
 * // => { class: 'priceBinary', underlying: 'BTC', expiry: '20260512-0600', targetPrice: 80813, period: '1d' }
 *
 * @example
 * parseHip4Description('class:priceBucket|underlying:BTC|expiry:20260508-0600|priceThresholds:79303,82540|period:1d')
 * // => { class: 'priceBucket', underlying: 'BTC', expiry: '20260508-0600', priceThresholds: [79303, 82540], period: '1d' }
 *
 * Returns `{}` for empty or non-string input. Unknown keys (any future
 * additions to the wire format) are silently dropped.
 */
export function parseHip4Description(raw: string): ParsedHip4Description {
  const out: MutableParsedHip4Description = {}
  if (typeof raw !== 'string' || raw.length === 0) return out
  for (const part of raw.split('|')) {
    const idx = part.indexOf(':')
    if (idx <= 0) continue
    const key = part.slice(0, idx)
    const value = part.slice(idx + 1)
    switch (key) {
      case 'class':
        if (value === 'priceBinary' || value === 'priceBucket' || value === '') {
          out.class = value
        }
        break
      case 'underlying':
        out.underlying = value
        break
      case 'expiry':
        out.expiry = value
        break
      case 'targetPrice': {
        const n = Number(value)
        if (Number.isFinite(n)) out.targetPrice = n
        break
      }
      case 'priceThresholds': {
        const nums: number[] = []
        for (const piece of value.split(',')) {
          const n = Number(piece)
          if (Number.isFinite(n)) nums.push(n)
        }
        if (nums.length > 0) out.priceThresholds = nums
        break
      }
      case 'period':
        out.period = value
        break
    }
  }
  return out
}

// ---------------------------------------------------------------------------
// Query builders — emit snake_case wire params; only set defined fields so
// `exactOptionalPropertyTypes` stays happy.
// ---------------------------------------------------------------------------

function buildMarketsQuery(p: Hip4MarketsParams): Query {
  assertLimit(p.limit, MARKETS_LIMIT_CAP)
  assertOptionalEnum(p.class, HIP4_CLASSES, 'class')
  const q: Query = {}
  if (p.outcomeId !== undefined) q['outcome_id'] = p.outcomeId
  if (p.class !== undefined) q['class'] = p.class
  if (p.underlying !== undefined) q['underlying'] = p.underlying
  if (p.questionId !== undefined) q['question_id'] = p.questionId
  if (p.limit !== undefined) q['limit'] = p.limit
  if (p.offset !== undefined) q['offset'] = p.offset
  return q
}

function buildQuestionsQuery(p: Hip4QuestionsParams): Query {
  assertLimit(p.limit, QUESTIONS_LIMIT_CAP)
  const q: Query = {}
  if (p.questionId !== undefined) q['question_id'] = p.questionId
  if (p.limit !== undefined) q['limit'] = p.limit
  if (p.offset !== undefined) q['offset'] = p.offset
  return q
}

function buildOutcomeTokensQuery(p: Hip4OutcomeTokensParams): Query {
  assertLimit(p.limit, OUTCOME_TOKENS_LIMIT_CAP)
  const q: Query = {}
  if (p.outcomeId !== undefined) q['outcome_id'] = p.outcomeId
  if (p.coin !== undefined) q['coin'] = p.coin
  if (p.limit !== undefined) q['limit'] = p.limit
  if (p.offset !== undefined) q['offset'] = p.offset
  return q
}

function buildFillsQuery(p: Hip4FillsParams): Query {
  assertLimit(p.limit, FILLS_LIMIT_CAP)
  if (p.user !== undefined) assertAddress(p.user, 'user')
  const q: Query = {}
  if (p.user !== undefined) q['user'] = p.user
  if (p.coin !== undefined) q['coin'] = p.coin
  if (p.outcomeId !== undefined) q['outcome_id'] = p.outcomeId
  if (p.startTime !== undefined) q['start'] = encodeTime(p.startTime, 'isoBare')
  if (p.endTime !== undefined) q['end'] = encodeTime(p.endTime, 'isoBare')
  if (p.limit !== undefined) q['limit'] = p.limit
  if (p.offset !== undefined) q['offset'] = p.offset
  return q
}

function buildFeesQuery(p: Hip4FeesParams): Query {
  assertLimit(p.limit, FEES_LIMIT_CAP)
  if (p.user !== undefined) assertAddress(p.user, 'user')
  const q: Query = {}
  if (p.user !== undefined) q['user'] = p.user
  if (p.coin !== undefined) q['coin'] = p.coin
  if (p.startTime !== undefined) q['start'] = encodeTime(p.startTime, 'isoBare')
  if (p.endTime !== undefined) q['end'] = encodeTime(p.endTime, 'isoBare')
  if (p.limit !== undefined) q['limit'] = p.limit
  if (p.offset !== undefined) q['offset'] = p.offset
  return q
}

function buildSettlementsQuery(p: Hip4SettlementsParams): Query {
  assertLimit(p.limit, SETTLEMENTS_LIMIT_CAP)
  const q: Query = {}
  if (p.outcomeId !== undefined) q['outcome_id'] = p.outcomeId
  if (p.startTime !== undefined) q['start'] = encodeTime(p.startTime, 'isoBare')
  if (p.endTime !== undefined) q['end'] = encodeTime(p.endTime, 'isoBare')
  if (p.limit !== undefined) q['limit'] = p.limit
  if (p.offset !== undefined) q['offset'] = p.offset
  return q
}

function encodeAnalyticsCoin(coin: Coin | ReadonlyArray<Coin | number>): string {
  if (Array.isArray(coin)) {
    return coin.map((c) => (typeof c === 'number' ? String(c) : c)).join(',')
  }
  return String(coin)
}

function buildAnalyticsQuery(p: Hip4AnalyticsParams): Query {
  assertLimit(p.limit, ANALYTICS_LIMIT_CAP)
  assertOptionalEnum(p.interval, HIP4_INTERVALS, 'interval')
  const q: Query = {}
  if (p.interval !== undefined) q['interval'] = p.interval
  if (p.coin !== undefined) q['coin'] = encodeAnalyticsCoin(p.coin)
  if (p.outcomeId !== undefined) q['outcome_id'] = p.outcomeId
  if (p.startTime !== undefined) q['start'] = encodeTime(p.startTime, 'isoBare')
  if (p.endTime !== undefined) q['end'] = encodeTime(p.endTime, 'isoBare')
  if (p.limit !== undefined) q['limit'] = p.limit
  return q
}

function buildUserActionsQuery(p: Hip4UserActionsParams): Query {
  assertLimit(p.limit, USER_ACTIONS_LIMIT_CAP)
  // Validation is intentionally enforced client-side even though the server
  // bypasses it while the endpoint is gated (ENDPOINTS.md HIP-4 batch-5).
  assertOptionalEnum(p.actionType, HIP4_ACTION_TYPES, 'action_type')
  if (p.user !== undefined) assertAddress(p.user, 'user')
  const q: Query = {}
  if (p.actionType !== undefined) q['action_type'] = p.actionType
  if (p.user !== undefined) q['user'] = p.user
  if (p.limit !== undefined) q['limit'] = p.limit
  if (p.offset !== undefined) q['offset'] = p.offset
  return q
}

// ---------------------------------------------------------------------------
// Sub-resources — internal classes constructed by Hip4Resource. Each pairs a
// path string with the matching query builder, so /hip4/markets and
// /hip4/outcomes can share a sub-class while hitting distinct endpoints.
// ---------------------------------------------------------------------------

class Hip4MarketsResource {
  constructor(
    private readonly http: HttpClient,
    private readonly path: string,
  ) {}

  /** GET `/hip4/{markets|outcomes}` — offset pagination, 1..1000 limit. */
  async list(params: Hip4MarketsParams = {}): Promise<Page<Hip4Outcome>> {
    const raw = await this.http.request<unknown>({
      path: this.path,
      query: buildMarketsQuery(params),
    })
    return unwrap<Hip4Outcome>(raw, 'hip4')
  }

  /** Async iterator — pages by `offset += limit` until a partial page is returned. */
  iterate(params: Hip4MarketsParams = {}): AsyncIterable<Hip4Outcome> {
    const limit = params.limit ?? MARKETS_LIMIT_CAP
    const initial: Record<string, unknown> = { ...params, limit }
    return iterate<Hip4Outcome, Record<string, unknown>>(
      (p) => this.list(p as Hip4MarketsParams),
      initial,
      { kind: 'offset', limit },
    )
  }
}

class Hip4QuestionsSubResource {
  constructor(private readonly http: HttpClient) {}

  /** GET `/hip4/questions` — offset pagination, 1..1000 limit. */
  async list(params: Hip4QuestionsParams = {}): Promise<Page<Hip4Question>> {
    const raw = await this.http.request<unknown>({
      path: '/hip4/questions',
      query: buildQuestionsQuery(params),
    })
    return unwrap<Hip4Question>(raw, 'hip4')
  }

  /** Async iterator — `description` is pipe-delimited (PLAN.md §I #12). */
  iterate(params: Hip4QuestionsParams = {}): AsyncIterable<Hip4Question> {
    const limit = params.limit ?? QUESTIONS_LIMIT_CAP
    const initial: Record<string, unknown> = { ...params, limit }
    return iterate<Hip4Question, Record<string, unknown>>(
      (p) => this.list(p as Hip4QuestionsParams),
      initial,
      { kind: 'offset', limit },
    )
  }
}

class Hip4OutcomeTokensSubResource {
  constructor(private readonly http: HttpClient) {}

  /** GET `/hip4/outcome-tokens` — offset pagination, `coin=@N` filter works. */
  async list(params: Hip4OutcomeTokensParams = {}): Promise<Page<Hip4OutcomeToken>> {
    const raw = await this.http.request<unknown>({
      path: '/hip4/outcome-tokens',
      query: buildOutcomeTokensQuery(params),
    })
    return unwrap<Hip4OutcomeToken>(raw, 'hip4')
  }

  iterate(params: Hip4OutcomeTokensParams = {}): AsyncIterable<Hip4OutcomeToken> {
    const limit = params.limit ?? OUTCOME_TOKENS_LIMIT_CAP
    const initial: Record<string, unknown> = { ...params, limit }
    return iterate<Hip4OutcomeToken, Record<string, unknown>>(
      (p) => this.list(p as Hip4OutcomeTokensParams),
      initial,
      { kind: 'offset', limit },
    )
  }
}

class Hip4FillsSubResource {
  constructor(private readonly http: HttpClient) {}

  /**
   * GET `/hip4/fills` — offset pagination, 1..1000 limit. Time-window params
   * use `start` / `end` (not `start_time` / `end_time`). `user` is validated
   * client-side via `assertAddress`.
   */
  async list(params: Hip4FillsParams = {}): Promise<Page<Hip4Fill>> {
    const raw = await this.http.request<unknown>({
      path: '/hip4/fills',
      query: buildFillsQuery(params),
    })
    return unwrap<Hip4Fill>(raw, 'hip4')
  }

  iterate(params: Hip4FillsParams = {}): AsyncIterable<Hip4Fill> {
    const limit = params.limit ?? FILLS_LIMIT_CAP
    const initial: Record<string, unknown> = { ...params, limit }
    return iterate<Hip4Fill, Record<string, unknown>>(
      (p) => this.list(p as Hip4FillsParams),
      initial,
      { kind: 'offset', limit },
    )
  }
}

class Hip4FeesSubResource {
  constructor(private readonly http: HttpClient) {}

  /** GET `/hip4/fees` — daily fee aggregate per `(user, coin, date)`. */
  async list(params: Hip4FeesParams = {}): Promise<Page<Hip4Fee>> {
    const raw = await this.http.request<unknown>({
      path: '/hip4/fees',
      query: buildFeesQuery(params),
    })
    return unwrap<Hip4Fee>(raw, 'hip4')
  }

  iterate(params: Hip4FeesParams = {}): AsyncIterable<Hip4Fee> {
    const limit = params.limit ?? FEES_LIMIT_CAP
    const initial: Record<string, unknown> = { ...params, limit }
    return iterate<Hip4Fee, Record<string, unknown>>(
      (p) => this.list(p as Hip4FeesParams),
      initial,
      { kind: 'offset', limit },
    )
  }
}

class Hip4SettlementsSubResource {
  constructor(private readonly http: HttpClient) {}

  /**
   * GET `/hip4/settlements` — offset pagination. Duplicates on
   * `(outcome_id, nonce)` are possible (PLAN.md §I open Q #23).
   */
  async list(params: Hip4SettlementsParams = {}): Promise<Page<Hip4Settlement>> {
    const raw = await this.http.request<unknown>({
      path: '/hip4/settlements',
      query: buildSettlementsQuery(params),
    })
    return unwrap<Hip4Settlement>(raw, 'hip4')
  }

  iterate(params: Hip4SettlementsParams = {}): AsyncIterable<Hip4Settlement> {
    const limit = params.limit ?? SETTLEMENTS_LIMIT_CAP
    const initial: Record<string, unknown> = { ...params, limit }
    return iterate<Hip4Settlement, Record<string, unknown>>(
      (p) => this.list(p as Hip4SettlementsParams),
      initial,
      { kind: 'offset', limit },
    )
  }
}

class Hip4FeeScalesSubResource {
  constructor(private readonly http: HttpClient) {}

  /**
   * GET `/hip4/fee-scales` — none-list. Returns `status: not_yet_live` today
   * (`meta.status === 'not_yet_live'`, `data: []`). Schema TBD upstream.
   */
  async list(): Promise<Page<Hip4FeeScale>> {
    const raw = await this.http.request<unknown>({ path: '/hip4/fee-scales' })
    return unwrap<Hip4FeeScale>(raw, 'hip4')
  }
}

class Hip4AnalyticsSubResource {
  constructor(private readonly http: HttpClient) {}

  /**
   * GET `/hip4/analytics` — offset pagination, 1..2000 limit. Without a
   * `coin` / `outcomeId` filter, rows are aggregate ({@link Hip4AnalyticsRowAggregate}).
   * With a filter, rows include `coin` ({@link Hip4AnalyticsRowByCoin}).
   *
   * `coin` accepts either a single string or an array of strings / numeric
   * `outcome_id`s, joined with commas on the wire (e.g. `"290,291"` —
   * the server normalizes ints to `"#NNN"`).
   */
  async list(params: Hip4AnalyticsParams = {}): Promise<Page<Hip4AnalyticsRow>> {
    const raw = await this.http.request<unknown>({
      path: '/hip4/analytics',
      query: buildAnalyticsQuery(params),
    })
    return unwrap<Hip4AnalyticsRow>(raw, 'hip4')
  }

  iterate(params: Hip4AnalyticsParams = {}): AsyncIterable<Hip4AnalyticsRow> {
    const limit = params.limit ?? ANALYTICS_LIMIT_CAP
    const initial: Record<string, unknown> = { ...params, limit }
    return iterate<Hip4AnalyticsRow, Record<string, unknown>>(
      (p) => this.list(p as Hip4AnalyticsParams),
      initial,
      { kind: 'offset', limit },
    )
  }
}

class Hip4UserActionsSubResource {
  constructor(private readonly http: HttpClient) {}

  /**
   * GET `/hip4/user-actions` — offset pagination, 1..1000 limit. Returns
   * `status: not_yet_live` today; the SDK still validates `actionType`
   * client-side because the server skips validation while short-circuited
   * (PLAN.md §I #5).
   */
  async list(params: Hip4UserActionsParams = {}): Promise<Page<Hip4UserAction>> {
    const raw = await this.http.request<unknown>({
      path: '/hip4/user-actions',
      query: buildUserActionsQuery(params),
    })
    return unwrap<Hip4UserAction>(raw, 'hip4')
  }

  iterate(params: Hip4UserActionsParams = {}): AsyncIterable<Hip4UserAction> {
    const limit = params.limit ?? USER_ACTIONS_LIMIT_CAP
    const initial: Record<string, unknown> = { ...params, limit }
    return iterate<Hip4UserAction, Record<string, unknown>>(
      (p) => this.list(p as Hip4UserActionsParams),
      initial,
      { kind: 'offset', limit },
    )
  }
}

// ---------------------------------------------------------------------------
// Hip4Resource — top-level handle wired by the Wire phase into HypedexerClient.
// ---------------------------------------------------------------------------

/**
 * Resource handle for the `/hip4/*` endpoints (HIP-4 prediction markets,
 * batch-5). Every endpoint uses the dedicated `Hip4Envelope`
 * (`{status, count, data, message?, testnet_docs?}`); `meta.status` is
 * preserved so callers can distinguish `'not_yet_live'` from an empty page.
 *
 * Known issues defended by this resource:
 * - PLAN.md §I #5 — silent enum fallback on `hip4/markets.coin`. The SDK
 *   omits the `coin` filter from {@link Hip4MarketsParams} entirely; only
 *   `outcomeId` filters work. `analytics.interval` and `userActions.actionType`
 *   are client-side-validated against the documented enum.
 * - PLAN.md §I #12 — `description` is the pipe-delimited mini-format
 *   `class:foo|underlying:bar|...`. Exposed as the dedicated helper
 *   {@link parseHip4Description}; the {@link ParsedHip4Description} type lives
 *   in `types/hip4.ts`.
 * - PLAN.md §I #22 — `hip4/markets?coin=` is silently ignored upstream. See #5
 *   above; the filter is intentionally absent from the typed surface.
 *
 * The `feeScales` and `userActions` endpoints return `status: not_yet_live`
 * today (no mainnet schema). Their typed payloads are deliberately schema-less
 * ({@link Hip4FeeScale} / {@link Hip4UserAction}) until upstream ships rows.
 */
export class Hip4Resource {
  readonly markets: Hip4MarketsResource
  /** Alias of `markets` — hits `/hip4/outcomes` (verified identical wire shape). */
  readonly outcomes: Hip4MarketsResource
  readonly questions: Hip4QuestionsSubResource
  readonly outcomeTokens: Hip4OutcomeTokensSubResource
  readonly fills: Hip4FillsSubResource
  readonly fees: Hip4FeesSubResource
  readonly settlements: Hip4SettlementsSubResource
  readonly feeScales: Hip4FeeScalesSubResource
  readonly analytics: Hip4AnalyticsSubResource
  readonly userActions: Hip4UserActionsSubResource

  constructor(http: HttpClient) {
    this.markets = new Hip4MarketsResource(http, '/hip4/markets')
    this.outcomes = new Hip4MarketsResource(http, '/hip4/outcomes')
    this.questions = new Hip4QuestionsSubResource(http)
    this.outcomeTokens = new Hip4OutcomeTokensSubResource(http)
    this.fills = new Hip4FillsSubResource(http)
    this.fees = new Hip4FeesSubResource(http)
    this.settlements = new Hip4SettlementsSubResource(http)
    this.feeScales = new Hip4FeeScalesSubResource(http)
    this.analytics = new Hip4AnalyticsSubResource(http)
    this.userActions = new Hip4UserActionsSubResource(http)
  }
}

// Re-export so callers can import a single namespace from the resource module.
export type {
  Hip4AnalyticsParams,
  Hip4AnalyticsRow,
  Hip4Fee,
  Hip4FeeScale,
  Hip4FeesParams,
  Hip4Fill,
  Hip4FillsParams,
  Hip4MarketsParams,
  Hip4Outcome,
  Hip4OutcomeToken,
  Hip4OutcomeTokensParams,
  Hip4OutcomesParams,
  Hip4Question,
  Hip4QuestionsParams,
  Hip4Settlement,
  Hip4SettlementsParams,
  Hip4UserAction,
  Hip4UserActionsParams,
  ParsedHip4Description,
}
