import { assertAddress } from '../internal/address.js'
import { assertLimit } from '../internal/assert.js'
import { iterate } from '../pagination/iterator.js'
import { encodeTime } from '../time/index.js'
import type { HttpClient } from '../transport/HttpClient.js'
import { unwrap } from '../transport/envelopes.js'
import type { Page } from '../types/common.js'
import type {
  FundingHistoryParams,
  FundingPayment,
  FundingRate,
  UserFundingParams,
} from '../types/funding.js'

const FUNDING_HISTORY_LIMIT_CAP = 5000
const USER_FUNDING_LIMIT_CAP = 5000

type Query = Record<string, string | number | boolean | null | undefined>

/**
 * Resource handler for the `/funding/*` endpoints (batch-7).
 *
 * Envelope: bare arrays (PLAN.md §B.1). Note that `POST /info` with
 * `type: 'currentFundingRates'` re-wraps these in `APIResponse<T>`
 * (PLAN.md §A #15 / §I #11) — REST is bare; the `/info` dispatcher
 * (separate resource) is the one that unwraps to match.
 *
 * `fundingRate` and `premium` are returned as STRINGS to preserve precision
 * (PLAN.md §F.2). Use {@link parseFundingRate} from the public surface
 * (`@hypedexer/sdk`) to coerce them to `number`.
 */
export class FundingResource {
  constructor(private readonly http: HttpClient) {}

  /**
   * `GET /funding/predictedFundings` — bare list of predicted funding rates
   * for every coin. ~230 entries observed; ~47 with zero rate. No pagination.
   *
   * @returns Page of {@link FundingRate} rows (bare envelope, none-list).
   * @see PLAN.md §I #11
   */
  async predicted(): Promise<Page<FundingRate>> {
    const raw = await this.http.request<unknown>({ path: '/funding/predictedFundings' })
    return unwrap<FundingRate>(raw, 'bare')
  }

  /**
   * `GET /funding/fundingHistory` — historical funding rates for one coin.
   *
   * `coin` is required. Time params are emitted as epoch-ms camelCase
   * (`startTime` / `endTime`) per PLAN.md §E.3. `limit` is capped at 5000
   * client-side.
   *
   * Paginates by decrementing `endTime`; use {@link iterateHistory} for the
   * lazy variant.
   *
   * @param params - required `coin`, optional time window / limit.
   * @returns Page of {@link FundingRate} rows (bare envelope).
   * @throws ValidationError when `limit > 5000`.
   */
  async history(params: FundingHistoryParams): Promise<Page<FundingRate>> {
    const raw = await this.http.request<unknown>({
      path: '/funding/fundingHistory',
      query: buildHistoryQuery(params),
    })
    return unwrap<FundingRate>(raw, 'bare')
  }

  /**
   * Async iterator over `/funding/fundingHistory` — time-window pagination
   * by decrementing `endTime` to the oldest row's `time` (PLAN.md §D.1).
   *
   * @param params - same shape as {@link history}.
   * @returns Async iterable of {@link FundingRate} rows.
   * @throws ValidationError on the same conditions as {@link history}.
   */
  iterateHistory(params: FundingHistoryParams): AsyncIterable<FundingRate> {
    return iterate<FundingRate, FundingHistoryParams & Record<string, unknown>>(
      (p) => this.history(p),
      { ...params },
      { kind: 'timeWindow', timeKey: 'time' },
    )
  }

  /**
   * `GET /funding/userFunding` — per-user funding payments.
   *
   * `user` is required and validated client-side because sibling user-scoped
   * endpoints silently return zeroed sentinels on bad input (PLAN.md §I #14).
   * Time params are emitted as epoch-ms camelCase. `limit` is capped at 5000.
   *
   * **Empty in exploration**: this endpoint has returned `[]` for every
   * tested user during exploration; the row shape is unverified. The typed
   * model assumes the documented Hyperliquid convention.
   *
   * @param params - required `user`, optional time window / limit.
   * @returns Page of {@link FundingPayment} rows (bare envelope).
   * @throws ValidationError when `user` is not a valid address or `limit > 5000`.
   * @see PLAN.md §I #14
   */
  async userFunding(params: UserFundingParams): Promise<Page<FundingPayment>> {
    assertAddress(params.user, 'user')
    const raw = await this.http.request<unknown>({
      path: '/funding/userFunding',
      query: buildUserFundingQuery(params),
    })
    return unwrap<FundingPayment>(raw, 'bare')
  }

  /**
   * Async iterator over `/funding/userFunding` — time-window pagination
   * by decrementing `endTime` (PLAN.md §D.1).
   *
   * Subject to the same upstream emptiness as {@link userFunding}.
   *
   * @param params - same shape as {@link userFunding}.
   * @returns Async iterable of {@link FundingPayment} rows.
   * @throws ValidationError on the same conditions as {@link userFunding}.
   * @see PLAN.md §I #14
   */
  iterateUserFunding(params: UserFundingParams): AsyncIterable<FundingPayment> {
    assertAddress(params.user, 'user')
    return iterate<FundingPayment, UserFundingParams & Record<string, unknown>>(
      (p) => this.userFunding(p),
      { ...params },
      { kind: 'timeWindow', timeKey: 'time' },
    )
  }
}

function buildHistoryQuery(params: FundingHistoryParams): Query {
  assertLimit(params.limit, FUNDING_HISTORY_LIMIT_CAP)
  const q: Query = { coin: params.coin }
  if (params.startTime !== undefined) q['startTime'] = encodeTime(params.startTime, 'epochCamel')
  if (params.endTime !== undefined) q['endTime'] = encodeTime(params.endTime, 'epochCamel')
  if (params.limit !== undefined) q['limit'] = params.limit
  return q
}

function buildUserFundingQuery(params: UserFundingParams): Query {
  assertLimit(params.limit, USER_FUNDING_LIMIT_CAP)
  const q: Query = { user: params.user }
  if (params.startTime !== undefined) q['startTime'] = encodeTime(params.startTime, 'epochCamel')
  if (params.endTime !== undefined) q['endTime'] = encodeTime(params.endTime, 'epochCamel')
  if (params.limit !== undefined) q['limit'] = params.limit
  return q
}
