import { assertAddress } from '../internal/address.js'
import { assertLimit, assertOptionalEnum } from '../internal/assert.js'
import { joinPath } from '../internal/url.js'
import { iterate } from '../pagination/iterator.js'
import { encodeTime } from '../time/index.js'
import type { HttpClient } from '../transport/HttpClient.js'
import { unwrap, unwrapSingle } from '../transport/envelopes.js'
import type { Page, Single } from '../types/common.js'
import {
  EVM_BRIDGE_EVENT_TYPES,
  EVM_LEDGER_ACTION_TYPES,
  EVM_USER_LEDGER_EVENT_TYPES,
  type EvmBackstopFill,
  type EvmBackstopFillsParams,
  type EvmBackstopHealth,
  type EvmBackstopTransfer,
  type EvmBackstopTransfersParams,
  type EvmBackstopTransfersSummary,
  type EvmBlock,
  type EvmBlockTransactionsParams,
  type EvmBlocksParams,
  type EvmBridgeEvent,
  type EvmBridgeEventsParams,
  type EvmDailyStat,
  type EvmLedgerTransfer,
  type EvmLedgerTransfersParams,
  type EvmLog,
  type EvmLogsParams,
  type EvmStats,
  type EvmStatsDailyParams,
  type EvmTransaction,
  type EvmTransactionsParams,
  type EvmUserLedgerEvent,
  type EvmUserLedgerEventsParams,
  type EvmUserLedgerSummaryRow,
} from '../types/evm.js'

// -----------------------------------------------------------------------------
// Per-endpoint caps — server-enforced 422 above these values (batch-8).
// -----------------------------------------------------------------------------

const EVM_LIMIT_CAP = 1000
const EVM_STATS_DAILY_DAYS_CAP = 365

type Query = Record<string, string | number | boolean | null | undefined>

// -----------------------------------------------------------------------------
// Wire-shape boundary helpers.
//
// EVM rows ship a handful of fields that must be normalized before reaching
// the typed model:
//   - `success` / `is_system_tx` / `is_liquidation` arrive as wire ints `0|1`
//     and are coerced to `boolean` (PLAN.md §F.4).
//   - `/evm/transactions` rows have empty `tx_hash` / `from_addr` (PLAN.md §I
//     bug #10); the SDK derives a stable `tx_key = "<block_number>:<tx_index>"`
//     so callers have an id to chain on.
// -----------------------------------------------------------------------------

interface RawEvmTransaction extends Omit<EvmTransaction, 'success' | 'is_system_tx' | 'tx_key'> {
  readonly success: number | boolean
  readonly is_system_tx: number | boolean
}

interface RawEvmBackstopFill extends Omit<EvmBackstopFill, 'is_liquidation'> {
  readonly is_liquidation: number | boolean
}

/**
 * Coerce a wire-int `0 | 1` (or already-boolean) into a strict `boolean`.
 *
 * @remarks
 * EVM rows ship boolean-shaped fields as integers (PLAN.md §F.4). The
 * accepting-boolean branch is defensive for any future server change.
 */
function coerceBool(value: unknown): boolean {
  if (typeof value === 'boolean') return value
  if (typeof value === 'number') return value !== 0
  return Boolean(value)
}

/**
 * Normalize a raw `/evm/transactions` row at the wire-shape boundary.
 *
 * @remarks
 * **What:**
 * - Coerces `success` / `is_system_tx` from wire-int `0 | 1` to `boolean`
 *   (PLAN.md §F.4).
 * - Synthesizes `tx_key = "<block_number>:<tx_index>"` as a stable identifier.
 *
 * **Why:** PLAN.md §I bug #10 — upstream `tx_hash` and `from_addr` are
 * empty strings on every row, so callers have no usable id to chain on.
 * `(block_number, tx_index)` uniquely identifies a transaction even when
 * the hash is missing.
 *
 * @see PLAN.md §I #10 §F.4
 */
function normalizeTransaction(row: RawEvmTransaction): EvmTransaction {
  return {
    ...row,
    success: coerceBool(row.success),
    is_system_tx: coerceBool(row.is_system_tx),
    tx_key: `${row.block_number}:${row.tx_index}`,
  }
}

/**
 * Normalize a raw `/evm/hip3/backstop/{dex}/fills` row by coercing the
 * wire-int `is_liquidation` (`0 | 1`) into a strict `boolean` (PLAN.md §F.4).
 */
