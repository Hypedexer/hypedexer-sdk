import type { TimeInput } from '../time/index.js'
import type { Address, Coin } from './common.js'

/**
 * `/funding/predictedFundings` and `/funding/fundingHistory` row.
 *
 * `fundingRate` and `premium` are STRING-encoded floats per Hyperliquid
 * convention (PLAN.md §F.2) — preserve precision; use `parseFundingRate(s)`
 * to convert to `number`.
 *
 * `time` is epoch ms (PLAN.md §E.1 encoding #7); use
 * `parseTimestamp(value, 'epochMs')` to get a Date.
 */
export interface FundingRate {
  readonly coin: Coin
  /** String-encoded float, e.g. `"-0.0000101097"`. Use `parseFundingRate` to coerce. */
  readonly fundingRate: string
  /** String-encoded float. Use `parseFundingRate` to coerce. */
  readonly premium: string
  /** Epoch ms (number). */
  readonly time: number
}

/**
 * `/funding/userFunding` row.
 *
 * The wire shape is unverified — `/funding/userFunding` returns `[]` for every
 * tested user (PLAN.md §I bug #25). Field set below is the documented
 * Hyperliquid-convention placeholder until a populated response is captured.
 * `usdc`, `szi`, `delta` are typed as strings under the same precision-safety
 * rationale as funding rates.
 */
export interface FundingPayment {
  readonly time: number
  readonly coin: Coin
  /** Assumed string-encoded per Hyperliquid convention. */
  readonly usdc: string
  /** Assumed string-encoded per Hyperliquid convention. */
  readonly szi: string
  /** Assumed string-encoded per Hyperliquid convention. */
  readonly delta: string
}

/**
 * `/funding/fundingHistory` query params. `coin` is required by the server.
 * Time params are emitted as epoch-ms camelCase (`startTime` / `endTime`)
 * per PLAN.md §E.3.
 */
export interface FundingHistoryParams {
  readonly coin: Coin
  readonly startTime?: TimeInput
  readonly endTime?: TimeInput
  /** 1..5000 (server cap per ENDPOINTS.md). */
  readonly limit?: number
}

/**
 * `/funding/userFunding` query params. `user` is required by the server.
 * Time params are emitted as epoch-ms camelCase per PLAN.md §E.3.
 */
export interface UserFundingParams {
  readonly user: Address
  readonly startTime?: TimeInput
  readonly endTime?: TimeInput
  /** 1..5000 (server cap per ENDPOINTS.md). */
  readonly limit?: number
}
