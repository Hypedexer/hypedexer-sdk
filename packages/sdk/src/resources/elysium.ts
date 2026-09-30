import { ValidationError } from '../errors/index.js'
import { assertAddress } from '../internal/address.js'
import { assertLimit, assertOptionalEnum } from '../internal/assert.js'
import { joinPath } from '../internal/url.js'
import { iterate } from '../pagination/iterator.js'
import { encodeTime } from '../time/index.js'
import type { HttpClient } from '../transport/HttpClient.js'
import { unwrap, unwrapSingle } from '../transport/envelopes.js'
import type { Page, Single } from '../types/common.js'
import {
  ELYSIUM_BRIDGE_ASSETS,
  ELYSIUM_BRIDGE_DIRECTIONS,
  ELYSIUM_BRIDGE_ROUTES,
  ELYSIUM_BRIDGE_STATUSES,
  ELYSIUM_BRIDGE_TOKEN_ROUTES,
  ELYSIUM_RETRYABLE_STATUSES,
  ELYSIUM_TOKEN_ORIGINS,
  ELYSIUM_TOKEN_STANDARDS,
  type ElysiumBatch,
  type ElysiumBatchesParams,
  type ElysiumBlock,
  type ElysiumBlockDetail,
  type ElysiumBlocksParams,
  type ElysiumBridgeReserve,
  type ElysiumBridgeReservesParams,
  type ElysiumBridgeToken,
  type ElysiumBridgeTokensParams,
  type ElysiumBridgeTransfer,
  type ElysiumBridgeTransfersParams,
  type ElysiumDailyStat,
  type ElysiumLog,
  type ElysiumLogsParams,
  type ElysiumNetwork,
  type ElysiumRetryablesParams,
  type ElysiumStats,
  type ElysiumStatsDailyParams,
  type ElysiumToken,
  type ElysiumTokenDetail,
  type ElysiumTokenHolder,
  type ElysiumTokenHoldersParams,
  type ElysiumTokenTransfer,
  type ElysiumTokenTransfersParams,
  type ElysiumTokensParams,
  type ElysiumTransaction,
  type ElysiumTransactionDetail,
  type ElysiumTransactionsParams,
  type ElysiumUserActivity,
  type ElysiumUserActivityParams,
  type ElysiumUserBalances,
  type ElysiumUserBalancesParams,
  type ElysiumUserBridgeParams,
} from '../types/elysium.js'

const ELYSIUM_LIMIT_CAP = 1000
const ELYSIUM_STATS_DAILY_DAYS_CAP = 365
const TX_HASH_REGEX = /^0x[0-9a-fA-F]{64}$/

type Query = Record<string, string | number | boolean | null | undefined>

/** Upstream answers 422 on a malformed hash; the SDK fails first, without a round trip. */
function assertTxHash(value: unknown, paramName: string): asserts value is string {
  if (typeof value !== 'string' || !TX_HASH_REGEX.test(value)) {
    throw new ValidationError(`invalid transaction hash for "${paramName}"`, [
      {
        msg: 'value is not a 0x-prefixed 32-byte hex hash',
        loc: [paramName],
        type: 'sdk_validation',
        input: value,
      },
    ])
  }
}

function assertOptionalAddress(value: unknown, paramName: string): void {
  if (value !== undefined) assertAddress(value, paramName)
}

function assertDays(days: number | undefined): void {
  if (days === undefined) return
  if (!Number.isInteger(days) || days < 1 || days > ELYSIUM_STATS_DAILY_DAYS_CAP) {
    throw new ValidationError('"days" out of range', [
      {
        msg: `value must be an integer in 1..${ELYSIUM_STATS_DAILY_DAYS_CAP}`,
        loc: ['days'],
        type: 'limit',
        input: days,
        ctx: { cap: ELYSIUM_STATS_DAILY_DAYS_CAP },
      },
    ])
  }
}

function pageQuery(params: { limit?: number; offset?: number }): Query {
  assertLimit(params.limit, ELYSIUM_LIMIT_CAP)
  const q: Query = {}
  if (params.limit !== undefined) q['limit'] = params.limit
  if (params.offset !== undefined) q['offset'] = params.offset
  return q
}

