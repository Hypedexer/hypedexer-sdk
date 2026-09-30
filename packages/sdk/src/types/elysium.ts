import type { TimeInput } from '../time/index.js'
import type { Address, Hex, Wei } from './common.js'

// -----------------------------------------------------------------------------
// Enum allowlists. Upstream rejects unknown values with 422; the SDK validates
// client-side so the failure mode matches the other enum-bearing endpoints.
// -----------------------------------------------------------------------------

/** Elysium networks served under `/elysium/{network}`. Mainnet is not live yet. */
export const ELYSIUM_NETWORKS = ['testnet'] as const
export type ElysiumNetwork = (typeof ELYSIUM_NETWORKS)[number]

export const ELYSIUM_BRIDGE_DIRECTIONS = ['deposit', 'withdrawal'] as const
export type ElysiumBridgeDirection = (typeof ELYSIUM_BRIDGE_DIRECTIONS)[number]

export const ELYSIUM_BRIDGE_STATUSES = [
  'initiated',
  'ticket_created',
  'redeem_failed',
  'expired',
  'completed',
  'executed',
] as const
export type ElysiumBridgeStatus = (typeof ELYSIUM_BRIDGE_STATUSES)[number]

export const ELYSIUM_BRIDGE_ASSETS = ['native', 'token', 'message'] as const
export type ElysiumBridgeAsset = (typeof ELYSIUM_BRIDGE_ASSETS)[number]

export const ELYSIUM_BRIDGE_ROUTES = ['native', 'canonical', 'mirror'] as const
export type ElysiumBridgeRoute = (typeof ELYSIUM_BRIDGE_ROUTES)[number]

/** `/bridge/tokens` only lists token routes: the native asset has no registry entry. */
export const ELYSIUM_BRIDGE_TOKEN_ROUTES = ['canonical', 'mirror'] as const
export type ElysiumBridgeTokenRoute = (typeof ELYSIUM_BRIDGE_TOKEN_ROUTES)[number]

export const ELYSIUM_RETRYABLE_STATUSES = ['pending', 'failed', 'expired', 'redeemed'] as const
export type ElysiumRetryableStatus = (typeof ELYSIUM_RETRYABLE_STATUSES)[number]

export const ELYSIUM_TOKEN_STANDARDS = ['erc20', 'erc721', 'erc1155'] as const
export type ElysiumTokenStandard = (typeof ELYSIUM_TOKEN_STANDARDS)[number]

export const ELYSIUM_TOKEN_ORIGINS = ['native', 'canonical'] as const
export type ElysiumTokenOrigin = (typeof ELYSIUM_TOKEN_ORIGINS)[number]

// -----------------------------------------------------------------------------
// Response rows. Snake_case mirror of the wire shape. Timestamps are ISO
// without a timezone suffix and are UTC.
// -----------------------------------------------------------------------------

/** `GET /elysium/{network}/stats`. */
export interface ElysiumStats {
  readonly total_blocks: number
  readonly total_transactions: number
  /** Excludes ArbOS system, bridge-delivered and known spam transactions. */
  readonly user_transactions: number
  readonly spam_transactions: number
  readonly bridge_transactions: number
  readonly total_logs: number
  readonly unique_senders: number
  readonly contracts_created: number
  readonly first_block: number
  readonly last_block: number
  readonly first_block_time: string
  readonly last_block_time: string
  readonly last_batch_number: number
  /** Last Elysium block posted on HyperEVM. */
  readonly last_batched_block: number
}

/** One UTC day from `GET /elysium/{network}/stats/daily`. The current day is partial. */
export interface ElysiumDailyStat {
  /** `YYYY-MM-DD`, UTC. */
  readonly day: string
  readonly blocks: number
  readonly transactions: number
  readonly user_transactions: number
  readonly spam_transactions: number
  readonly bridge_transactions: number
  readonly active_addresses: number
  readonly contracts_created: number
  readonly gas_used: number
}

export interface ElysiumBlock {
  readonly block_time: string
  readonly block_number: number
  readonly block_hash: Hex
  readonly parent_hash: Hex
  readonly gas_limit: number
  readonly gas_used: number
  readonly base_fee_per_gas: number
  /** HyperEVM block the sequencer referenced. */
  readonly l1_block_number: number
  readonly tx_count: number
  readonly user_tx_count: number
}

/** `GET /elysium/{network}/blocks/{block_number}`. */
export interface ElysiumBlockDetail extends ElysiumBlock {
  /** HyperEVM batch containing the block; `null` until it is posted. */
  readonly batch_number: number | null
}