function normalizeBackstopFill(row: RawEvmBackstopFill): EvmBackstopFill {
  return {
    ...row,
    is_liquidation: coerceBool(row.is_liquidation),
  }
}

/**
 * Append `start_time` / `end_time` ISO-snake query params to `q`.
 *
 * EVM endpoints accept `epoch_ms` here too but silently ignore it (PLAN.md §I
 * bug #21), so the SDK always emits ISO `Z` via `encodeTime(..., 'isoSnake')`.
 */
function applyTimeWindow(q: Query, startTime: unknown, endTime: unknown): void {
  if (startTime !== undefined) {
    q['start_time'] = encodeTime(startTime as Parameters<typeof encodeTime>[0], 'isoSnake')
  }
  if (endTime !== undefined) {
    q['end_time'] = encodeTime(endTime as Parameters<typeof encodeTime>[0], 'isoSnake')
  }
}

// -----------------------------------------------------------------------------
// blocks sub-resource — /evm/blocks, /evm/blocks/{block_number}, .transactions
// -----------------------------------------------------------------------------

/**
 * `/evm/blocks/*` sub-resource: offset-paginated block list, by-number getter,
 * and the per-block transactions list.
 *
 * The 404 on unknown block (`{detail: string}`) propagates as
 * {@link NotFoundError} via the transport's `parseError`.
 */
export class EvmBlocksResource {
  constructor(private readonly http: HttpClient) {}

  /**
   * `GET /evm/blocks` — offset pagination, `limit` 1..1000.
   *
   * @param params - block / time window / limit / offset filters.
   * @returns Page of {@link EvmBlock} rows (apiResponse envelope).
   * @throws ValidationError when `limit > 1000`.
   * @see PLAN.md §I #21
   */
  async list(params: EvmBlocksParams = {}): Promise<Page<EvmBlock>> {
    assertLimit(params.limit, EVM_LIMIT_CAP)
    const query: Query = {}
    if (params.startBlock !== undefined) query['start_block'] = params.startBlock
    if (params.endBlock !== undefined) query['end_block'] = params.endBlock
    if (params.limit !== undefined) query['limit'] = params.limit
    if (params.offset !== undefined) query['offset'] = params.offset
    applyTimeWindow(query, params.startTime, params.endTime)
    const raw = await this.http.request<unknown>({ path: '/evm/blocks', query })
    return unwrap<EvmBlock>(raw, 'apiResponse')
  }

  /** Async iterator over `/evm/blocks` (offset pagination). */
  iterate(params: EvmBlocksParams = {}): AsyncIterable<EvmBlock> {
    assertLimit(params.limit, EVM_LIMIT_CAP)
    return iterate<EvmBlock, EvmBlocksParams & Record<string, unknown>>(
      (p) => this.list(p),
      { ...params },
      { kind: 'offset' },
    )
  }

  /**
   * `GET /evm/blocks/{block_number}` — single block by number. Upstream
   * returns `404 {detail: string}` on unknown number; the transport maps that
   * to {@link NotFoundError}.
   *
   * @param blockNumber - the numeric block height.
   * @returns Single {@link EvmBlock} record (apiResponse envelope).
   * @throws NotFoundError when the block number is unknown.
   */
  async get(blockNumber: number): Promise<Single<EvmBlock>> {
    const raw = await this.http.request<unknown>({
      path: joinPath('evm', 'blocks', String(blockNumber)),
    })
    return unwrapSingle<EvmBlock>(raw, 'apiResponse')
  }

  /**
   * `GET /evm/blocks/{block_number}/transactions` — offset pagination,
   * `limit` 1..1000. Returns the {@link EvmTransaction} rows for a single
   * block (same shape as the firehose `/evm/transactions`, including the
   * synthesized `tx_key` and boolean `success` / `is_system_tx`).
   *
   * @param blockNumber - the numeric block height.
   * @param params - limit / offset filters.
   * @returns Page of {@link EvmTransaction} rows (apiResponse envelope).
   * @throws ValidationError when `limit > 1000`.
   * @see PLAN.md §I #10 §F.4
   */
  async transactions(
    blockNumber: number,
    params: EvmBlockTransactionsParams = {},
  ): Promise<Page<EvmTransaction>> {
    assertLimit(params.limit, EVM_LIMIT_CAP)
    const query: Query = {}
    if (params.limit !== undefined) query['limit'] = params.limit
    if (params.offset !== undefined) query['offset'] = params.offset
    const raw = await this.http.request<unknown>({
      path: joinPath('evm', 'blocks', String(blockNumber), 'transactions'),
      query,
    })
    const page = unwrap<RawEvmTransaction>(raw, 'apiResponse')
    return { data: page.data.map(normalizeTransaction), meta: page.meta }
  }

