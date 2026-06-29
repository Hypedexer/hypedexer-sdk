import { assertAddress } from '../internal/address.js'
import { assertEnum, assertLimit, assertOptionalEnum } from '../internal/assert.js'
import { joinPath } from '../internal/url.js'
import { iterate } from '../pagination/iterator.js'
import { encodeTime } from '../time/index.js'
import type { HttpClient } from '../transport/HttpClient.js'
import { unwrap, unwrapSingle } from '../transport/envelopes.js'
import type { Page, Single } from '../types/common.js'
import {
  AUCTION_STATUSES,
  type AssetConfig,
  type Auction,
  type AuctionHistory,
  type DexRegistry,
  HIP3_LEADERBOARD_BY,
  type Hip3AssetsParams,
  type Hip3AuctionsHistoryParams,
  type Hip3AuctionsParams,
  type Hip3DexsParams,
  type Hip3Fill,
  type Hip3FillsParams,
  type Hip3LeaderboardEntry,
  type Hip3LeaderboardParams,
  type Hip3OhlcvParams,
  type Hip3OracleStatsParams,
  type Hip3Overview,
  type Hip3SnapshotsParams,
  type Hip3StatsTradersParams,
  type Hip3TopMoversParams,
  type Hip3UserCoinsParams,
  type Hip3UserFillsParams,
  type LiveSnapshot,
  type OhlcvBar,
  type OracleStats1m,
  type TraderStats,
  type UserCoinStats,
  type UserHip3Overview,
} from '../types/hip3.js'

const SIDES = ['A', 'B'] as const

const DEXS_LIMIT_CAP = 500
const ASSETS_LIMIT_CAP = 1000
const AUCTIONS_LIMIT_CAP = 200
const AUCTIONS_HISTORY_LIMIT_CAP = 500
const TOP_MOVERS_LIMIT_CAP = 100
const OHLCV_LIMIT_CAP = 2000
const ORACLE_STATS_LIMIT_CAP = 10000
const STATS_TRADERS_LIMIT_CAP = 500
const LEADERBOARD_LIMIT_CAP = 200
const USER_COINS_LIMIT_CAP = 100

type Query = Record<string, string | number | boolean | null | undefined>

/**
 * `iso-bare/epoch` time encoding for HIP-3: emits `start` / `end` query
 * params (not `start_time`/`end_time`). Values are encoded as `YYYY-MM-DD`
 * via the SDK's `encodeTime(..., 'isoBare')` helper — the server also
 * accepts epoch-ms here but bare-date is the canonical SDK form.
 *
 * @param q - mutable query record the encoded keys are written into.
 * @param startTime - user-supplied {@link TimeInput} (Date | number | string).
 * @param endTime - user-supplied {@link TimeInput} (Date | number | string).
 */
function applyTimeWindow(q: Query, startTime: unknown, endTime: unknown): void {
  if (startTime !== undefined) {
    q['start'] = encodeTime(startTime as Parameters<typeof encodeTime>[0], 'isoBare')
  }
  if (endTime !== undefined) {
    q['end'] = encodeTime(endTime as Parameters<typeof encodeTime>[0], 'isoBare')
  }
}

// -----------------------------------------------------------------------------
// dexs sub-resource — /hip3/dexs, /hip3/dexs/{dex_id}
// -----------------------------------------------------------------------------

/**
 * `/hip3/dexs/*` sub-resource: offset-paginated dex registry list plus a
 * by-id getter. The `get` method surfaces upstream 404 as
 * {@link NotFoundError} via the transport's `parseError`.
 */
export class Hip3DexsResource {
  constructor(private readonly http: HttpClient) {}

  /**
   * `GET /hip3/dexs` — offset pagination, `limit` 1..500.
   *
   * @param params - offset/limit pagination params.
   * @returns Page of {@link DexRegistry} rows (bare envelope).
   * @throws ValidationError when `limit` is outside `[1, 500]`.
   */
  async list(params: Hip3DexsParams = {}): Promise<Page<DexRegistry>> {
    assertLimit(params.limit, DEXS_LIMIT_CAP)
    const query: Query = {}
    if (params.limit !== undefined) query['limit'] = params.limit
    if (params.offset !== undefined) query['offset'] = params.offset
    const raw = await this.http.request<unknown>({ path: '/hip3/dexs', query })
    return unwrap<DexRegistry>(raw, 'bare')
  }