export interface ElysiumTransaction {
  readonly block_time: string
  readonly block_number: number
  readonly tx_index: number
  readonly tx_hash: Hex
  /** Hex type byte, e.g. `0x2`; ArbOS system transactions are `0x6a`. */
  readonly tx_type: string
  readonly from_addr: Address
  /** Empty string on contract creation. */
  readonly to_addr: Address | ''
  /** Set on contract creation, empty string otherwise. */
  readonly contract_address: Address | ''
  readonly value_wei: Wei
  readonly nonce: number
  readonly gas_limit: number
  readonly gas_used: number
  readonly gas_used_for_l1: number
  readonly effective_gas_price: number
  /** Coerced from wire int `0 | 1`. */
  readonly success: boolean
  readonly input_len: number
  /** First four bytes of the input, empty string for plain transfers. */
  readonly method_id: string
  /** Coerced from wire int `0 | 1`. */
  readonly is_system: boolean
  /** Coerced from wire int `0 | 1`. */
  readonly is_spam: boolean
}

export interface ElysiumLog {
  readonly block_time: string
  readonly block_number: number
  readonly tx_index: number
  readonly log_index: number
  readonly tx_hash: Hex
  readonly address: Address
  /** Absent topics are empty strings, not `null`. */
  readonly topic0: Hex | ''
  readonly topic1: Hex | ''
  readonly topic2: Hex | ''
  readonly topic3: Hex | ''
  readonly data: Hex | ''
}

export interface ElysiumTokenTransfer {
  readonly block_time: string
  readonly block_number: number
  readonly log_index: number
  /** Position inside an ERC-1155 batch transfer, 0 otherwise. */
  readonly batch_index: number
  readonly tx_hash: Hex
  readonly token: Address
  readonly standard: string
  readonly symbol: string
  readonly decimals: number
  readonly from_addr: Address
  readonly to_addr: Address
  /** ERC-721 / ERC-1155 token id, empty string for ERC-20. */
  readonly token_id: string
  /** Integer string at token scale. Use `toBigInt(value)`. */
  readonly amount_raw: string
  readonly amount: number
}

/** `GET /elysium/{network}/transactions/{tx_hash}`: receipt, logs, transfers, batch. */
export interface ElysiumTransactionDetail extends ElysiumTransaction {
  readonly batch_number: number | null
  readonly logs: readonly ElysiumLog[]
  readonly token_transfers: readonly ElysiumTokenTransfer[]
}

/** A sequencer batch posted to the SequencerInbox on HyperEVM. */
export interface ElysiumBatch {
  readonly batch_number: number
  readonly parent_block: number
  readonly parent_time: string
  readonly parent_tx_hash: Hex
  readonly after_delayed_messages_read: number
  readonly data_location: string
  readonly first_block: number
  readonly last_block: number
  readonly block_count: number
  readonly last_block_time: string
  /** HyperEVM posting time minus the time of the batch's last block. */
  readonly posting_delay_s: number
}

/**
 * A bridge transfer tracked on both chains (`l1` is HyperEVM, `l2` is Elysium).
 * Fields for the side that has not happened yet are `null` or empty strings.
 */
export interface ElysiumBridgeTransfer {
  /** `d:<message index>` for deposits, `w:<position>` for withdrawals. */
  readonly transfer_id: string
  readonly direction: ElysiumBridgeDirection
  readonly asset: ElysiumBridgeAsset
  readonly route: ElysiumBridgeRoute
  readonly status: ElysiumBridgeStatus
  readonly l1_token: Address | ''
  readonly l2_token: Address | ''
  readonly symbol: string
  readonly decimals: number
  readonly from_addr: Address
  readonly to_addr: Address
  readonly amount_raw: string
  readonly amount: number
  readonly message_index: number | null
  readonly position: number | null
  readonly ticket_id: Hex | ''
  readonly redeem_status: string
  readonly l1_tx_hash: Hex | ''
  readonly l1_block: number | null
  readonly l1_time: string | null
  readonly l2_tx_hash: Hex | ''
  readonly l2_block: number | null
  readonly l2_time: string | null
  readonly l2_redeem_tx_hash: Hex | ''
  readonly initiated_time: string
  readonly completed_time: string | null
  readonly duration_s: number | null
}

export interface ElysiumBridgeToken {
  readonly l2_token: Address
  readonly l1_token: Address
  readonly route: ElysiumBridgeTokenRoute
  readonly symbol: string
  readonly name: string
  readonly decimals: number
  readonly bridge_wallet: Address | ''
  readonly deposits: number
  readonly withdrawals: number
  readonly last_transfer_time: string | null
}

/** One row of the latest reserves snapshot (taken every 15 minutes). */
export interface ElysiumBridgeReserve {
  readonly snapshot_time: string
  readonly route: ElysiumBridgeRoute
  readonly l1_token: Address | ''
  readonly l2_token: Address | ''
  readonly symbol: string
  readonly decimals: number
  readonly escrow: Address | ''
  readonly locked_raw: string
  readonly supply_raw: string
  readonly locked: number
  readonly supply: number
  /** `true` when what is locked on HyperEVM covers the supply on Elysium. */
  readonly backed: boolean
}

export interface ElysiumToken {
  readonly address: Address
  readonly standard: ElysiumTokenStandard
  readonly name: string
  readonly symbol: string
  readonly decimals: number
  readonly origin: ElysiumTokenOrigin
  /** HyperEVM address for bridged tokens, empty string otherwise. */
  readonly l1_address: Address | ''
  readonly bridge_wallet: Address | ''
  readonly first_block: number
  readonly first_seen: string
  readonly transfer_count: number
}