  /**
   * Async iterator over `/evm/blocks/{block_number}/transactions` (offset
   * pagination).
   */
  iterateTransactions(
    blockNumber: number,
    params: EvmBlockTransactionsParams = {},
  ): AsyncIterable<EvmTransaction> {
    assertLimit(params.limit, EVM_LIMIT_CAP)
    return iterate<EvmTransaction, EvmBlockTransactionsParams & Record<string, unknown>>(
      (p) => this.transactions(blockNumber, p),
      { ...params },
      { kind: 'offset' },
    )
  }
}

// -----------------------------------------------------------------------------
// transactions sub-resource — /evm/transactions
// -----------------------------------------------------------------------------

/**
 * `/evm/transactions` sub-resource: offset pagination, ISO time window.
 *
 * Defends:
 * - PLAN.md §I bug #10 — `tx_hash` / `from_addr` are empty strings; SDK adds
 *   the derived `tx_key = "<block_number>:<tx_index>"` field.
 * - PLAN.md §I bug #21 — epoch-ms time filters are silently ignored upstream;
 *   SDK always emits ISO `Z` via `encodeTime(..., 'isoSnake')`.
 * - PLAN.md §F.4 — `success` / `is_system_tx` wire-int `0|1` coerced to boolean.
 */
export class EvmTransactionsResource {
  constructor(private readonly http: HttpClient) {}

  /**
   * `GET /evm/transactions` — offset pagination, `limit` 1..1000.
   *
   * @param params - toAddr / blockNumber / includeSystem / time window /
   *   limit / offset filters.
   * @returns Page of {@link EvmTransaction} rows with synthesized `tx_key`
   *   (apiResponse envelope).
   * @throws ValidationError when `limit > 1000`.
   * @see PLAN.md §I #10 #21 §F.4
   */
  async list(params: EvmTransactionsParams = {}): Promise<Page<EvmTransaction>> {
    assertLimit(params.limit, EVM_LIMIT_CAP)
    const query: Query = {}
    if (params.toAddr !== undefined) query['to_addr'] = params.toAddr
    if (params.blockNumber !== undefined) query['block_number'] = params.blockNumber
    if (params.includeSystem !== undefined) query['include_system'] = params.includeSystem
    if (params.limit !== undefined) query['limit'] = params.limit
    if (params.offset !== undefined) query['offset'] = params.offset
    applyTimeWindow(query, params.startTime, params.endTime)
    const raw = await this.http.request<unknown>({ path: '/evm/transactions', query })
    const page = unwrap<RawEvmTransaction>(raw, 'apiResponse')
    return { data: page.data.map(normalizeTransaction), meta: page.meta }
  }

  /** Async iterator over `/evm/transactions` (offset pagination). */
  iterate(params: EvmTransactionsParams = {}): AsyncIterable<EvmTransaction> {
    assertLimit(params.limit, EVM_LIMIT_CAP)
    return iterate<EvmTransaction, EvmTransactionsParams & Record<string, unknown>>(
      (p) => this.list(p),
      { ...params },
      { kind: 'offset' },
    )
  }
}

// -----------------------------------------------------------------------------
// logs sub-resource — /evm/logs
// -----------------------------------------------------------------------------

/** `/evm/logs` sub-resource: offset pagination, ISO time window. */
export class EvmLogsResource {
  constructor(private readonly http: HttpClient) {}

