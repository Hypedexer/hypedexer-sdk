import type { TimeInput } from '../time/index.js'
import type { Address, Coin, Hex, Side, Wei } from './common.js'

// -----------------------------------------------------------------------------
// Enum allowlists (silently-falling-back upstream — SDK validates client-side)
// -----------------------------------------------------------------------------

/**
 * Allowed `action_type` values for `/evm/ledger/transfers`.
 *
 * **PLAN.md §I bug #5**: server silently returns an empty list on unknown
 * `action_type` instead of 422. The SDK validates against this allowlist
 * before sending — see {@link EvmResource}.
 */
export const EVM_LEDGER_ACTION_TYPES = ['usdSend', 'spotSend', 'subAccount'] as const

/**
 * Allowed `action_type` literal union for `/evm/ledger/transfers`.
 */
export type EvmLedgerActionType = (typeof EVM_LEDGER_ACTION_TYPES)[number]

/**
 * Allowed `event_type` values for `/evm/bridge/events`.
 *
 * **PLAN.md §I bug #5**: server silently returns an empty list on unknown
 * `event_type` instead of 422. The SDK validates against this allowlist
 * before sending.
 */
export const EVM_BRIDGE_EVENT_TYPES = ['withdrawal_finalized', 'deposit_vote', 'withdraw3'] as const

/**
 * Allowed `event_type` literal union for `/evm/bridge/events`.
 */
export type EvmBridgeEventType = (typeof EVM_BRIDGE_EVENT_TYPES)[number]

/**
 * Allowed `event_type` values for `/evm/user/{address}/ledger-events`.
 *
 * Strictly enforced upstream (422 on unknown values). SDK still validates
 * client-side so the failure mode is identical across enum-bearing endpoints.
 */
export const EVM_USER_LEDGER_EVENT_TYPES = [
  'deposit',
  'withdrawal',
  'transfer_in',
  'transfer_out',
  'class_transfer',
  'sub_account',
  'vault',
  'agent_send',
] as const

/**
 * Allowed `event_type` literal union for `/evm/user/{address}/ledger-events`.
 */
export type EvmUserLedgerEventType = (typeof EVM_USER_LEDGER_EVENT_TYPES)[number]

// -----------------------------------------------------------------------------
// Response rows — snake_case wire shape mirror.
// -----------------------------------------------------------------------------

/**
 * Aggregate stats from `GET /evm/stats` (apiResponse, single).
 *
 * Field names mirror the upstream snake_case wire shape. ISO timestamps have
 * no timezone suffix — use `parseTimestamp(value, 'iso')` to obtain a `Date`.
 */
export interface EvmStats {
  readonly total_blocks: number
  readonly total_transactions: number
  readonly total_logs: number
  readonly first_block: number
  readonly last_block: number
  /** ISO no TZ, second precision. */
  readonly first_block_time: string
  /** ISO no TZ, second precision. */
  readonly last_block_time: string
}

/**
 * One daily stat row from `GET /evm/stats/daily` (apiResponse, none-list).
 */
export interface EvmDailyStat {
  /** Bare `YYYY-MM-DD` UTC date. */
  readonly day: string
  readonly blocks: number
  readonly transactions: number
  readonly system_txs: number
  readonly gas_used: number
}

/**
 * One block row from `GET /evm/blocks` and `GET /evm/blocks/{block_number}`.
 */
export interface EvmBlock {
  /** ISO no TZ, second precision. */
  readonly block_time: string
  readonly block_number: number
  readonly block_hash: Hex
  readonly parent_hash: Hex
  readonly gas_limit: number
  readonly gas_used: number
  readonly base_fee_per_gas: number
  readonly tx_count: number
  readonly system_tx_count: number
}

/**
 * Observed `tx_type` literal. Treated as an open string union for forward-compat.
 */
export type EvmTxType = 'Eip1559' | (string & {})