  /** Async iterator over `/hip3/dexs` (offset pagination). */
  iterate(params: Hip3DexsParams = {}): AsyncIterable<DexRegistry> {
    assertLimit(params.limit, DEXS_LIMIT_CAP)
    return iterate<DexRegistry, Hip3DexsParams & Record<string, unknown>>(
      (p) => this.list(p),
      { ...params },
      { kind: 'offset' },
    )
  }

  /**
   * `GET /hip3/dexs/{dex_id}` — single registry by id.
   *
   * Upstream returns `404 {detail: string}` when `dex_id` is unknown; the
   * transport maps that to {@link NotFoundError}.
   *
   * @param dexId - the dex id (URL-encoded via {@link joinPath}).
   * @returns Single {@link DexRegistry} record.
   * @throws NotFoundError when the dex id is unknown.
   */
  async get(dexId: string): Promise<Single<DexRegistry>> {
    const raw = await this.http.request<unknown>({
      path: joinPath('hip3', 'dexs', dexId),
    })
    return unwrapSingle<DexRegistry>(raw, 'bare')
  }
}

// -----------------------------------------------------------------------------
// assets sub-resource — /hip3/assets, /hip3/assets/{ticker}
// -----------------------------------------------------------------------------

/**
 * `/hip3/assets/*` sub-resource: offset-paginated asset config list plus a
 * by-ticker getter. Ticker is the prefixed `<dex>:<TICKER>` form
 * (e.g. `"xyz:CL"`) and is URL-encoded via {@link joinPath} so the `:` does
 * not collide with router scheme/host parsing.
 */
export class Hip3AssetsResource {
  constructor(private readonly http: HttpClient) {}

  /**
   * `GET /hip3/assets` — offset pagination, `limit` 1..1000.
   *
   * @param params - dex/search/offset/limit filters.
   * @returns Page of {@link AssetConfig} rows (bare envelope).
   * @throws ValidationError when `limit` is outside `[1, 1000]`.
   * @see PLAN.md §I #6 — `asset_id` is always 0 on every row.
   */
  async list(params: Hip3AssetsParams = {}): Promise<Page<AssetConfig>> {
    assertLimit(params.limit, ASSETS_LIMIT_CAP)
    const query: Query = {}
    if (params.dexId !== undefined) query['dex_id'] = params.dexId
    if (params.search !== undefined) query['search'] = params.search
    if (params.limit !== undefined) query['limit'] = params.limit
    if (params.offset !== undefined) query['offset'] = params.offset
    const raw = await this.http.request<unknown>({ path: '/hip3/assets', query })
    return unwrap<AssetConfig>(raw, 'bare')
  }

  /** Async iterator over `/hip3/assets` (offset pagination). */
  iterate(params: Hip3AssetsParams = {}): AsyncIterable<AssetConfig> {
    assertLimit(params.limit, ASSETS_LIMIT_CAP)
    return iterate<AssetConfig, Hip3AssetsParams & Record<string, unknown>>(
      (p) => this.list(p),
      { ...params },
      { kind: 'offset' },
    )
  }

  /**
   * `GET /hip3/assets/{ticker}` — single asset by prefixed ticker.
   *
   * Upstream returns `404 {detail: string}` on unknown ticker; transport
   * maps that to {@link NotFoundError}.
   *
   * @param ticker - the prefixed `<dex>:<TICKER>` form (e.g. `"xyz:CL"`).
   * @returns Single {@link AssetConfig} record.
   * @throws NotFoundError when the ticker is unknown.
   */
  async get(ticker: string): Promise<Single<AssetConfig>> {
    const raw = await this.http.request<unknown>({
      path: joinPath('hip3', 'assets', ticker),
    })
    return unwrapSingle<AssetConfig>(raw, 'bare')
  }
}

// -----------------------------------------------------------------------------
// auctions sub-resource — /hip3/auctions, /current, /history
// -----------------------------------------------------------------------------