  /**
   * `GET /evm/logs` — offset pagination, `limit` 1..1000.
   *
   * @param params - address / topic0 / blockNumber / time window /
   *   limit / offset filters.
   * @returns Page of {@link EvmLog} rows (apiResponse envelope).
   * @throws ValidationError when `limit > 1000`.
   * @see PLAN.md §I #21
   */
  async list(params: EvmLogsParams = {}): Promise<Page<EvmLog>> {
    assertLimit(params.limit, EVM_LIMIT_CAP)
    const query: Query = {}
    if (params.address !== undefined) query['address'] = params.address
    if (params.topic0 !== undefined) query['topic0'] = params.topic0
    if (params.blockNumber !== undefined) query['block_number'] = params.blockNumber
    if (params.limit !== undefined) query['limit'] = params.limit
    if (params.offset !== undefined) query['offset'] = params.offset
    applyTimeWindow(query, params.startTime, params.endTime)
    const raw = await this.http.request<unknown>({ path: '/evm/logs', query })
    return unwrap<EvmLog>(raw, 'apiResponse')
  }

  /** Async iterator over `/evm/logs` (offset pagination). */
  iterate(params: EvmLogsParams = {}): AsyncIterable<EvmLog> {
    assertLimit(params.limit, EVM_LIMIT_CAP)
    return iterate<EvmLog, EvmLogsParams & Record<string, unknown>>(
      (p) => this.list(p),
      { ...params },
      { kind: 'offset' },
    )
  }
}

// -----------------------------------------------------------------------------
// transfers sub-resource — /evm/ledger/transfers
// -----------------------------------------------------------------------------

/**
 * `/evm/ledger/transfers` sub-resource: offset pagination, ISO time window.
 *
 * Defends PLAN.md §I bug #5 — `action_type` is silently fall-back upstream;
 * SDK rejects unknown values client-side via {@link EVM_LEDGER_ACTION_TYPES}.
 */
export class EvmTransfersResource {
  constructor(private readonly http: HttpClient) {}

  /**
   * `GET /evm/ledger/transfers` — offset pagination, `limit` 1..1000.
   *
   * @param params - actionType / token / user / time window / limit / offset filters.
   * @returns Page of {@link EvmLedgerTransfer} rows (apiResponse envelope).
   * @throws ValidationError when `actionType` is unknown, `user` invalid,
   *   or `limit > 1000`.
   * @see PLAN.md §I #5 #21
   */
  async list(params: EvmLedgerTransfersParams = {}): Promise<Page<EvmLedgerTransfer>> {
    assertOptionalEnum(params.actionType, EVM_LEDGER_ACTION_TYPES, 'actionType')
    if (params.user !== undefined) assertAddress(params.user, 'user')
    assertLimit(params.limit, EVM_LIMIT_CAP)
    const query: Query = {}
    if (params.actionType !== undefined) query['action_type'] = params.actionType
    if (params.token !== undefined) query['token'] = params.token
    if (params.user !== undefined) query['user'] = params.user
    if (params.limit !== undefined) query['limit'] = params.limit
    if (params.offset !== undefined) query['offset'] = params.offset
    applyTimeWindow(query, params.startTime, params.endTime)
    const raw = await this.http.request<unknown>({
      path: '/evm/ledger/transfers',
      query,
    })
    return unwrap<EvmLedgerTransfer>(raw, 'apiResponse')
  }

  /** Async iterator over `/evm/ledger/transfers` (offset pagination). */
  iterate(params: EvmLedgerTransfersParams = {}): AsyncIterable<EvmLedgerTransfer> {
    assertOptionalEnum(params.actionType, EVM_LEDGER_ACTION_TYPES, 'actionType')
    if (params.user !== undefined) assertAddress(params.user, 'user')
    assertLimit(params.limit, EVM_LIMIT_CAP)
    return iterate<EvmLedgerTransfer, EvmLedgerTransfersParams & Record<string, unknown>>(
      (p) => this.list(p),
      { ...params },
      { kind: 'offset' },
    )
  }
}

// -----------------------------------------------------------------------------
// bridge sub-resource — /evm/bridge/events
// -----------------------------------------------------------------------------

/** `/evm/bridge/events` sub-namespace, exposed as `evm.bridge.events.list/iterate`. */
export class EvmBridgeEventsResource {
  constructor(private readonly http: HttpClient) {}