/**
 * One transaction row from `GET /evm/transactions` and
 * `GET /evm/blocks/{block_number}/transactions`.
 *
 * **PLAN.md §I bug #10**: `tx_hash` and `from_addr` are empty strings (`""`)
 * in every observed row today. Typed as `string` (not optional) but callers
 * should treat them as unavailable. The SDK exposes a synthesized
 * {@link EvmTransaction.tx_key} (`"<block_number>:<tx_index>"`) as a stable
 * identifier in the meantime.
 *
 * **PLAN.md §F.4**: `success` and `is_system_tx` are wire-encoded as `0 | 1`.
 * The SDK coerces them to `boolean` at the response boundary.
 *
 * **PLAN.md §F.2**: `value_wei` is a bigint-class string. Use `toBigInt(value)`
 * to convert.
 */
export interface EvmTransaction {
  /** ISO no TZ, second precision. */
  readonly block_time: string
  readonly block_number: number
  readonly tx_index: number
  /** PLAN.md §I bug #10 — empty string `""` in every observed row. */
  readonly tx_hash: Hex | ''
  readonly tx_type: EvmTxType
  /** PLAN.md §I bug #10 — empty string `""` in every observed row. */
  readonly from_addr: Address | ''
  readonly to_addr: Address
  /** PLAN.md §F.2 — bigint-class string (Wei). Use `toBigInt(value)`. */
  readonly value_wei: Wei
  readonly gas_limit: number
  readonly gas_used: number
  /** PLAN.md §F.4 — coerced from wire int `0 | 1`. */
  readonly success: boolean
  readonly input_len: number
  /** PLAN.md §F.4 — coerced from wire int `0 | 1`. */
  readonly is_system_tx: boolean
  /**
   * Synthesized stable id: `` `${block_number}:${tx_index}` ``. The SDK
   * derives this client-side because upstream `tx_hash` is empty
   * (PLAN.md §I bug #10).
   */
  readonly tx_key: string
}

/**
 * One log row from `GET /evm/logs`.
 *
 * Absent topics are returned as empty strings (`""`), not `null`.
 */
export interface EvmLog {
  /** ISO no TZ, second precision. */
  readonly block_time: string
  readonly block_number: number
  readonly tx_index: number
  readonly log_index: number
  readonly address: Address
  readonly topic0: Hex
  readonly topic1: Hex | ''
  readonly topic2: Hex | ''
  readonly topic3: Hex | ''
  /** Raw hex-prefixed data blob. */
  readonly data: Hex
}

/**
 * One row from `GET /evm/ledger/transfers`.
 *
 * **PLAN.md §F.2**: `amount_raw` is a bigint-class string. Use `toBigInt(value)`.
 *
 * **PLAN.md §I bug #5**: `action_type` is silently fall-back upstream — SDK
 * validates against {@link EVM_LEDGER_ACTION_TYPES}.
 *
 * Note: `block_height` is always `0` in current samples (placeholder upstream).
 */
export interface EvmLedgerTransfer {
  /** ISO no TZ, microsecond precision. */
  readonly time: string
  /** Always `0` in current samples (upstream placeholder). */
  readonly block_height: number
  readonly tx_hash: Hex
  readonly action_type: EvmLedgerActionType
  readonly user_from: Address
  readonly user_to: Address
  /** `"USDC"`, `"HYPE"`, or `"SYM:0x<32hex>"` for HIP-1/spot tokens. */
  readonly token: string
  /** PLAN.md §F.2 — bigint-class string (Wei). Use `toBigInt(value)`. */
  readonly amount_raw: Wei
  readonly amount: number
  readonly source_dex: string | null
  readonly destination_dex: string | null
}

/**
 * One row from `GET /evm/bridge/events`.
 *
 * **PLAN.md §I bug #5**: `event_type` is silently fall-back upstream — SDK
 * validates against {@link EVM_BRIDGE_EVENT_TYPES}.
 *
 * `validator` is empty string `""` for `withdraw3`. `raw` is a JSON string for
 * `withdrawal_finalized` / `deposit_vote` and empty string for `withdraw3`.
 * `nonce` magnitude can reach ~1.78 × 10^15 (int53-edge; still safe per
 * PLAN.md §F.3).
 */
export interface EvmBridgeEvent {
  /** ISO no TZ, microsecond precision. */
  readonly time: string
  /** Always `0` in current samples (upstream placeholder). */
  readonly block_height: number
  readonly event_type: EvmBridgeEventType
  readonly user_addr: Address
  readonly validator: Address | ''
  readonly amount: number
  readonly destination: string
  readonly nonce: number
  /** JSON string for `withdrawal_finalized` / `deposit_vote`; `""` for `withdraw3`. */
  readonly raw: string
}