/** Always ISO `Z`, like the EVM routes, so a caller's epoch input can never be misread. */
function applyTimeWindow(q: Query, startTime: unknown, endTime: unknown): void {
  if (startTime !== undefined) {
    q['start_time'] = encodeTime(startTime as Parameters<typeof encodeTime>[0], 'isoSnake')
  }
  if (endTime !== undefined) {
    q['end_time'] = encodeTime(endTime as Parameters<typeof encodeTime>[0], 'isoSnake')
  }
}

function coerceBool(value: unknown): boolean {
  if (typeof value === 'boolean') return value
  if (typeof value === 'number') return value !== 0
  return Boolean(value)
}

interface RawElysiumTransaction
  extends Omit<ElysiumTransaction, 'success' | 'is_system' | 'is_spam'> {
  readonly success: number | boolean
  readonly is_system: number | boolean
  readonly is_spam: number | boolean
}

/** `success`, `is_system` and `is_spam` arrive as wire ints `0 | 1`. */
function normalizeTransaction<T extends RawElysiumTransaction>(
  row: T,
): Omit<T, 'success' | 'is_system' | 'is_spam'> & {
  success: boolean
  is_system: boolean
  is_spam: boolean
} {
  return {
    ...row,
    success: coerceBool(row.success),
    is_system: coerceBool(row.is_system),
    is_spam: coerceBool(row.is_spam),
  }
}

/** Shared by every sub-resource: the network prefix and the page walker. */
abstract class ElysiumBase {
  constructor(
    protected readonly http: HttpClient,
    protected readonly network: ElysiumNetwork,
  ) {}

  protected path(...segments: string[]): string {
    return joinPath('elysium', this.network, ...segments)
  }

  protected walk<T, P extends { limit?: number; offset?: number }>(
    fetchPage: (p: P) => Promise<Page<T>>,
    params: P,
  ): AsyncIterable<T> {
    assertLimit(params.limit, ELYSIUM_LIMIT_CAP)
    return iterate<T, P & Record<string, unknown>>(
      (p) => fetchPage(p),
      { ...params } as P & Record<string, unknown>,
      { kind: 'offset' },
    )
  }
}

/** `/stats` and `/stats/daily`. */
export class ElysiumStatsResource extends ElysiumBase {
  /** `GET /elysium/{network}/stats`: totals indexed so far. */
  async get(): Promise<Single<ElysiumStats>> {
    const raw = await this.http.request<unknown>({ path: this.path('stats') })
    return unwrapSingle<ElysiumStats>(raw, 'apiResponse')
  }

  /**
   * `GET /elysium/{network}/stats/daily`: one row per UTC day, newest first.
   * The current day is partial until midnight UTC.
   *
   * @throws ValidationError when `days` is outside 1..365.
   */
  async daily(params: ElysiumStatsDailyParams = {}): Promise<Page<ElysiumDailyStat>> {
    assertDays(params.days)
    const query: Query = {}
    if (params.days !== undefined) query['days'] = params.days
    const raw = await this.http.request<unknown>({ path: this.path('stats', 'daily'), query })
    return unwrap<ElysiumDailyStat>(raw, 'apiResponse')
  }
}

/** `/blocks`, `/blocks/{n}` and `/blocks/{n}/transactions`. */
export class ElysiumBlocksResource extends ElysiumBase {
  /** `GET /elysium/{network}/blocks`: offset pagination, `limit` 1..1000. */
  async list(params: ElysiumBlocksParams = {}): Promise<Page<ElysiumBlock>> {
    const query = pageQuery(params)
    if (params.startBlock !== undefined) query['start_block'] = params.startBlock
    if (params.endBlock !== undefined) query['end_block'] = params.endBlock
    applyTimeWindow(query, params.startTime, params.endTime)
    const raw = await this.http.request<unknown>({ path: this.path('blocks'), query })
    return unwrap<ElysiumBlock>(raw, 'apiResponse')
  }

  iterate(params: ElysiumBlocksParams = {}): AsyncIterable<ElysiumBlock> {
    return this.walk((p) => this.list(p), params)
  }

  /**
   * `GET /elysium/{network}/blocks/{block_number}`, with the HyperEVM batch
   * that contains it.
   *
   * @throws NotFoundError when the block does not exist.
   */
  async get(blockNumber: number): Promise<Single<ElysiumBlockDetail>> {
    const raw = await this.http.request<unknown>({ path: this.path('blocks', String(blockNumber)) })
    return unwrapSingle<ElysiumBlockDetail>(raw, 'apiResponse')
  }