  /**
   * `GET /evm/bridge/events` — offset pagination, `limit` 1..1000.
   *
   * Defends PLAN.md §I bug #5: `event_type` is silently fall-back upstream;
   * SDK rejects unknown values via {@link EVM_BRIDGE_EVENT_TYPES}.
   *
   * @param params - eventType / user / time window / limit / offset filters.
   * @returns Page of {@link EvmBridgeEvent} rows (apiResponse envelope).
   * @throws ValidationError when `eventType` is unknown, `user` invalid,
   *   or `limit > 1000`.
   * @see PLAN.md §I #5 #21
   */
  async list(params: EvmBridgeEventsParams = {}): Promise<Page<EvmBridgeEvent>> {
    assertOptionalEnum(params.eventType, EVM_BRIDGE_EVENT_TYPES, 'eventType')
    if (params.user !== undefined) assertAddress(params.user, 'user')
    assertLimit(params.limit, EVM_LIMIT_CAP)
    const query: Query = {}
    if (params.eventType !== undefined) query['event_type'] = params.eventType
    if (params.user !== undefined) query['user'] = params.user
    if (params.limit !== undefined) query['limit'] = params.limit
    if (params.offset !== undefined) query['offset'] = params.offset
    applyTimeWindow(query, params.startTime, params.endTime)
    const raw = await this.http.request<unknown>({
      path: '/evm/bridge/events',
      query,
    })
    return unwrap<EvmBridgeEvent>(raw, 'apiResponse')
  }

  /** Async iterator over `/evm/bridge/events` (offset pagination). */
  iterate(params: EvmBridgeEventsParams = {}): AsyncIterable<EvmBridgeEvent> {
    assertOptionalEnum(params.eventType, EVM_BRIDGE_EVENT_TYPES, 'eventType')
    if (params.user !== undefined) assertAddress(params.user, 'user')
    assertLimit(params.limit, EVM_LIMIT_CAP)
    return iterate<EvmBridgeEvent, EvmBridgeEventsParams & Record<string, unknown>>(
      (p) => this.list(p),
      { ...params },
      { kind: 'offset' },
    )
  }
}

/** Top-level `evm.bridge.*` namespace — currently holds only `events`. */
export class EvmBridgeResource {
  readonly events: EvmBridgeEventsResource

  constructor(http: HttpClient) {
    this.events = new EvmBridgeEventsResource(http)
  }
}

// -----------------------------------------------------------------------------
// stats sub-resource — /evm/stats, /evm/stats/daily
// -----------------------------------------------------------------------------

/** `/evm/stats/*` sub-resource: single overview + daily series. */
export class EvmStatsResource {
  constructor(private readonly http: HttpClient) {}

  /**
   * `GET /evm/stats` — single aggregate stats record.
   *
   * @returns Single {@link EvmStats} record (apiResponse envelope).
   */
  async get(): Promise<Single<EvmStats>> {
    const raw = await this.http.request<unknown>({ path: '/evm/stats' })
    return unwrapSingle<EvmStats>(raw, 'apiResponse')
  }

  /**
   * `GET /evm/stats/daily` — none-list of per-day stats. `days` is capped at
   * 365 client-side (server 422 above that). Default 30 server-side.
   *
   * @param params - optional `days` window (1..365).
   * @returns Page of {@link EvmDailyStat} rows (apiResponse envelope, none-list).
   * @throws ValidationError when `days > 365`.
   */
  async daily(params: EvmStatsDailyParams = {}): Promise<Page<EvmDailyStat>> {
    assertLimit(params.days, EVM_STATS_DAILY_DAYS_CAP, 'days')
    const query: Query = {}
    if (params.days !== undefined) query['days'] = params.days
    const raw = await this.http.request<unknown>({ path: '/evm/stats/daily', query })
    return unwrap<EvmDailyStat>(raw, 'apiResponse')
  }
}

// -----------------------------------------------------------------------------
// user(address) — scoped sub-resource factory
// -----------------------------------------------------------------------------

/** `/evm/user/{address}/ledger-events` — offset pagination, ISO time window. */
export class EvmUserLedgerEventsResource {
  constructor(
    private readonly http: HttpClient,
    private readonly address: string,
  ) {}

