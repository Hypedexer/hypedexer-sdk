import type { TimeInput } from '../time/index.js'
import type { Address, Coin, Hex, Side } from './common.js'

/**
 * ISO timestamp string emitted by HIP-4 endpoints, no timezone, µs/ms precision.
 * Use `parseTimestamp(value, 'iso')` to materialise a UTC Date.
 */
export type Hip4IsoTimestamp = string

/**
 * Bare `YYYY-MM-DD` (used on `Hip4Fee.date`). Use `parseTimestamp(value, 'date')`.
 */
export type Hip4DateOnly = string

/**
 * Compact HIP-4 expiry format `YYYYMMDD-HHMM` (e.g. `20260512-0600`). Distinct
 * from every other observed time encoding; parse with `parseHip4Expiry` from
 * `'@hypedexer/sdk'`.
 */
export type Hip4Expiry = string

/**
 * Outcome `class` enum. `''` (empty string) marks the "fallback" / non-parametric
 * outcome (e.g. `outcome_id: 0`) — see `exploration/batch-5-hip4.md`.
 */
export type Hip4Class = 'priceBinary' | 'priceBucket' | ''

/**
 * Runtime allowlist used to validate the `class` filter on `/hip4/markets`.
 */
export const HIP4_CLASSES = ['priceBinary', 'priceBucket', ''] as const

/**
 * `/hip4/analytics?interval=` bucket size.
 */
export type Hip4Interval = '1h' | '4h' | '1d'

/**
 * Runtime allowlist used to client-side-validate the `interval` filter.
 */
export const HIP4_INTERVALS = ['1h', '4h', '1d'] as const

/**
 * `/hip4/user-actions?action_type=` enum. Documented client-side enum even
 * though the endpoint returns `status: not_yet_live` today and silently accepts
 * bogus values upstream (ENDPOINTS.md HIP-4 batch-5 — `validation bypassed`).
 */
export type Hip4ActionType = 'Split' | 'Merge' | 'Negate'

/**
 * Runtime allowlist for {@link Hip4ActionType}.
 */
export const HIP4_ACTION_TYPES = ['Split', 'Merge', 'Negate'] as const

// ---------------------------------------------------------------------------
// Response shapes — field names mirror the upstream wire payload as-is.
// HIP-4 wire shapes are a documented mix of snake_case (most fields) and
// camelCase (`closedPnl`, `feeToken`, `typeTrade`); see exploration/samples/batch-5.
// ---------------------------------------------------------------------------

/**
 * One row of `/hip4/markets` (also returned by the alias `/hip4/outcomes`).
 *
 * `description` is the HIP-4-specific pipe-delimited mini-format
 * `class:priceBinary|underlying:BTC|expiry:20260512-0600|...` (PLAN.md §I #12).
 * Use `parseHip4Description(row.description)` to materialise a structured form.
 *
 * `coin` is `"#<outcome_id>"` or `""` for the fallback outcome
 * (`outcome_id === 0`). `settled` is wire int `0 | 1`.
 */
export interface Hip4Outcome {
  readonly outcome_id: number
  readonly coin: Coin
  readonly name: string
  readonly description: string
  readonly class: Hip4Class
  readonly underlying: string
  readonly expiry: Hip4Expiry
  readonly target_price: number | null
  readonly period: string
  /** Stringified JSON (e.g. `'[{"name":"Yes"},{"name":"No"}]'`). */
  readonly side_specs: string
  readonly question_id: number | null
  /** `outcome_id` of the paired quote token. */
  readonly quote_token: number
  readonly block_time: Hip4IsoTimestamp
  /** Wire-int boolean (`0 | 1`); see PLAN.md §F.4. */
  readonly settled: boolean | number
  readonly question_name: string
  readonly question_description: string
  readonly total_fills: number
  readonly total_volume: number
  readonly unique_users: number
}

/**
 * `/hip4/outcomes` returns the same record as `/hip4/markets` (verified alias).
 */
export type Hip4Market = Hip4Outcome

/**
 * One row of `/hip4/questions`. `description` is pipe-delimited and the only
 * place `class`/`underlying`/`expiry`/`period`/`priceThresholds` are surfaced on
 * a question (top-level columns are only on outcomes). Parse lazily via
 * `parseHip4Description(row.description)`.
 *
 * Use `question_id` as PK (the `name` field is often the literal string
 * `"Recurring"` and is not unique).
 */
export interface Hip4Question {
  readonly question_id: number
  readonly name: string
  readonly description: string
  readonly fallback_outcome: number
  readonly named_outcomes: ReadonlyArray<number>
  readonly settled_named_outcomes: ReadonlyArray<number>
  readonly updated_at: Hip4IsoTimestamp
}