  /** `GET /elysium/{network}/blocks/{block_number}/transactions`: every transaction of one block. */
  async transactions(blockNumber: number): Promise<Page<ElysiumTransaction>> {
    const raw = await this.http.request<unknown>({
      path: this.path('blocks', String(blockNumber), 'transactions'),
    })
    const page = unwrap<RawElysiumTransaction>(raw, 'apiResponse')
    return { data: page.data.map((r) => normalizeTransaction(r)), meta: page.meta }
  }
}

/** `/transactions` and `/transactions/{tx_hash}`. */
export class ElysiumTransactionsResource extends ElysiumBase {
  /**
   * `GET /elysium/{network}/transactions`. System and spam transactions are
   * included unless `includeSystem` / `includeSpam` is `false`.
   *
   * @throws ValidationError on `limit > 1000` or a malformed address filter.
   */
  async list(params: ElysiumTransactionsParams = {}): Promise<Page<ElysiumTransaction>> {
    assertOptionalAddress(params.fromAddr, 'fromAddr')
    assertOptionalAddress(params.toAddr, 'toAddr')
    const query = pageQuery(params)
    if (params.blockNumber !== undefined) query['block_number'] = params.blockNumber
    if (params.fromAddr !== undefined) query['from_addr'] = params.fromAddr
    if (params.toAddr !== undefined) query['to_addr'] = params.toAddr
    if (params.methodId !== undefined) query['method_id'] = params.methodId
    if (params.txType !== undefined) query['tx_type'] = params.txType
    if (params.includeSystem !== undefined) query['include_system'] = params.includeSystem
    if (params.includeSpam !== undefined) query['include_spam'] = params.includeSpam
    applyTimeWindow(query, params.startTime, params.endTime)
    const raw = await this.http.request<unknown>({ path: this.path('transactions'), query })
    const page = unwrap<RawElysiumTransaction>(raw, 'apiResponse')
    return { data: page.data.map((r) => normalizeTransaction(r)), meta: page.meta }
  }

  iterate(params: ElysiumTransactionsParams = {}): AsyncIterable<ElysiumTransaction> {
    return this.walk((p) => this.list(p), params)
  }

  /**
   * `GET /elysium/{network}/transactions/{tx_hash}`: receipt fields, event
   * logs, decoded token transfers and the HyperEVM batch.
   *
   * @remarks Observed 2026-09-30: a transaction listed in the last few seconds
   * can briefly 404 here before its detail is indexed. Retry after a few seconds.
   * @throws ValidationError on a malformed hash. NotFoundError when unknown.
   */
  async get(txHash: string): Promise<Single<ElysiumTransactionDetail>> {
    assertTxHash(txHash, 'txHash')
    const raw = await this.http.request<unknown>({ path: this.path('transactions', txHash) })
    const single = unwrapSingle<
      RawElysiumTransaction & Omit<ElysiumTransactionDetail, keyof ElysiumTransaction>
    >(raw, 'apiResponse')
    if (single.data == null) return single as unknown as Single<ElysiumTransactionDetail>
    return {
      data: normalizeTransaction(single.data) as ElysiumTransactionDetail,
      meta: single.meta,
    }
  }
}

/** `/logs`. */
export class ElysiumLogsResource extends ElysiumBase {
  /** `GET /elysium/{network}/logs`, filterable by emitter, topic0, block or tx. */
  async list(params: ElysiumLogsParams = {}): Promise<Page<ElysiumLog>> {
    assertOptionalAddress(params.address, 'address')
    if (params.txHash !== undefined) assertTxHash(params.txHash, 'txHash')
    const query = pageQuery(params)
    if (params.blockNumber !== undefined) query['block_number'] = params.blockNumber
    if (params.address !== undefined) query['address'] = params.address
    if (params.topic0 !== undefined) query['topic0'] = params.topic0
    if (params.txHash !== undefined) query['tx_hash'] = params.txHash
    applyTimeWindow(query, params.startTime, params.endTime)
    const raw = await this.http.request<unknown>({ path: this.path('logs'), query })
    return unwrap<ElysiumLog>(raw, 'apiResponse')
  }