/**
 * `/hip3/auctions/history` sub-resource: offset pagination, `limit` 1..500.
 *
 * **Schema divergence vs {@link Auction}**: this endpoint returns
 * {@link AuctionHistory} rows, where `auction_id` is a **string** (not the
 * numeric form on `/hip3/auctions`) and `dex_id`/`coin`/`winner` are empty
 * strings for expired auctions.
 */
export class Hip3AuctionsHistoryResource {
  constructor(private readonly http: HttpClient) {}

  /** `GET /hip3/auctions/history` — offset pagination, `limit` 1..500. */
  async list(params: Hip3AuctionsHistoryParams = {}): Promise<Page<AuctionHistory>> {
    assertLimit(params.limit, AUCTIONS_HISTORY_LIMIT_CAP)
    const query: Query = {}
    if (params.dexId !== undefined) query['dex_id'] = params.dexId
    if (params.limit !== undefined) query['limit'] = params.limit
    if (params.offset !== undefined) query['offset'] = params.offset
    const raw = await this.http.request<unknown>({
      path: '/hip3/auctions/history',
      query,
    })
    return unwrap<AuctionHistory>(raw, 'bare')
  }

  /** Async iterator over `/hip3/auctions/history` (offset pagination). */
  iterate(params: Hip3AuctionsHistoryParams = {}): AsyncIterable<AuctionHistory> {
    assertLimit(params.limit, AUCTIONS_HISTORY_LIMIT_CAP)
    return iterate<AuctionHistory, Hip3AuctionsHistoryParams & Record<string, unknown>>(
      (p) => this.list(p),
      { ...params },
      { kind: 'offset' },
    )
  }
}

/**
 * `/hip3/auctions/*` sub-resource: live auctions list, current auction, and
 * a nested `history` sub-resource for the closed-auction archive.
 */
export class Hip3AuctionsResource {
  readonly history: Hip3AuctionsHistoryResource

  constructor(private readonly http: HttpClient) {
    this.history = new Hip3AuctionsHistoryResource(http)
  }

  /**
   * `GET /hip3/auctions` — offset pagination, `limit` 1..200.
   *
   * @param params - status/offset/limit filters.
   * @returns Page of {@link Auction} rows (bare envelope).
   * @throws ValidationError when `status` is not in
   *   {@link AUCTION_STATUSES} or `limit` is outside `[1, 200]`.
   */
  async list(params: Hip3AuctionsParams = {}): Promise<Page<Auction>> {
    assertOptionalEnum(params.status, AUCTION_STATUSES, 'status')
    assertLimit(params.limit, AUCTIONS_LIMIT_CAP)
    const query: Query = {}
    if (params.status !== undefined) query['status'] = params.status
    if (params.limit !== undefined) query['limit'] = params.limit
    if (params.offset !== undefined) query['offset'] = params.offset
    const raw = await this.http.request<unknown>({ path: '/hip3/auctions', query })
    return unwrap<Auction>(raw, 'bare')
  }

  /** Async iterator over `/hip3/auctions` (offset pagination). */
  iterate(params: Hip3AuctionsParams = {}): AsyncIterable<Auction> {
    assertOptionalEnum(params.status, AUCTION_STATUSES, 'status')
    assertLimit(params.limit, AUCTIONS_LIMIT_CAP)
    return iterate<Auction, Hip3AuctionsParams & Record<string, unknown>>(
      (p) => this.list(p),
      { ...params },
      { kind: 'offset' },
    )
  }

  /** `GET /hip3/auctions/current` — most-recent live auction (single record). */
  async current(): Promise<Single<Auction>> {
    const raw = await this.http.request<unknown>({ path: '/hip3/auctions/current' })
    return unwrapSingle<Auction>(raw, 'bare')
  }
}

// -----------------------------------------------------------------------------
// fills sub-resource — /hip3/fills (offset, iso-bare/epoch time)
// -----------------------------------------------------------------------------

/**
 * `/hip3/fills` sub-resource: offset pagination, time-window via
 * `start`/`end` (iso-bare/epoch).
 *
 * Unlike perp `/fills/*`, HIP-3 fills have no cursor — `tid` is a plain
 * integer trade id (not the perp `<epoch_ms>:<tid>` cursor format).
 */
