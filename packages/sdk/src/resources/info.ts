import { assertAddress } from '../internal/address.js'
import { encodeTime } from '../time/index.js'
import type { HttpClient } from '../transport/HttpClient.js'
import type { InfoRequest, InfoResultMap } from '../types/info.js'

/**
 * Wire keys that carry {@link TimeInput} values and need ISO snake-case
 * encoding before being shipped in the `/info` body. All known `/info` types
 * whose backing REST endpoint accepts time params do so as `iso-snake`
 * (ENDPOINTS.md). If a future type uses `epoch-camel`, add it here.
 */
const ISO_SNAKE_TIME_KEYS = new Set<string>(['start_time', 'end_time'])

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Build the JSON body for `POST /info` from a typed {@link InfoRequest}.
 *
 * Drops `undefined` keys (so the server applies its defaults), encodes
 * {@link TimeInput} values on known time keys, and runs the small set of
 * client-side validations the dispatcher needs:
 *
 *   - PLAN.md §I bug #14: `accountOverview` / `tradeHistory` both proxy to
 *     `/users/{addr}/...`, where bad addresses silently return zeroed
 *     payloads. The address is rejected client-side instead.
 *   - PLAN.md §I bug #4: `liqHistory` with `order: 'asc'` is documented as
 *     producing a corrupt cursor — flagged in the type's JSDoc but allowed
 *     here (caller is using the escape-hatch and may want page 1 only).
 */
function buildBody(req: InfoRequest): Record<string, unknown> {
  if (req.type === 'accountOverview' || req.type === 'tradeHistory') {
    assertAddress(req.user, 'user')
  }

  const body: Record<string, unknown> = { type: req.type }
  for (const [k, v] of Object.entries(req as Record<string, unknown>)) {
    if (k === 'type') continue
    if (v === undefined) continue
    if (ISO_SNAKE_TIME_KEYS.has(k)) {
      body[k] = encodeTime(v as Parameters<typeof encodeTime>[0], 'isoSnake')
    } else {
      body[k] = v
    }
  }
  return body
}

/**
 * Pull the inner payload out of an `/info` response.
 *
 * @remarks
 * **What:** Drop the outer `APIResponse<T>` envelope from every `/info`
 * response and return the raw `data` payload directly.
 *
 * **Why:** PLAN.md §I bug #11 — `POST /info` always wraps responses in
 * APIResponse, even for `currentFundingRates` and `vaultList` whose REST
 * counterparts return bare arrays. Without this unwrap, callers using
 * `client.info({type: 'currentFundingRates'})` would get a different shape
 * than `client.funding.predicted()`, defeating the dispatcher parity goal.
 *
 * The defensive branches (`raw` not an object, `data` missing) only fire
 * on the spot 500 path — but {@link HttpClient.request} already converts
 * those to `ServerError` via `parseError`, so in practice this function only
 * sees well-formed APIResponse objects.
 *
 * @see PLAN.md §I #11
 */
function extractData<T>(raw: unknown): T {
  if (isRecord(raw) && 'data' in raw) {
    return raw['data'] as T
  }
  // Bare passthrough — no /info type observed to return bare today, but if a
  // future type does (or a proxy strips the envelope) we don't want to crash.
  return raw as T
}

/**
 * `POST /info` — escape-hatch dispatcher for the same handlers powering the
 * REST resources. See PLAN.md §M for the rationale and §K example 16 for the
 * surface.
 *
 * Why expose this when the per-resource methods cover the same data:
 * - Hyperliquid users coming from the upstream `info` API expect this shape.
 * - One single POST body serialises cleanly across proxy/cache layers.
 *
 * Quirks defended here:
 * - PLAN.md §I bug #11: `currentFundingRates` and `vaultList` are wrapped in
 *   APIResponse by `/info` even though REST returns them bare. We always
 *   extract `.data`, so the returned shape matches REST for those two and
 *   stays consistent with every other type.
 * - PLAN.md §I bug #1: `spotTokenList` / `spotPairList` still 500 with a
 *   ClickHouse stack. The SDK does NOT throw client-side — the HTTP layer
 *   converts the 500 into `ServerError` via `parseError` so callers see the
 *   same error shape they would on the REST `/spot/*` endpoints.
 * - PLAN.md §I bug #14: `accountOverview` / `tradeHistory` both take `user`;
 *   bad addresses silently return zeroed payloads upstream, so we reject
 *   them client-side via `assertAddress` before the request fires.
 * - PLAN.md §I bug #21: the `400 {error: string}` error shape produced on
 *   unknown types or empty bodies is already mapped to `ValidationError` by
 *   {@link parseError}; callers see a uniform error surface.
 */
export class InfoResource {
  constructor(private readonly http: HttpClient) {}

  /**
   * Dispatch a typed `/info` request and return the inner payload.
   *
   * The return type narrows via {@link InfoResultMap} keyed on `req.type`.
   * For example:
   *
   * ```ts
   * const rates = await client.info({ type: 'currentFundingRates' })
   * //    ^? FundingRate[]
   * const fills = await client.info({ type: 'fills', coin: 'BTC' })
   * //    ^? Fill[]
   * ```
   *
   * @param req - typed discriminated-union request keyed by `type`.
   * @returns the inner `.data` payload, narrowed via {@link InfoResultMap}.
   * @throws ValidationError when `accountOverview`/`tradeHistory` carry an
   *   invalid `user` address, or when the server rejects a bad type
   *   (mapped from `400 {error: string}`).
   * @throws ServerError when `spotTokenList`/`spotPairList` hit the upstream
   *   500 (PLAN.md §I #1).
   * @see PLAN.md §I #1 #11 #14 §M
   */
  async info<R extends InfoRequest>(req: R): Promise<InfoResultMap[R['type']]> {
    const body = buildBody(req)
    const raw = await this.http.request<unknown>({
      method: 'POST',
      path: '/info',
      body,
    })
    return extractData<InfoResultMap[R['type']]>(raw)
  }
}