  iterate(params: ElysiumLogsParams = {}): AsyncIterable<ElysiumLog> {
    return this.walk((p) => this.list(p), params)
  }
}

/** `/batches` and `/batches/{n}`: what Elysium posted on HyperEVM. */
export class ElysiumBatchesResource extends ElysiumBase {
  async list(params: ElysiumBatchesParams = {}): Promise<Page<ElysiumBatch>> {
    const query = pageQuery(params)
    applyTimeWindow(query, params.startTime, params.endTime)
    const raw = await this.http.request<unknown>({ path: this.path('batches'), query })
    return unwrap<ElysiumBatch>(raw, 'apiResponse')
  }

  iterate(params: ElysiumBatchesParams = {}): AsyncIterable<ElysiumBatch> {
    return this.walk((p) => this.list(p), params)
  }

  /** @throws NotFoundError when the batch does not exist. */
  async get(batchNumber: number): Promise<Single<ElysiumBatch>> {
    const raw = await this.http.request<unknown>({
      path: this.path('batches', String(batchNumber)),
    })
    return unwrapSingle<ElysiumBatch>(raw, 'apiResponse')
  }
}

/** `/bridge/*`: HyperEVM <-> Elysium, tracked on both chains. */
export class ElysiumBridgeResource extends ElysiumBase {
  /** `GET /elysium/{network}/bridge/transfers`. */
  async transfers(params: ElysiumBridgeTransfersParams = {}): Promise<Page<ElysiumBridgeTransfer>> {
    assertOptionalAddress(params.address, 'address')
    assertOptionalAddress(params.token, 'token')
    assertOptionalEnum(params.direction, ELYSIUM_BRIDGE_DIRECTIONS, 'direction')
    assertOptionalEnum(params.status, ELYSIUM_BRIDGE_STATUSES, 'status')
    assertOptionalEnum(params.asset, ELYSIUM_BRIDGE_ASSETS, 'asset')
    assertOptionalEnum(params.route, ELYSIUM_BRIDGE_ROUTES, 'route')
    const query = pageQuery(params)
    if (params.address !== undefined) query['address'] = params.address
    if (params.direction !== undefined) query['direction'] = params.direction
    if (params.status !== undefined) query['status'] = params.status
    if (params.asset !== undefined) query['asset'] = params.asset
    if (params.route !== undefined) query['route'] = params.route
    if (params.token !== undefined) query['token'] = params.token
    if (params.includeMessages !== undefined) query['include_messages'] = params.includeMessages
    applyTimeWindow(query, params.startTime, params.endTime)
    const raw = await this.http.request<unknown>({ path: this.path('bridge', 'transfers'), query })
    return unwrap<ElysiumBridgeTransfer>(raw, 'apiResponse')
  }

  iterateTransfers(
    params: ElysiumBridgeTransfersParams = {},
  ): AsyncIterable<ElysiumBridgeTransfer> {
    return this.walk((p) => this.transfers(p), params)
  }

  /**
   * `GET /elysium/{network}/bridge/transfers/{tx_hash}`: every transfer a
   * transaction belongs to, from any hash of its journey (HyperEVM tx,
   * retryable ticket, Elysium redeem). A list, because one transaction can
   * carry several transfers.
   *
   * @throws ValidationError on a malformed hash. NotFoundError when no transfer matches.
   */
  async track(txHash: string): Promise<Page<ElysiumBridgeTransfer>> {
    assertTxHash(txHash, 'txHash')
    const raw = await this.http.request<unknown>({ path: this.path('bridge', 'transfers', txHash) })
    return unwrap<ElysiumBridgeTransfer>(raw, 'apiResponse')
  }

  /**
   * `GET /elysium/{network}/bridge/retryables`: deposits delivered through
   * retryable tickets. A failed auto-redeem can be redeemed by hand until the
   * ticket expires (7 days).
   */
  async retryables(params: ElysiumRetryablesParams = {}): Promise<Page<ElysiumBridgeTransfer>> {
    assertOptionalAddress(params.address, 'address')
    assertOptionalEnum(params.status, ELYSIUM_RETRYABLE_STATUSES, 'status')
    const query = pageQuery(params)
    if (params.status !== undefined) query['status'] = params.status
    if (params.address !== undefined) query['address'] = params.address
    applyTimeWindow(query, params.startTime, params.endTime)
    const raw = await this.http.request<unknown>({ path: this.path('bridge', 'retryables'), query })
    return unwrap<ElysiumBridgeTransfer>(raw, 'apiResponse')
  }