  /**
   * `GET /evm/user/{address}/ledger-events` — offset pagination, `limit` 1..1000.
   *
   * @param params - eventType / token / time window / limit / offset filters.
   * @returns Page of {@link EvmUserLedgerEvent} rows (apiResponse envelope).
   * @throws ValidationError when `eventType` is unknown or `limit > 1000`.
   * @see PLAN.md §I #5 #21
   */
  async list(params: EvmUserLedgerEventsParams = {}): Promise<Page<EvmUserLedgerEvent>> {
    assertOptionalEnum(params.eventType, EVM_USER_LEDGER_EVENT_TYPES, 'eventType')
    assertLimit(params.limit, EVM_LIMIT_CAP)
    const query: Query = {}
    if (params.eventType !== undefined) query['event_type'] = params.eventType
    if (params.token !== undefined) query['token'] = params.token
    if (params.limit !== undefined) query['limit'] = params.limit
    if (params.offset !== undefined) query['offset'] = params.offset
    applyTimeWindow(query, params.startTime, params.endTime)
    const raw = await this.http.request<unknown>({
      path: joinPath('evm', 'user', this.address, 'ledger-events'),
      query,
    })
    return unwrap<EvmUserLedgerEvent>(raw, 'apiResponse')
  }

  /** Async iterator over `/evm/user/{address}/ledger-events` (offset pagination). */
  iterate(params: EvmUserLedgerEventsParams = {}): AsyncIterable<EvmUserLedgerEvent> {
    assertOptionalEnum(params.eventType, EVM_USER_LEDGER_EVENT_TYPES, 'eventType')
    assertLimit(params.limit, EVM_LIMIT_CAP)
    return iterate<EvmUserLedgerEvent, EvmUserLedgerEventsParams & Record<string, unknown>>(
      (p) => this.list(p),
      { ...params },
      { kind: 'offset' },
    )
  }
}

/**
 * Namespace wrapper for `evm.user(addr).ledger.*` so future ledger sub-rows
 * can be grouped together (matches the hip3 user/coins/fills nesting).
 */
export class EvmUserLedgerResource {
  readonly events: EvmUserLedgerEventsResource

  constructor(http: HttpClient, address: string) {
    this.events = new EvmUserLedgerEventsResource(http, address)
  }
}

/**
 * Per-user EVM sub-resource returned by {@link EvmResource.user}. The
 * address is validated at the factory call site, so all methods on this
 * class trust the address (no re-validation).
 */
export class EvmUserResource {
  readonly ledger: EvmUserLedgerResource

  constructor(
    private readonly http: HttpClient,
    private readonly address: string,
  ) {
    this.ledger = new EvmUserLedgerResource(http, address)
  }

  /**
   * `GET /evm/user/{address}/ledger-summary` — none-list of per-action_type
   * aggregates for this user (`{action_type, count, total_amount, tokens[]}`).
   *
   * Returned as a {@link Page} (none-list family — no pagination), one row per
   * action_type seen for this user.
   *
   * @returns Page of {@link EvmUserLedgerSummaryRow} rows (apiResponse envelope).
   */
  async overview(): Promise<Page<EvmUserLedgerSummaryRow>> {
    const raw = await this.http.request<unknown>({
      path: joinPath('evm', 'user', this.address, 'ledger-summary'),
    })
    return unwrap<EvmUserLedgerSummaryRow>(raw, 'apiResponse')
  }
}

// -----------------------------------------------------------------------------
// hip3.backstop.* sub-resources
// -----------------------------------------------------------------------------

/**
 * `/evm/hip3/backstop/health` and `/{dex}/health` sub-resource. `list` returns
 * only dexes with observed backstop activity (subset of all live dexes); the
 * single-getter 404s with `{detail: string}` on unknown dex.
 */
export class EvmHip3BackstopHealthResource {
  constructor(private readonly http: HttpClient) {}

  /**
   * `GET /evm/hip3/backstop/health` — none-list, no pagination.
   *
   * @returns Page of {@link EvmBackstopHealth} rows (apiResponse envelope, none-list).
   */
  async list(): Promise<Page<EvmBackstopHealth>> {
    const raw = await this.http.request<unknown>({
      path: '/evm/hip3/backstop/health',
    })
    return unwrap<EvmBackstopHealth>(raw, 'apiResponse')
  }

  /**
   * `GET /evm/hip3/backstop/{dex}/health` — single record by dex.
   *
   * Upstream returns `404 {detail: string}` for unknown dex; the transport
   * maps that to {@link NotFoundError}.
   *
   * @param dex - the dex id (URL-encoded via {@link joinPath}).
   * @returns Single {@link EvmBackstopHealth} record (apiResponse envelope).
   * @throws NotFoundError when the dex is unknown.
   */
  async get(dex: string): Promise<Single<EvmBackstopHealth>> {
    const raw = await this.http.request<unknown>({
      path: joinPath('evm', 'hip3', 'backstop', dex, 'health'),
    })
    return unwrapSingle<EvmBackstopHealth>(raw, 'apiResponse')
  }
}