export interface ElysiumTokenDetail extends ElysiumToken {
  /** ERC-20: minted minus burned, at token scale. */
  readonly total_supply_raw: string
  readonly total_supply: number
  readonly holders: number
  readonly last_transfer_time: string | null
}

export interface ElysiumTokenHolder {
  readonly address: Address
  /** ERC-721 / ERC-1155: number of tokens held. */
  readonly balance_raw: string
  readonly balance: number
  /** Share of the supply, 0..1. */
  readonly share: number
}

export interface ElysiumTokenBalance {
  readonly token: Address
  readonly standard: ElysiumTokenStandard
  readonly symbol: string
  readonly name: string
  readonly decimals: number
  readonly balance_raw: string
  readonly balance: number
}

/** Native HYPE from the archive node, token balances rebuilt from Transfer events. */
export interface ElysiumUserBalances {
  readonly address: Address
  /** The block the balances were read at, `null` for the latest. */
  readonly block: number | null
  readonly native_balance_wei: Wei
  readonly native_balance: number
  readonly tokens: readonly ElysiumTokenBalance[]
}

/** One entry of an address's activity feed, newest first. */
export interface ElysiumUserActivity {
  readonly time: string
  readonly block_number: number
  readonly tx_hash: Hex
  /** e.g. `transaction`, `token_transfer`, `bridge`. */
  readonly kind: string
  /** `in` or `out` relative to the address. */
  readonly direction: string
  readonly counterparty: Address | ''
  readonly token: Address | ''
  readonly symbol: string
  readonly amount_raw: string
  readonly amount: number
  /** Method id, token id or bridge status, depending on `kind`. */
  readonly detail: string
}

// -----------------------------------------------------------------------------
// Request params. camelCase on the SDK side, mapped to snake_case on the wire.
// -----------------------------------------------------------------------------

interface ElysiumPageParams {
  /** 1..1000, rejected client-side above the cap. */
  readonly limit?: number
  readonly offset?: number
}

interface ElysiumTimeWindow {
  readonly startTime?: TimeInput
  readonly endTime?: TimeInput
}

export interface ElysiumStatsDailyParams {
  /** 1..365, default 30 upstream. */
  readonly days?: number
}

export interface ElysiumBlocksParams extends ElysiumPageParams, ElysiumTimeWindow {
  readonly startBlock?: number
  readonly endBlock?: number
}

export interface ElysiumTransactionsParams extends ElysiumPageParams, ElysiumTimeWindow {
  readonly blockNumber?: number
  readonly fromAddr?: string
  readonly toAddr?: string
  readonly methodId?: string
  readonly txType?: string
  /** Default `true` upstream. Pass `false` to drop ArbOS system transactions. */
  readonly includeSystem?: boolean
  /** Default `true` upstream. Pass `false` to drop known spam. */
  readonly includeSpam?: boolean
}

export interface ElysiumLogsParams extends ElysiumPageParams, ElysiumTimeWindow {
  readonly blockNumber?: number
  readonly address?: string
  readonly topic0?: string
  readonly txHash?: string
}

export interface ElysiumBatchesParams extends ElysiumPageParams, ElysiumTimeWindow {}

export interface ElysiumBridgeTransfersParams extends ElysiumPageParams, ElysiumTimeWindow {
  readonly address?: string
  readonly direction?: ElysiumBridgeDirection
  readonly status?: ElysiumBridgeStatus
  readonly asset?: ElysiumBridgeAsset
  readonly route?: ElysiumBridgeRoute
  readonly token?: string
  /** Include message-only transfers (no value). Default `false` upstream. */
  readonly includeMessages?: boolean
}

export interface ElysiumRetryablesParams extends ElysiumPageParams, ElysiumTimeWindow {
  readonly status?: ElysiumRetryableStatus
  readonly address?: string
}

export interface ElysiumBridgeTokensParams extends ElysiumPageParams {
  readonly route?: ElysiumBridgeTokenRoute
}

export interface ElysiumBridgeReservesParams {
  readonly route?: ElysiumBridgeRoute
  readonly onlyUnbacked?: boolean
}

export interface ElysiumTokensParams extends ElysiumPageParams {
  readonly standard?: ElysiumTokenStandard
  readonly origin?: ElysiumTokenOrigin
  /** Matches name, symbol or address. */
  readonly search?: string
}

export interface ElysiumTokenHoldersParams extends ElysiumPageParams {}

export interface ElysiumTokenTransfersParams extends ElysiumPageParams, ElysiumTimeWindow {
  readonly holder?: string
}

export interface ElysiumUserBalancesParams {
  /** Read balances at a past block. */
  readonly block?: number
}

export interface ElysiumUserActivityParams extends ElysiumPageParams, ElysiumTimeWindow {}

export interface ElysiumUserBridgeParams extends ElysiumPageParams, ElysiumTimeWindow {
  readonly direction?: ElysiumBridgeDirection
  readonly status?: ElysiumBridgeStatus
  readonly includeMessages?: boolean
}