  iterateRetryables(params: ElysiumRetryablesParams = {}): AsyncIterable<ElysiumBridgeTransfer> {
    return this.walk((p) => this.retryables(p), params)
  }

  /** `GET /elysium/{network}/bridge/tokens`: tokens that crossed, with both addresses. */
  async tokens(params: ElysiumBridgeTokensParams = {}): Promise<Page<ElysiumBridgeToken>> {
    assertOptionalEnum(params.route, ELYSIUM_BRIDGE_TOKEN_ROUTES, 'route')
    const query = pageQuery(params)
    if (params.route !== undefined) query['route'] = params.route
    const raw = await this.http.request<unknown>({ path: this.path('bridge', 'tokens'), query })
    return unwrap<ElysiumBridgeToken>(raw, 'apiResponse')
  }

  /**
   * `GET /elysium/{network}/bridge/reserves`: the latest proof-of-backing
   * snapshot, taken every 15 minutes.
   *
   * @remarks Observed 2026-09-28: without a `route` filter the upstream list
   * stopped at 1000 rows and still reported `has_more: false`. Filter by route
   * to get every row.
   */
  async reserves(params: ElysiumBridgeReservesParams = {}): Promise<Page<ElysiumBridgeReserve>> {
    assertOptionalEnum(params.route, ELYSIUM_BRIDGE_ROUTES, 'route')
    const query: Query = {}
    if (params.route !== undefined) query['route'] = params.route
    if (params.onlyUnbacked !== undefined) query['only_unbacked'] = params.onlyUnbacked
    const raw = await this.http.request<unknown>({ path: this.path('bridge', 'reserves'), query })
    return unwrap<ElysiumBridgeReserve>(raw, 'apiResponse')
  }
}

/** `/tokens`, `/tokens/{address}`, `/holders`, `/transfers`. */
export class ElysiumTokensResource extends ElysiumBase {
  async list(params: ElysiumTokensParams = {}): Promise<Page<ElysiumToken>> {
    assertOptionalEnum(params.standard, ELYSIUM_TOKEN_STANDARDS, 'standard')
    assertOptionalEnum(params.origin, ELYSIUM_TOKEN_ORIGINS, 'origin')
    const query = pageQuery(params)
    if (params.standard !== undefined) query['standard'] = params.standard
    if (params.origin !== undefined) query['origin'] = params.origin
    if (params.search !== undefined) query['search'] = params.search
    const raw = await this.http.request<unknown>({ path: this.path('tokens'), query })
    return unwrap<ElysiumToken>(raw, 'apiResponse')
  }

  iterate(params: ElysiumTokensParams = {}): AsyncIterable<ElysiumToken> {
    return this.walk((p) => this.list(p), params)
  }

  /** @throws ValidationError on a malformed address. NotFoundError when unknown. */
  async get(address: string): Promise<Single<ElysiumTokenDetail>> {
    assertAddress(address, 'address')
    const raw = await this.http.request<unknown>({ path: this.path('tokens', address) })
    return unwrapSingle<ElysiumTokenDetail>(raw, 'apiResponse')
  }

  /** Current holders sorted by balance. */
  async holders(
    address: string,
    params: ElysiumTokenHoldersParams = {},
  ): Promise<Page<ElysiumTokenHolder>> {
    assertAddress(address, 'address')
    const query = pageQuery(params)
    const raw = await this.http.request<unknown>({
      path: this.path('tokens', address, 'holders'),
      query,
    })
    return unwrap<ElysiumTokenHolder>(raw, 'apiResponse')
  }

  async transfers(
    address: string,
    params: ElysiumTokenTransfersParams = {},
  ): Promise<Page<ElysiumTokenTransfer>> {
    assertAddress(address, 'address')
    assertOptionalAddress(params.holder, 'holder')
    const query = pageQuery(params)
    if (params.holder !== undefined) query['holder'] = params.holder
    applyTimeWindow(query, params.startTime, params.endTime)
    const raw = await this.http.request<unknown>({
      path: this.path('tokens', address, 'transfers'),
      query,
    })
    return unwrap<ElysiumTokenTransfer>(raw, 'apiResponse')
  }
}