/**
 * One row of `/hip4/outcome-tokens`. Spot-side mirror of an outcome:
 * `coin: "@<spot_index>"` — distinct from `Hip4Outcome.coin === "#<outcome_id>"`.
 */
export interface Hip4OutcomeToken {
  readonly outcome_id: number
  readonly coin: Coin
  readonly spot_index: number
  readonly spot_name: string
  readonly deployer_fee_share: number
  readonly sz_decimals: number
  readonly wei_decimals: number
  readonly updated_at: Hip4IsoTimestamp
}

/**
 * One row of `/hip4/fills`. `time_ms` is epoch milliseconds; use
 * `parseTimestamp(value, 'epochMs')` to materialise a Date.
 *
 * `feeToken` is either `"USDH"` (USDH-denominated settled fee) or `"+<NNN>"`
 * (outcome-token-denominated fee — see `parseCoin('+290')`). `fee_usdc` is the
 * always-present USDC-normalized fee value (see PLAN.md §G).
 *
 * `typeTrade: "perp"` is the only value observed today on every wire row.
 */
export interface Hip4Fill {
  readonly user: Address
  readonly coin: Coin
  readonly outcome_id: number
  /** Probability price, range 0..1. */
  readonly px: number
  readonly sz: number
  readonly side: Side
  readonly time_ms: number
  /** Free-form direction string (`"Buy"`, `"Sell"`, `"Merge Outcome"`, ...). */
  readonly dir: string
  readonly closedPnl: number
  readonly hash: Hex
  readonly oid: number
  readonly tid: number
  readonly fee: number
  readonly feeToken: string
  readonly fee_usdc: number
  readonly typeTrade: string
  readonly market_name: string
  readonly market_description: string
}

/**
 * One row of `/hip4/fees`. Daily aggregate per `(user, coin, date)`.
 * `effective_rate ≈ 0.0015` universally (flat 15 bps tier today).
 */
export interface Hip4Fee {
  readonly user: Address
  readonly coin: Coin
  readonly feeToken: string
  readonly date: Hip4DateOnly
  readonly fills: number
  readonly total_fee_raw: number
  readonly total_fee_usdc: number
  readonly total_notional: number
  readonly effective_rate: number
}

/**
 * One row of `/hip4/settlements`. Same outcome can settle multiple times in
 * adjacent blocks (PLAN.md §I open Q #23) — use `(outcome_id, nonce)` as
 * compound PK if the caller needs uniqueness.
 *
 * `settle_fraction` is in `[0, 1]`; `nonce` is a logical clock — treat as
 * opaque int, not a timestamp.
 */
export interface Hip4Settlement {
  readonly outcome_id: number
  readonly settle_fraction: number
  /** Free-form (`"price:80812.7"`, ...); needs case-by-case parsing per outcome class. */
  readonly details: string
  readonly broadcaster: Address
  readonly block_time: Hip4IsoTimestamp
  readonly block_height: number
  readonly nonce: number
}

/**
 * Aggregate `/hip4/analytics` row (no `coin` / `outcome_id` filter).
 * `bucket` is naive ISO at second precision aligned to the requested interval.
 */
export interface Hip4AnalyticsRowAggregate {
  readonly bucket: Hip4IsoTimestamp
  readonly fills: number
  readonly volume: number
  readonly buy_volume: number
  readonly sell_volume: number
  readonly fees_usdc: number
  readonly unique_users: number
}

/**
 * `/hip4/analytics` row when a `coin=<id>[,<id>...]` or `outcome_id=<id>`
 * filter is applied. Includes an extra `coin` field; discriminate via
 * `'coin' in row`.
 */
export interface Hip4AnalyticsRowByCoin extends Hip4AnalyticsRowAggregate {
  readonly coin: Coin
}

/**
 * Discriminated union over the two analytics row shapes.
 */
export type Hip4AnalyticsRow = Hip4AnalyticsRowAggregate | Hip4AnalyticsRowByCoin

/**
 * Schema-less placeholder for `/hip4/fee-scales`. Endpoint currently returns
 * `status: not_yet_live` with `data: []` (ENDPOINTS.md HIP-4 batch-5). The
 * `meta.status` exposes `'not_yet_live'` so callers can distinguish "feature
 * gated" from "no matching rows".
 */
export interface Hip4FeeScale {
  readonly [key: string]: unknown
}

/**
 * Schema-less placeholder for `/hip4/user-actions`. Endpoint currently returns
 * `status: not_yet_live` with `data: []`. The SDK still validates `actionType`
 * client-side against the documented enum {@link HIP4_ACTION_TYPES} because
 * the server skips validation while short-circuited (PLAN.md §I #5).
 */
