import type { TimeInput } from '../time/index.js'
import type { Address, Hex } from './common.js'

/**
 * Epoch-millisecond integer. Use `parseTimestamp(value, 'epochMs')` to obtain a
 * `Date`. Sentinel `0` collapses to `null` per PLAN.md §E.
 */
export type EpochMs = number

/** Bare `YYYY-MM-DD` string. Use `parseTimestamp(value, 'date')` to get UTC midnight. */
export type DateOnly = string

// -----------------------------------------------------------------------------
// Response models
// -----------------------------------------------------------------------------

/**
 * Row from `/vaults/vaultSummaries`. Default server-side sort is
 * `followerCount desc` (batch-7 exploration; not guaranteed by the API).
 *
 * Field names mirror the upstream wire shape (camelCase) — vault endpoints
 * speak camelCase, unlike the snake_case `/fills/*` family.
 */
export interface VaultSummary {
  readonly vaultAddress: Address
  readonly name: string
  readonly leader: Address
  /** Leader take of follower PnL, in `[0, 1]`. */
  readonly leaderCommission: number
  readonly isClosed: boolean
  readonly followerCount: number
  /** Epoch ms — last metadata refresh time. */
  readonly snapshotTime: EpochMs
  /** Epoch ms — vault creation time. */
  readonly createTime: EpochMs
}

/**
 * `/vaults/vaultDetails` payload. Strict superset of {@link VaultSummary} plus
 * configuration fields and `leaderCommissionHistory`.
 *
 * Note: the upstream field is named `portfolio[]` but the rows are leader
 * commission history snapshots (`{time, followerCount, leaderCommission}`),
 * **not** open positions. Renamed in the typed model per PLAN.md §I bug #24.
 */
export interface VaultDetails extends VaultSummary {
  readonly lockupDurationSeconds: number
  readonly allowDeposits: boolean
  /**
   * Renamed from upstream `portfolio[]` — actually a history of
   * `{time, followerCount, leaderCommission}` snapshots, NOT positions.
   * See PLAN.md §I bug #24.
   *
   * `startTime` / `endTime` request params filter this array (the main vault
   * meta is always returned regardless).
   */
  readonly leaderCommissionHistory: ReadonlyArray<{
    readonly time: EpochMs
    readonly followerCount: number
    readonly leaderCommission: number
  }>
}

/**
 * One row from `/vaults/dailySnapshots` — one snapshot per UTC day.
 *
 * Strict superset of {@link VaultEquitySnapshot}; adds `day` (ISO `YYYY-MM-DD`).
 */
export interface VaultDailySnapshot {
  /** Epoch ms — exact server time of the snapshot. */
  readonly time: EpochMs
  /** ISO `YYYY-MM-DD` UTC bucket date. */
  readonly day: DateOnly
  readonly totalDeposits: number
  readonly accountValue: number
  readonly totalNotional: number
  readonly totalRawPnl: number
  readonly nPositions: number
  readonly followerCount: number
}

/**
 * One row from `/vaults/equitySnapshots` — higher-frequency raw series
 * (~hourly) than {@link VaultDailySnapshot}; no `day` bucket field.
 */
export interface VaultEquitySnapshot {
  /** Epoch ms. */
  readonly time: EpochMs
  readonly totalDeposits: number
  readonly accountValue: number
  readonly totalNotional: number
  readonly totalRawPnl: number
  readonly nPositions: number
  readonly followerCount: number
}

/**
 * One row from `/vaults/vaultLedger`. The wire shape lacks a `kind` field;
 * the SDK synthesizes one by comparing `userTo` to the requested
 * `vaultAddress` (case-insensitive): `userTo === vaultAddress` is a deposit,
 * everything else is a withdraw. See PLAN.md §I bug #25.
 */
export interface VaultLedgerTx {
  /** Epoch ms. */
  readonly time: EpochMs
  readonly txHash: Hex
  readonly userFrom: Address
  readonly userTo: Address
  readonly amount: number
  /** Always `'USDC'` in current data; widened to `string` to absorb future tokens. */
  readonly token: 'USDC' | string
  /** SDK-synthesized — `'deposit'` when `userTo === vaultAddress`, else `'withdraw'`. */
  readonly kind: 'deposit' | 'withdraw'
}

/**
 * `/vaults/userVaultEquities` row. Empty for every tested user during
 * exploration (batch-7), so this shape is a placeholder derived from
 * swagger / sibling endpoints; field set may drift once a known HLP
 * follower address is sampled.
 */
export interface UserVaultEquity {
  readonly vaultAddress: Address
  readonly equity: string
  readonly lockedUntil?: EpochMs
}

// -----------------------------------------------------------------------------
// Request params
// -----------------------------------------------------------------------------

export interface VaultDetailsParams {
  readonly vaultAddress: Address
  /** Filters the `leaderCommissionHistory[]` time range (epoch-ms wire). */
  readonly startTime?: TimeInput
  /** Filters the `leaderCommissionHistory[]` time range (epoch-ms wire). */
  readonly endTime?: TimeInput
}

export interface VaultSummariesParams {
  /** 1..5000 — rejected client-side above the cap. */
  readonly limit?: number
  /** Offset for pagination (defaults to 0). */
  readonly offset?: number
  /** When true, the response includes closed vaults. */
  readonly includeClosed?: boolean
}

export interface VaultSnapshotsParams {
  readonly vaultAddress: Address
  readonly startTime?: TimeInput
  readonly endTime?: TimeInput
  /** 1..5000 — rejected client-side above the cap. */
  readonly limit?: number
}

export interface VaultLedgerParams {
  readonly vaultAddress: Address
  /** Optional filter to one funder's transactions. */
  readonly user?: Address
  readonly startTime?: TimeInput
  readonly endTime?: TimeInput
  /** 1..5000 — rejected client-side above the cap. */
  readonly limit?: number
}

export interface UserVaultEquitiesParams {
  readonly user: Address
}
