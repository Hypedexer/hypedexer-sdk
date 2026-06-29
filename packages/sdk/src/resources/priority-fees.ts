import { ValidationError } from '../errors/index.js'
import { iterate } from '../pagination/iterator.js'
import { encodeTime } from '../time/index.js'
import type { HttpClient } from '../transport/HttpClient.js'
import { unwrap, unwrapSingle } from '../transport/envelopes.js'
import type { Page, Single } from '../types/common.js'
import type {
  GossipHistoryEntry,
  GossipHistoryParams,
  GossipLiveStatus,
} from '../types/priority-fees.js'

/**
 * Upper bound for `slotId` enforced server-side: the auction has 5 fixed
 * slots numbered 0..4, and passing 5 yields a 422
 * `Input should be less than or equal to 4` error. The SDK validates this
 * client-side to keep error semantics consistent with the rest of the
 * resource.
 */
const SLOT_ID_MAX = 4

function assertSlotId(value: number | undefined): void {
  if (value === undefined) return
  if (
    typeof value !== 'number' ||
    !Number.isFinite(value) ||
    !Number.isInteger(value) ||
    value < 0 ||
    value > SLOT_ID_MAX
  ) {
    throw new ValidationError(`invalid value for "slotId"`, [
      {
        msg: `value must be an integer in [0, ${SLOT_ID_MAX}]`,
        loc: ['slotId'],
        type: 'sdk_validation',
        input: value,
        ctx: { min: 0, max: SLOT_ID_MAX },
      },
    ])
  }
}

function buildHistoryQuery(
  params: GossipHistoryParams,
): Record<string, string | number | undefined> {
  const q: Record<string, string | number | undefined> = {}
  if (params.slotId !== undefined) q['slot_id'] = params.slotId
  if (params.winner !== undefined) q['winner'] = params.winner
  if (params.startTime !== undefined) {
    q['start_time'] = encodeTime(params.startTime, 'isoSnake') as string
  }
  if (params.endTime !== undefined) {
    q['end_time'] = encodeTime(params.endTime, 'isoSnake') as string
  }
  if (params.limit !== undefined) q['limit'] = params.limit
  if (params.offset !== undefined) q['offset'] = params.offset
  return q
}

/**
 * Gossip-auction priority-fees resource — `/hip3/priority-fees/gossip/*`
 * (batch-9).
 *
 * Hyperliquid's priority-fee auction has 5 fixed slots (`slotId` 0..4); each
 * auction is a brief bidding window where validators compete via `priorityGas`
 * and the highest bidder wins the right to gossip a block. Endpoints in this
 * resource expose the live status of all 5 slots plus a historical record.
 *
 * All endpoints use the standard `APIResponse<T>` envelope.
 *
 * Known issues defended by this resource:
 * - #9 — `winner` on every endpoint here is an **IPv4 string** identifying a
 *   gossip node, not a wallet. Typed and JSDoc'd as such; not renamed because
 *   `winner` is already an unambiguous label upstream. (The wallet-vs-IP
 *   rename to `nodeIp` only applies to the separate
 *   `/analytics/priority-fees/gossip/leaderboard` endpoint where the upstream
 *   field is literally called `address` and the server message claims
 *   "wallets".)
 *
 * Validation defenses:
 * - `slotId` is bounded 0..4 client-side (server returns 422 on 5+).
 */
export class PriorityFeesResource {
  constructor(private readonly http: HttpClient) {}

  /**
   * GET `/hip3/priority-fees/gossip/status` — single-record snapshot of all 5
   * auction slots plus the last winner per slot.
   *
   * `winner` on each `GossipAuction` (and entries in `previousWinners`) is an
   * IPv4 string per PLAN.md §I #9.
   *
   * @returns Single {@link GossipLiveStatus} record (apiResponse envelope).
   * @see PLAN.md §I #9
   */
  async status(): Promise<Single<GossipLiveStatus>> {
    const raw = await this.http.request<unknown>({
      path: '/hip3/priority-fees/gossip/status',
    })
    return unwrapSingle<GossipLiveStatus>(raw, 'apiResponse')
  }