export class Hip3FillsResource {
  constructor(private readonly http: HttpClient) {}

  /** `GET /hip3/fills` — offset pagination. No documented server `limit` cap. */
  async list(params: Hip3FillsParams = {}): Promise<Page<Hip3Fill>> {
    assertOptionalEnum(params.side, SIDES, 'side')
    if (params.user !== undefined) assertAddress(params.user, 'user')
    const query: Query = {}
    if (params.dexId !== undefined) query['dex_id'] = params.dexId
    if (params.coin !== undefined) query['coin'] = params.coin
    if (params.user !== undefined) query['user'] = params.user
    if (params.side !== undefined) query['side'] = params.side
    if (params.minNotional !== undefined) query['min_notional'] = params.minNotional
    if (params.limit !== undefined) query['limit'] = params.limit
    if (params.offset !== undefined) query['offset'] = params.offset
    applyTimeWindow(query, params.startTime, params.endTime)
    const raw = await this.http.request<unknown>({ path: '/hip3/fills', query })
    return unwrap<Hip3Fill>(raw, 'bare')
  }

  /** Async iterator over `/hip3/fills` (offset pagination). */
  iterate(params: Hip3FillsParams = {}): AsyncIterable<Hip3Fill> {
    assertOptionalEnum(params.side, SIDES, 'side')
    if (params.user !== undefined) assertAddress(params.user, 'user')
    return iterate<Hip3Fill, Hip3FillsParams & Record<string, unknown>>(
      (p) => this.list(p),
      { ...params },
      { kind: 'offset' },
    )
  }
}

// -----------------------------------------------------------------------------
// stats sub-resource — /hip3/stats/traders
// -----------------------------------------------------------------------------

/**
 * `/hip3/stats/*` sub-resource. Currently exposes a single endpoint
 * (`traders`); kept as a sub-namespace for forward compatibility with
 * additional `/hip3/stats/...` rows the API may add.
 */
export class Hip3StatsResource {
  constructor(private readonly http: HttpClient) {}

  /** `GET /hip3/stats/traders` — offset pagination, `limit` 1..500. */
  async traders(params: Hip3StatsTradersParams = {}): Promise<Page<TraderStats>> {
    assertLimit(params.limit, STATS_TRADERS_LIMIT_CAP)
    const query: Query = {}
    if (params.dexId !== undefined) query['dex_id'] = params.dexId
    if (params.coin !== undefined) query['coin'] = params.coin
    if (params.limit !== undefined) query['limit'] = params.limit
    if (params.offset !== undefined) query['offset'] = params.offset
    const raw = await this.http.request<unknown>({
      path: '/hip3/stats/traders',
      query,
    })
    return unwrap<TraderStats>(raw, 'bare')
  }
}

// -----------------------------------------------------------------------------
// user(address) — scoped sub-resource factory
// -----------------------------------------------------------------------------

/**
 * Per-user HIP-3 sub-resource returned by {@link Hip3Resource.user}. The
 * address is validated at the factory call site, so all three methods on
 * this class trust the address (no re-validation).
 */
export class Hip3UserResource {
  constructor(
    private readonly http: HttpClient,
    private readonly address: string,
  ) {}

  /** `GET /hip3/users/{address}/overview` — bare {@link UserHip3Overview}. */
  async overview(): Promise<Single<UserHip3Overview>> {
    const raw = await this.http.request<unknown>({
      path: joinPath('hip3', 'users', this.address, 'overview'),
    })
    return unwrapSingle<UserHip3Overview>(raw, 'bare')
  }

  /**
   * `GET /hip3/users/{address}/fills` — offset pagination.
   * Same row shape as `/hip3/fills`.
   */
  async fills(params: Hip3UserFillsParams = {}): Promise<Page<Hip3Fill>> {
    const query: Query = {}
    if (params.coin !== undefined) query['coin'] = params.coin
    if (params.dexId !== undefined) query['dex_id'] = params.dexId
    if (params.limit !== undefined) query['limit'] = params.limit
    if (params.offset !== undefined) query['offset'] = params.offset
    applyTimeWindow(query, params.startTime, params.endTime)
    const raw = await this.http.request<unknown>({
      path: joinPath('hip3', 'users', this.address, 'fills'),
      query,
    })
    return unwrap<Hip3Fill>(raw, 'bare')
  }