/**
 * One row from `GET /evm/user/{address}/ledger-events`.
 *
 * **PLAN.md §F.2**: `amount_raw` is a bigint-class string. Use `toBigInt(value)`.
 */
export interface EvmUserLedgerEvent {
  /** ISO no TZ, microsecond precision. */
  readonly time: string
  readonly event_type: EvmUserLedgerEventType
  readonly counterparty: Address | ''
  readonly token: string
  readonly amount: number
  /** PLAN.md §F.2 — bigint-class string (Wei). Use `toBigInt(value)`. */
  readonly amount_raw: Wei
  readonly tx_hash: Hex
  readonly source_dex: string | null
  readonly destination_dex: string | null
}

/**
 * One aggregated row from `GET /evm/user/{address}/ledger-summary`. The
 * upstream payload is a flat array — one row per action_type seen for the user.
 */
export interface EvmUserLedgerSummaryRow {
  readonly action_type: string
  readonly count: number
  readonly total_amount: number
  /** All token identifiers (including `SYM:0x<32hex>` forms) seen for this action. */
  readonly tokens: ReadonlyArray<string>
}

/**
 * One row from `GET /evm/hip3/backstop/health` and the response from
 * `GET /evm/hip3/backstop/{dex}/health`.
 *
 * Only dexes that have observed backstop fills appear. `backstop_address`
 * follows the pattern `0x40…00 + dex_index`.
 */
export interface EvmBackstopHealth {
  readonly dex_id: string
  readonly backstop_address: Address
  readonly dex_index: number
  readonly principal_deposited_usdc: number
  readonly principal_withdrawn_usdc: number
  readonly net_principal_usdc: number
  readonly fill_count: number
  readonly notional_traded: number
  readonly fees_paid: number
  readonly fills_last_24h: number
  /** ISO no TZ, microsecond precision. */
  readonly last_fill_time: string
  readonly coins_active: number
  /** ISO no TZ, microsecond precision. */
  readonly first_fill_time: string
}

/**
 * One simplified backstop fill row from `GET /evm/hip3/backstop/{dex}/fills`.
 *
 * Smaller surface than the perp {@link Fill} — only the backstop-relevant
 * fields. `is_liquidation` is wire-int `0 | 1` upstream; SDK coerces to
 * boolean (PLAN.md §F.4).
 */
export interface EvmBackstopFill {
  /** ISO no TZ, microsecond precision. */
  readonly time: string
  readonly dex_id: string
  /** `<dex_id>:<TICKER>` prefixed form (e.g. `"km:SMALL2000"`). */
  readonly coin: Coin
  readonly side: Side
  readonly px: number
  readonly sz: number
  readonly notional: number
  readonly fee: number
  /** PLAN.md §F.4 — coerced from wire int `0 | 1`. */
  readonly is_liquidation: boolean
  readonly hash: Hex
}

/**
 * One row from `GET /evm/hip3/backstop/transfers`. Empty across all observed
 * data today — fields inferred from swagger.
 */
export interface EvmBackstopTransfer {
  /** ISO no TZ, microsecond precision. */
  readonly time: string
  readonly dex_id: string
  readonly is_deposit: boolean
  readonly signer: Address
  readonly amount: number
}

/**
 * One aggregated row from `GET /evm/hip3/backstop/transfers-summary`. Empty
 * across all observed data today.
 */
export interface EvmBackstopTransfersSummary {
  readonly dex_id: string
  readonly total_deposited_usdc: number
  readonly total_withdrawn_usdc: number
  readonly net_principal_usdc: number
  readonly transfer_count: number
}

// -----------------------------------------------------------------------------
// Request parameter types.
// -----------------------------------------------------------------------------

/**
 * Params for `GET /evm/stats/daily`. `days` is capped at 365 client-side
 * (server-enforced).
 */
export interface EvmStatsDailyParams {
  /** 1..365 — rejected client-side above the cap. Default 30 server-side. */
  readonly days?: number
}

/**
 * Params for `GET /evm/blocks`. Offset pagination, `limit` capped at 1000.
 */