/**
 * `/evm/hip3/backstop/transfers` + `/transfers-summary` sub-resource. Empty
 * across all observed data today.
 */
export class EvmHip3BackstopTransfersResource {
  constructor(private readonly http: HttpClient) {}

  /**
   * `GET /evm/hip3/backstop/transfers` — offset pagination, `limit` 1..1000.
   *
   * @param params - dex / isDeposit / limit / offset filters.
   * @returns Page of {@link EvmBackstopTransfer} rows (apiResponse envelope).
   * @throws ValidationError when `limit > 1000`.
   */
  async list(params: EvmBackstopTransfersParams = {}): Promise<Page<EvmBackstopTransfer>> {
    assertLimit(params.limit, EVM_LIMIT_CAP)
    const query: Query = {}
    if (params.dex !== undefined) query['dex'] = params.dex
    if (params.isDeposit !== undefined) query['is_deposit'] = params.isDeposit
    if (params.limit !== undefined) query['limit'] = params.limit
    if (params.offset !== undefined) query['offset'] = params.offset
    const raw = await this.http.request<unknown>({
      path: '/evm/hip3/backstop/transfers',
      query,
    })
    return unwrap<EvmBackstopTransfer>(raw, 'apiResponse')
  }

  /** Async iterator over `/evm/hip3/backstop/transfers` (offset pagination). */
  iterate(params: EvmBackstopTransfersParams = {}): AsyncIterable<EvmBackstopTransfer> {
    assertLimit(params.limit, EVM_LIMIT_CAP)
    return iterate<EvmBackstopTransfer, EvmBackstopTransfersParams & Record<string, unknown>>(
      (p) => this.list(p),
      { ...params },
      { kind: 'offset' },
    )
  }

  /**
   * `GET /evm/hip3/backstop/transfers-summary` — none-list, no pagination.
   *
   * @returns Page of {@link EvmBackstopTransfersSummary} rows
   *   (apiResponse envelope, none-list).
   */
  async summary(): Promise<Page<EvmBackstopTransfersSummary>> {
    const raw = await this.http.request<unknown>({
      path: '/evm/hip3/backstop/transfers-summary',
    })
    return unwrap<EvmBackstopTransfersSummary>(raw, 'apiResponse')
  }
}

/**
 * Per-dex backstop fills sub-resource returned by
 * {@link EvmHip3BackstopResource.fills}. Unknown dex returns an empty 200
 * (inconsistent with `/health`'s 404 — documented but not normalized).
 */
export class EvmHip3BackstopDexFillsResource {
  constructor(
    private readonly http: HttpClient,
    private readonly dex: string,
  ) {}

  /**
   * `GET /evm/hip3/backstop/{dex}/fills` — offset pagination, `limit` 1..1000.
   *
   * @param params - coin / time window / limit / offset filters.
   * @returns Page of {@link EvmBackstopFill} rows with `is_liquidation`
   *   coerced to boolean (apiResponse envelope).
   * @throws ValidationError when `limit > 1000`.
   * @see PLAN.md §F.4 §I #21
   */
  async list(params: EvmBackstopFillsParams = {}): Promise<Page<EvmBackstopFill>> {
    assertLimit(params.limit, EVM_LIMIT_CAP)
    const query: Query = {}
    if (params.coin !== undefined) query['coin'] = params.coin
    if (params.limit !== undefined) query['limit'] = params.limit
    if (params.offset !== undefined) query['offset'] = params.offset
    applyTimeWindow(query, params.startTime, params.endTime)
    const raw = await this.http.request<unknown>({
      path: joinPath('evm', 'hip3', 'backstop', this.dex, 'fills'),
      query,
    })
    const page = unwrap<RawEvmBackstopFill>(raw, 'apiResponse')
    return { data: page.data.map(normalizeBackstopFill), meta: page.meta }
  }