/** Per-address routes, returned by {@link ElysiumNetworkResource.user}. The address is validated once. */
export class ElysiumUserResource extends ElysiumBase {
  constructor(
    http: HttpClient,
    network: ElysiumNetwork,
    private readonly address: string,
  ) {
    super(http, network)
  }

  /** Native HYPE and token balances, now or at a past `block`. */
  async balances(params: ElysiumUserBalancesParams = {}): Promise<Single<ElysiumUserBalances>> {
    const query: Query = {}
    if (params.block !== undefined) query['block'] = params.block
    const raw = await this.http.request<unknown>({
      path: this.path('user', this.address, 'balances'),
      query,
    })
    return unwrapSingle<ElysiumUserBalances>(raw, 'apiResponse')
  }

  /** Transactions, token transfers and bridge transfers involving the address, newest first. */
  async activity(params: ElysiumUserActivityParams = {}): Promise<Page<ElysiumUserActivity>> {
    const query = pageQuery(params)
    applyTimeWindow(query, params.startTime, params.endTime)
    const raw = await this.http.request<unknown>({
      path: this.path('user', this.address, 'activity'),
      query,
    })
    return unwrap<ElysiumUserActivity>(raw, 'apiResponse')
  }

  iterateActivity(params: ElysiumUserActivityParams = {}): AsyncIterable<ElysiumUserActivity> {
    return this.walk((p) => this.activity(p), params)
  }

  /** HyperEVM <-> Elysium bridge history of the address. */
  async bridge(params: ElysiumUserBridgeParams = {}): Promise<Page<ElysiumBridgeTransfer>> {
    assertOptionalEnum(params.direction, ELYSIUM_BRIDGE_DIRECTIONS, 'direction')
    assertOptionalEnum(params.status, ELYSIUM_BRIDGE_STATUSES, 'status')
    const query = pageQuery(params)
    if (params.direction !== undefined) query['direction'] = params.direction
    if (params.status !== undefined) query['status'] = params.status
    if (params.includeMessages !== undefined) query['include_messages'] = params.includeMessages
    applyTimeWindow(query, params.startTime, params.endTime)
    const raw = await this.http.request<unknown>({
      path: this.path('user', this.address, 'bridge'),
      query,
    })
    return unwrap<ElysiumBridgeTransfer>(raw, 'apiResponse')
  }
}

/** Every route under `/elysium/{network}`. */
export class ElysiumNetworkResource {
  readonly stats: ElysiumStatsResource
  readonly blocks: ElysiumBlocksResource
  readonly transactions: ElysiumTransactionsResource
  readonly logs: ElysiumLogsResource
  readonly batches: ElysiumBatchesResource
  readonly bridge: ElysiumBridgeResource
  readonly tokens: ElysiumTokensResource

  constructor(
    private readonly http: HttpClient,
    private readonly network: ElysiumNetwork,
  ) {
    this.stats = new ElysiumStatsResource(http, network)
    this.blocks = new ElysiumBlocksResource(http, network)
    this.transactions = new ElysiumTransactionsResource(http, network)
    this.logs = new ElysiumLogsResource(http, network)
    this.batches = new ElysiumBatchesResource(http, network)
    this.bridge = new ElysiumBridgeResource(http, network)
    this.tokens = new ElysiumTokensResource(http, network)
  }

  /**
   * Per-address routes (`/user/{address}/*`).
   *
   * @throws ValidationError when `address` is not a 0x-prefixed 20-byte hex address.
   */
  user(address: string): ElysiumUserResource {
    assertAddress(address, 'address')
    return new ElysiumUserResource(this.http, this.network, address)
  }
}

/**
 * Elysium, Kinetiq's L2 on Hyperliquid, indexed end to end: blocks,
 * transactions, logs, the batches it posts on HyperEVM, the bridge, tokens and
 * accounts. Only the testnet is live; mainnet routes will sit under
 * `/elysium/mainnet` with the same shapes.
 *
 * @example
 * const { data } = await client.elysium.testnet.stats.daily({ days: 7 })
 */
export class ElysiumResource {
  readonly testnet: ElysiumNetworkResource

  constructor(http: HttpClient) {
    this.testnet = new ElysiumNetworkResource(http, 'testnet')
  }
}