export interface EvmBlocksParams {
  /** Inclusive lower bound. */
  readonly startBlock?: number
  /** Inclusive upper bound. */
  readonly endBlock?: number
  readonly startTime?: TimeInput
  readonly endTime?: TimeInput
  /** 1..1000 — rejected client-side above the cap. */
  readonly limit?: number
  readonly offset?: number
}

/**
 * Params for `GET /evm/blocks/{block_number}/transactions`. Offset pagination
 * within a single block, `limit` capped at 1000.
 */
export interface EvmBlockTransactionsParams {
  /** 1..1000 — rejected client-side above the cap. */
  readonly limit?: number
  readonly offset?: number
}

/**
 * Params for `GET /evm/transactions`. Offset pagination, `limit` capped at 1000.
 *
 * **PLAN.md §I bug #21**: `epoch_ms` time filters are silently accepted but
 * ignored. The SDK always emits ISO `Z` via `encodeTime(value, 'isoSnake')`.
 */
export interface EvmTransactionsParams {
  readonly toAddr?: Address
  readonly blockNumber?: number
  readonly includeSystem?: boolean
  readonly startTime?: TimeInput
  readonly endTime?: TimeInput
  /** 1..1000 — rejected client-side above the cap. */
  readonly limit?: number
  readonly offset?: number
}

/**
 * Params for `GET /evm/logs`. Offset pagination, `limit` capped at 1000.
 */
export interface EvmLogsParams {
  readonly address?: Address
  readonly topic0?: Hex
  readonly blockNumber?: number
  readonly startTime?: TimeInput
  readonly endTime?: TimeInput
  /** 1..1000 — rejected client-side above the cap. */
  readonly limit?: number
  readonly offset?: number
}

/**
 * Params for `GET /evm/ledger/transfers`. Offset pagination, `limit` capped
 * at 1000.
 *
 * **PLAN.md §I bug #5**: `actionType` is silently fall-back upstream — the SDK
 * validates against {@link EVM_LEDGER_ACTION_TYPES} before sending.
 */
export interface EvmLedgerTransfersParams {
  readonly actionType?: EvmLedgerActionType
  readonly token?: string
  readonly user?: Address
  readonly startTime?: TimeInput
  readonly endTime?: TimeInput
  /** 1..1000 — rejected client-side above the cap. */
  readonly limit?: number
  readonly offset?: number
}

/**
 * Params for `GET /evm/bridge/events`. Offset pagination, `limit` capped at 1000.
 *
 * **PLAN.md §I bug #5**: `eventType` is silently fall-back upstream — the SDK
 * validates against {@link EVM_BRIDGE_EVENT_TYPES} before sending.
 */
export interface EvmBridgeEventsParams {
  readonly eventType?: EvmBridgeEventType
  readonly user?: Address
  readonly startTime?: TimeInput
  readonly endTime?: TimeInput
  /** 1..1000 — rejected client-side above the cap. */
  readonly limit?: number
  readonly offset?: number
}

/**
 * Params for `GET /evm/user/{address}/ledger-events`. Offset pagination,
 * `limit` capped at 1000. `eventType` is server-enforced strictly; SDK still
 * validates against {@link EVM_USER_LEDGER_EVENT_TYPES} for parity.
 */
export interface EvmUserLedgerEventsParams {
  readonly eventType?: EvmUserLedgerEventType
  readonly token?: string
  readonly startTime?: TimeInput
  readonly endTime?: TimeInput
  /** 1..1000 — rejected client-side above the cap. */
  readonly limit?: number
  readonly offset?: number
}

/**
 * Params for `GET /evm/hip3/backstop/transfers`. Offset pagination, `limit`
 * capped at 1000.
 */
export interface EvmBackstopTransfersParams {
  readonly dex?: string
  readonly isDeposit?: boolean
  /** 1..1000 — rejected client-side above the cap. */
  readonly limit?: number
  readonly offset?: number
}

/**
 * Params for `GET /evm/hip3/backstop/{dex}/fills`. Offset pagination, `limit`
 * capped at 1000.
 */
export interface EvmBackstopFillsParams {
  readonly coin?: Coin
  readonly startTime?: TimeInput
  readonly endTime?: TimeInput
  /** 1..1000 — rejected client-side above the cap. */
  readonly limit?: number
  readonly offset?: number
}