  /** `GET /hip3/users/{address}/coins` — none-list, `limit` capped at 100. */
  async coins(params: Hip3UserCoinsParams = {}): Promise<Page<UserCoinStats>> {
    assertLimit(params.limit, USER_COINS_LIMIT_CAP)
    const query: Query = {}
    if (params.limit !== undefined) query['limit'] = params.limit
    const raw = await this.http.request<unknown>({
      path: joinPath('hip3', 'users', this.address, 'coins'),
      query,
    })
    return unwrap<UserCoinStats>(raw, 'bare')
  }
}

// -----------------------------------------------------------------------------
// top-level Hip3Resource
// -----------------------------------------------------------------------------

/**
 * `/hip3/*` resource (batch-4) — every endpoint uses the **bare** envelope
 * (no `APIResponse` / `Hip4Envelope` wrapper). See PLAN.md §A #1 and §B.1.
 *
 * Sub-namespaces:
 * - `dexs` — registry list / by-id
 * - `assets` — config list / by-ticker
 * - `auctions` — live list, `current`, `history` archive
 * - `fills` — fill firehose
 * - `stats.traders` — per-trader per-coin aggregates
 * - `user(address)` — per-user overview / fills / coins
 *
 * Top-level methods: `overview`, `snapshots`, `topMovers`, `ohlcv`,
 * `oracleStats`, `leaderboard`.
 *
 * Bugs defended client-side (PLAN.md §I):
 * - #5: `/hip3/leaderboard?by=` silently falls back to `volume`. SDK
 *   {@link assertEnum}-validates against {@link HIP3_LEADERBOARD_BY}.
 * - 404 on `/hip3/dexs/{id}` and `/hip3/assets/{ticker}` propagates as
 *   {@link NotFoundError} (handled by transport).
 *
 * Bugs documented in JSDoc (no SDK fix possible):
 * - #6: `AssetConfig.asset_id` is always 0.
 * - #7: `OhlcvBar.volume` / `OhlcvBar.fees` are always 0.
 */
export class Hip3Resource {
  readonly dexs: Hip3DexsResource
  readonly assets: Hip3AssetsResource
  readonly auctions: Hip3AuctionsResource
  readonly fills: Hip3FillsResource
  readonly stats: Hip3StatsResource

  constructor(private readonly http: HttpClient) {
    this.dexs = new Hip3DexsResource(http)
    this.assets = new Hip3AssetsResource(http)
    this.auctions = new Hip3AuctionsResource(http)
    this.fills = new Hip3FillsResource(http)
    this.stats = new Hip3StatsResource(http)
  }

  /**
   * `GET /hip3/overview` — aggregate stats (bare {@link Hip3Overview}).
   *
   * Note `auction_end_at` is the only HIP-3 timestamp returned with a `Z`
   * suffix; the others are naive ISO.
   */
  async overview(): Promise<Single<Hip3Overview>> {
    const raw = await this.http.request<unknown>({ path: '/hip3/overview' })
    return unwrapSingle<Hip3Overview>(raw, 'bare')
  }

  /**
   * `GET /hip3/snapshots` — bare {@link LiveSnapshot}[]. None-list (no
   * pagination); both filters are optional and return the full live set
   * when omitted.
   */
  async snapshots(params: Hip3SnapshotsParams = {}): Promise<Page<LiveSnapshot>> {
    const query: Query = {}
    if (params.dexId !== undefined) query['dex_id'] = params.dexId
    if (params.coin !== undefined) query['coin'] = params.coin
    const raw = await this.http.request<unknown>({ path: '/hip3/snapshots', query })
    return unwrap<LiveSnapshot>(raw, 'bare')
  }

