import type { TimeInput } from '../time/index.js'

/**
 * ISO timestamp string carried verbatim from the upstream JSON.
 *
 * `/hip3/priority-fees/gossip/*` emits ISO with no timezone suffix at
 * second-precision (e.g. `"2026-05-02T05:42:13"`). Use
 * `parseTimestamp(value, 'iso')` to convert — the helper assumes UTC for
 * un-suffixed strings.
 */
export type GossipIsoTimestamp = string

/**
 * One slot of the live gossip auction (5 fixed slots: `slotId` 0..4).
 *
 * `winner` is an **IPv4 string** identifying the gossip node (not a wallet) —
 * see PLAN.md §I bug #9. It is `null` when the slot has no live winner yet.
 * `endGas` is `null` while the auction is live and is filled in once settled.
 */
export interface GossipAuction {
  /** Slot index 0..4. */
  readonly slotId: number
  /** Auction start time, ISO at second-precision without TZ. */
  readonly startTime: GossipIsoTimestamp
  readonly durationSeconds: number
  readonly startGas: number
  readonly currentGas: number | null
  /** `null` while the auction is still live. */
  readonly endGas: number | null
  /** IPv4 string of the current/last winning node (PLAN.md §I #9). `null` if none yet. */
  readonly winner: string | null
  /** Last server-side update of the auction row. */
  readonly lastUpdate: GossipIsoTimestamp
}

/**
 * Snapshot returned by `GET /hip3/priority-fees/gossip/status`.
 *
 * `previousWinners` is a 5-tuple aligned to `slotId` 0..4 — entries are IPv4
 * strings (or `null` if a slot had no prior winner). `currentAuctions` always
 * has 5 entries, one per slot.
 */
export interface GossipLiveStatus {
  /** 5-tuple aligned to slot 0..4. Each entry is an IPv4 string or `null`. */
  readonly previousWinners: ReadonlyArray<string | null>
  readonly currentAuctions: ReadonlyArray<GossipAuction>
}

/**
 * One row of `GET /hip3/priority-fees/gossip/history`.
 *
 * Because the upstream table is a ClickHouse `ReplacingMergeTree` that is
 * NOT deduplicated at read time, the same `(slotId, startTime)` pair appears
 * multiple times — once per snapshot — with progressing `snapshotTs`. Use
 * `PriorityFeesResource.dedupedHistory()` to collapse to one row per auction.
 *
 * `winner` is an **IPv4 string** (PLAN.md §I bug #9), or `null` when an
 * auction has no winner. `endGas` is `null` while the auction is still live.
 */
export interface GossipHistoryEntry {
  /** Slot index 0..4. */
  readonly slotId: number
  /** Auction start time, ISO at second-precision without TZ. */
  readonly startTime: GossipIsoTimestamp
  readonly durationSeconds: number
  readonly startGas: number
  /** `null` while the auction is still live. */
  readonly endGas: number | null
  /** IPv4 string (PLAN.md §I #9). `null` if no winner observed at snapshot. */
  readonly winner: string | null
  /** Server-side snapshot timestamp — newest first by default. */
  readonly snapshotTs: GossipIsoTimestamp
}

// ---------------------------------------------------------------------------
// Request parameter types
// ---------------------------------------------------------------------------

/**
 * Query parameters for `GET /hip3/priority-fees/gossip/history`.
 *
 * `slotId` is bounded 0..4 server-side: passing 5 yields a 422
 * `less_than_equal` error. The SDK validates this client-side.
 *
 * `winner` is an IPv4 string filter. Wallet-style values are syntactically
 * accepted by the server but always return zero rows.
 */
export interface GossipHistoryParams {
  /** 0..4 inclusive. The server returns 422 when this is >= 5. */
  readonly slotId?: number
  /** IPv4 string. Empty result when no match (PLAN.md §I #9). */
  readonly winner?: string
  readonly startTime?: TimeInput
  readonly endTime?: TimeInput
  readonly limit?: number
  readonly offset?: number
}