export interface Hip4UserAction {
  readonly [key: string]: unknown
}

// ---------------------------------------------------------------------------
// Request parameters — camelCase SDK-facing, emitted as snake_case on the wire.
// ---------------------------------------------------------------------------

/**
 * `/hip4/markets` request params. The upstream `coin=` filter is **silently
 * ignored** by the server (PLAN.md §I #22) — the SDK intentionally omits it
 * from this typed surface; use `outcomeId` to filter.
 */
export interface Hip4MarketsParams {
  readonly outcomeId?: number
  readonly class?: Hip4Class
  readonly underlying?: string
  readonly questionId?: number
  /** 1..1000 (server cap). */
  readonly limit?: number
  readonly offset?: number
}

/**
 * `/hip4/outcomes` request params — alias for {@link Hip4MarketsParams}.
 */
export type Hip4OutcomesParams = Hip4MarketsParams

/**
 * `/hip4/questions` request params.
 */
export interface Hip4QuestionsParams {
  readonly questionId?: number
  /** 1..1000 (server cap). */
  readonly limit?: number
  readonly offset?: number
}

/**
 * `/hip4/outcome-tokens` request params. The `coin=@<spot_index>` filter is honored server-side.
 */
export interface Hip4OutcomeTokensParams {
  readonly outcomeId?: number
  /** `@<spot_index>` form (e.g. `"@1"`). */
  readonly coin?: Coin
  /** 1..1000 (server cap). */
  readonly limit?: number
  readonly offset?: number
}

/**
 * `/hip4/fills` request params.
 */
export interface Hip4FillsParams {
  readonly user?: Address
  /** `#<outcome_id>` form (e.g. `"#290"`). */
  readonly coin?: Coin
  readonly outcomeId?: number
  readonly startTime?: TimeInput
  readonly endTime?: TimeInput
  /** 1..1000 (server cap). */
  readonly limit?: number
  readonly offset?: number
}

/**
 * `/hip4/fees` request params.
 */
export interface Hip4FeesParams {
  readonly user?: Address
  readonly coin?: Coin
  readonly startTime?: TimeInput
  readonly endTime?: TimeInput
  /** 1..1000 (server cap). */
  readonly limit?: number
  readonly offset?: number
}

/**
 * `/hip4/settlements` request params.
 */
export interface Hip4SettlementsParams {
  readonly outcomeId?: number
  readonly startTime?: TimeInput
  readonly endTime?: TimeInput
  /** 1..1000 (server cap). */
  readonly limit?: number
  readonly offset?: number
}

/**
 * `/hip4/analytics` request params.
 */
export interface Hip4AnalyticsParams {
  readonly interval?: Hip4Interval
  /**
   * Single coin (e.g. `"#290"`) or comma-separated list. Numeric `outcome_id`s
   * are accepted and emitted as `"290,291"` — the server normalizes ints to
   * `"#NNN"` (see exploration/batch-5-hip4.md).
   */
  readonly coin?: Coin | ReadonlyArray<Coin | number>
  readonly outcomeId?: number
  readonly startTime?: TimeInput
  readonly endTime?: TimeInput
  /** 1..2000 (server cap). */
  readonly limit?: number
}

/**
 * `/hip4/user-actions` request params.
 *
 * @remarks
 * `actionType` is validated client-side against {@link HIP4_ACTION_TYPES}; the
 * endpoint returns `status: not_yet_live` and bypasses validation upstream
 * (ENDPOINTS.md HIP-4 batch-5).
 */
export interface Hip4UserActionsParams {
  readonly actionType?: Hip4ActionType
  readonly user?: Address
  /** 1..1000 (server cap). */
  readonly limit?: number
  readonly offset?: number
}

// ---------------------------------------------------------------------------
// Description parser
// ---------------------------------------------------------------------------

/**
 * Structured form of {@link Hip4Outcome.description} / {@link Hip4Question.description}
 * after running `parseHip4Description`. Every field is optional — only keys
 * present in the pipe-delimited payload are populated.
 *
 * See PLAN.md §I #12. Example raw input:
 * `class:priceBucket|underlying:BTC|expiry:20260508-0600|priceThresholds:79303,82540|period:1d`.
 */
export interface ParsedHip4Description {
  readonly class?: Hip4Class
  readonly underlying?: string
  readonly expiry?: Hip4Expiry
  readonly targetPrice?: number
  readonly priceThresholds?: ReadonlyArray<number>
  readonly period?: string
}