  /**
   * `GET /hip3/top-movers` — bare {@link LiveSnapshot}[] (same row shape
   * as `/hip3/snapshots`). None-list, `limit` capped at 100.
   */
  async topMovers(params: Hip3TopMoversParams = {}): Promise<Page<LiveSnapshot>> {
    assertLimit(params.limit, TOP_MOVERS_LIMIT_CAP)
    const query: Query = {}
    if (params.limit !== undefined) query['limit'] = params.limit
    const raw = await this.http.request<unknown>({ path: '/hip3/top-movers', query })
    return unwrap<LiveSnapshot>(raw, 'bare')
  }

  /**
   * `GET /hip3/ohlcv` — bare {@link OhlcvBar}[]. Requires `coin`.
   * Offset pagination, `limit` 1..2000 (default 168 on the server).
   *
   * Time params encode as `start` / `end` (`iso-bare/epoch`).
   *
   * **PLAN.md §I bug #7**: `volume` and `fees` come back as `0.0` on every
   * bar today. Field shape is preserved for forward compat.
   */
  async ohlcv(params: Hip3OhlcvParams): Promise<Page<OhlcvBar>> {
    assertLimit(params.limit, OHLCV_LIMIT_CAP)
    const query: Query = { coin: params.coin }
    if (params.dexId !== undefined) query['dex_id'] = params.dexId
    if (params.limit !== undefined) query['limit'] = params.limit
    applyTimeWindow(query, params.startTime, params.endTime)
    const raw = await this.http.request<unknown>({ path: '/hip3/ohlcv', query })
    return unwrap<OhlcvBar>(raw, 'bare')
  }

  /**
   * `GET /hip3/oracle/stats` — bare {@link OracleStats1m}[]. Requires `dexId`.
   * Offset pagination, `limit` 1..10000.
   *
   * Time params encode as `start` / `end` (`iso-bare/epoch`).
   *
   * **PLAN.md §I bug #6**: `assetId` filter is effectively a no-op today
   * because every asset has `asset_id: 0`.
   */
  async oracleStats(params: Hip3OracleStatsParams): Promise<Page<OracleStats1m>> {
    assertLimit(params.limit, ORACLE_STATS_LIMIT_CAP)
    const query: Query = { dex_id: params.dexId }
    if (params.assetId !== undefined) query['asset_id'] = params.assetId
    if (params.limit !== undefined) query['limit'] = params.limit
    applyTimeWindow(query, params.startTime, params.endTime)
    const raw = await this.http.request<unknown>({
      path: '/hip3/oracle/stats',
      query,
    })
    return unwrap<OracleStats1m>(raw, 'bare')
  }

  /**
   * `GET /hip3/leaderboard` — bare {@link Hip3LeaderboardEntry}[]. Requires
   * `by`. None-list, `limit` capped at 200.
   *
   * **PLAN.md §I bug #5**: server silently falls back to `volume` on
   * unknown `by`. SDK validates client-side via {@link HIP3_LEADERBOARD_BY}.
   *
   * @param params - required `by` discriminator + optional dex/limit filters.
   * @returns Page of {@link Hip3LeaderboardEntry} rows (bare envelope).
   * @throws ValidationError when `by` is not in {@link HIP3_LEADERBOARD_BY}
   *   or `limit` is outside `[1, 200]`.
   * @see PLAN.md §I #5
   */
  async leaderboard(params: Hip3LeaderboardParams): Promise<Page<Hip3LeaderboardEntry>> {
    assertEnum(params.by, HIP3_LEADERBOARD_BY, 'by')
    assertLimit(params.limit, LEADERBOARD_LIMIT_CAP)
    const query: Query = { by: params.by }
    if (params.dexId !== undefined) query['dex_id'] = params.dexId
    if (params.limit !== undefined) query['limit'] = params.limit
    const raw = await this.http.request<unknown>({
      path: '/hip3/leaderboard',
      query,
    })
    return unwrap<Hip3LeaderboardEntry>(raw, 'bare')
  }

  /**
   * Per-user HIP-3 sub-resource for `address`. The address is validated
   * client-side at this call site; the returned {@link Hip3UserResource}
   * trusts the bound address.
   */
  user(address: string): Hip3UserResource {
    assertAddress(address, 'address')
    return new Hip3UserResource(this.http, address)
  }
}