  /** Async iterator over `/evm/hip3/backstop/{dex}/fills` (offset pagination). */
  iterate(params: EvmBackstopFillsParams = {}): AsyncIterable<EvmBackstopFill> {
    assertLimit(params.limit, EVM_LIMIT_CAP)
    return iterate<EvmBackstopFill, EvmBackstopFillsParams & Record<string, unknown>>(
      (p) => this.list(p),
      { ...params },
      { kind: 'offset' },
    )
  }
}

/** `/evm/hip3/backstop/*` namespace. */
export class EvmHip3BackstopResource {
  readonly health: EvmHip3BackstopHealthResource
  readonly transfers: EvmHip3BackstopTransfersResource

  constructor(private readonly http: HttpClient) {
    this.health = new EvmHip3BackstopHealthResource(http)
    this.transfers = new EvmHip3BackstopTransfersResource(http)
  }

  /**
   * Per-dex backstop fills sub-resource (`/evm/hip3/backstop/{dex}/fills`).
   * Returns a freshly-bound {@link EvmHip3BackstopDexFillsResource}.
   */
  fills(dex: string): EvmHip3BackstopDexFillsResource {
    return new EvmHip3BackstopDexFillsResource(this.http, dex)
  }
}

/** `/evm/hip3/*` namespace — currently holds only `backstop`. */
export class EvmHip3Resource {
  readonly backstop: EvmHip3BackstopResource

  constructor(http: HttpClient) {
    this.backstop = new EvmHip3BackstopResource(http)
  }
}

// -----------------------------------------------------------------------------
// top-level EvmResource
// -----------------------------------------------------------------------------

/**
 * `/evm/*` resource (batch-8) — every endpoint uses the `apiResponse`
 * envelope and offset-only pagination (no cursor).
 *
 * Sub-namespaces:
 * - `blocks` — list / iterate / get / per-block transactions
 * - `transactions` — global transactions list / iterate
 * - `logs` — list / iterate
 * - `transfers` — `/evm/ledger/transfers` list / iterate
 * - `bridge.events` — `/evm/bridge/events` list / iterate
 * - `stats` — single overview + daily series (365-day cap)
 * - `user(address)` — `overview` (= ledger-summary) + `ledger.events.*`
 * - `hip3.backstop` — `health.list/get`, `transfers.list/iterate/summary`,
 *   `fills(dex).list/iterate`
 *
 * Bugs defended client-side (PLAN.md §I):
 * - #5 — silent enum fall-backs on `transfers.action_type` and
 *   `bridge.events.event_type`; SDK rejects unknown values via
 *   {@link EVM_LEDGER_ACTION_TYPES} / {@link EVM_BRIDGE_EVENT_TYPES}.
 * - #10 — `/evm/transactions` empty `tx_hash` / `from_addr`; SDK exposes the
 *   derived `tx_key = "<block_number>:<tx_index>"` field.
 * - #21 — `/evm/transactions` silently ignores `epoch_ms`; SDK always emits
 *   ISO `Z` via `encodeTime(..., 'isoSnake')`.
 *
 * Numeric encoding (PLAN.md §F):
 * - F.2 — `value_wei` (transactions) and `amount_raw` (ledger transfers /
 *   user ledger events) are bigint-class strings (Wei). Use `toBigInt(value)`.
 * - F.4 — `success`, `is_system_tx`, `is_liquidation` arrive as wire-int
 *   `0 | 1` and are coerced to `boolean` at the response boundary.
 */
export class EvmResource {
  readonly blocks: EvmBlocksResource
  readonly transactions: EvmTransactionsResource
  readonly logs: EvmLogsResource
  readonly transfers: EvmTransfersResource
  readonly bridge: EvmBridgeResource
  readonly stats: EvmStatsResource
  readonly hip3: EvmHip3Resource

  constructor(private readonly http: HttpClient) {
    this.blocks = new EvmBlocksResource(http)
    this.transactions = new EvmTransactionsResource(http)
    this.logs = new EvmLogsResource(http)
    this.transfers = new EvmTransfersResource(http)
    this.bridge = new EvmBridgeResource(http)
    this.stats = new EvmStatsResource(http)
    this.hip3 = new EvmHip3Resource(http)
  }

  /**
   * Per-user EVM sub-resource for `address`. The address is validated
   * client-side at this call site; the returned {@link EvmUserResource}
   * trusts the bound address.
   */
  user(address: string): EvmUserResource {
    assertAddress(address, 'address')
    return new EvmUserResource(this.http, address)
  }
}