  /**
   * GET `/hip3/priority-fees/gossip/history` — offset-paginated auction
   * history. Default ordering is newest-first by `snapshotTs`.
   *
   * Because the upstream table is a non-deduplicated `ReplacingMergeTree`,
   * the same `(slotId, startTime)` auction appears multiple times with
   * progressing `snapshotTs`. Use {@link dedupedHistory} to collapse to one
   * row per auction (keeping the most-recent observation).
   *
   * @param params - slotId / winner / time window / limit / offset filters.
   * @returns Page of {@link GossipHistoryEntry} rows (apiResponse envelope).
   * @throws ValidationError when `slotId` is not an integer in [0, 4].
   * @see PLAN.md §I #9
   */
  async history(params: GossipHistoryParams = {}): Promise<Page<GossipHistoryEntry>> {
    assertSlotId(params.slotId)
    const raw = await this.http.request<unknown>({
      path: '/hip3/priority-fees/gossip/history',
      query: buildHistoryQuery(params),
    })
    return unwrap<GossipHistoryEntry>(raw, 'apiResponse')
  }

  /**
   * Async iterator over `/hip3/priority-fees/gossip/history` — walks pages by
   * `offset += limit` until a partial page is returned.
   *
   * No cap is documented server-side for this endpoint; the iterator defaults
   * to `limit = 100` when none is supplied, matching the SDK's other
   * offset-paginated resources. Same client-side validation as {@link history}.
   *
   * @param params - same shape as {@link history}.
   * @returns Async iterable of {@link GossipHistoryEntry} rows.
   * @throws ValidationError when `slotId` is not an integer in [0, 4].
   */
  iterate(params: GossipHistoryParams = {}): AsyncIterable<GossipHistoryEntry> {
    assertSlotId(params.slotId)
    const limit = params.limit ?? 100
    const initial: Record<string, unknown> = { ...params, limit }
    return iterate<GossipHistoryEntry, Record<string, unknown>>(
      (p) => this.history(p as GossipHistoryParams),
      initial,
      { kind: 'offset', limit },
    )
  }

  /**
   * `history()` + client-side dedupe by `(slotId, startTime)`.
   *
   * @remarks
   * **What:** Fetches one page of `/hip3/priority-fees/gossip/history` and
   * collapses rows so each `(slotId, startTime)` pair appears once, keeping
   * the observation with the largest `snapshotTs`. The page envelope
   * (`meta`) is forwarded unchanged.
   *
   * **Why:** the upstream table is a non-deduplicated `ReplacingMergeTree`,
   * so the same auction appears multiple times with progressing
   * `snapshotTs`. Callers that just want "one row per auction" would
   * otherwise re-implement this dedupe on every consumer; the SDK does it
   * once at the boundary.
   *
   * Output order: descending by `snapshotTs` of the winning row (preserves
   * the upstream newest-first ordering on the deduped set). Purely
   * client-side — performs the same single HTTP call as {@link history},
   * then transforms the in-memory `data[]`.
   *
   * @param params - same shape as {@link history}.
   * @returns Page of deduped {@link GossipHistoryEntry} rows
   *   (apiResponse envelope, `meta` forwarded from upstream).
   * @throws ValidationError when `slotId` is not an integer in [0, 4].
   * @see PLAN.md §I #9
   */
  async dedupedHistory(params: GossipHistoryParams = {}): Promise<Page<GossipHistoryEntry>> {
    const page = await this.history(params)
    const bestBy = new Map<string, GossipHistoryEntry>()
    for (const row of page.data) {
      const key = `${row.slotId}\x00${row.startTime}`
      const prev = bestBy.get(key)
      if (prev === undefined || row.snapshotTs > prev.snapshotTs) {
        bestBy.set(key, row)
      }
    }
    const data = [...bestBy.values()].sort((a, b) => (a.snapshotTs < b.snapshotTs ? 1 : -1))
    return { data, meta: page.meta }
  }
}
