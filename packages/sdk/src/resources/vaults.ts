import { assertAddress } from '../internal/address.js'
import { assertLimit } from '../internal/assert.js'
import { iterate } from '../pagination/iterator.js'
import { encodeTime } from '../time/index.js'
import type { HttpClient } from '../transport/HttpClient.js'
import { unwrap, unwrapSingle } from '../transport/envelopes.js'
import type { Page, Single } from '../types/common.js'
import type {
  UserVaultEquitiesParams,
  UserVaultEquity,
  VaultDailySnapshot,
  VaultDetails,
  VaultDetailsParams,
  VaultEquitySnapshot,
  VaultLedgerParams,
  VaultLedgerTx,
  VaultSnapshotsParams,
  VaultSummariesParams,
  VaultSummary,
} from '../types/vault.js'

/** Server cap on `/vaults/vaultSummaries`, `/vaults/dailySnapshots`,
 *  `/vaults/equitySnapshots`, and `/vaults/vaultLedger` (batch-7). */
const VAULTS_LIMIT_CAP = 5000

type Query = Record<string, string | number | boolean | null | undefined>

/**
 * Raw `/vaults/vaultDetails` payload — the upstream `portfolio[]` field is
 * leader-commission history (PLAN.md §I bug #24), not positions. We unwrap
 * to this raw shape first, then map to {@link VaultDetails}.
 */
interface RawVaultDetails extends Omit<VaultDetails, 'leaderCommissionHistory'> {
  readonly portfolio?: ReadonlyArray<{
    readonly time: number
    readonly followerCount: number
    readonly leaderCommission: number
  }>
}

/** Raw ledger row from upstream (no `kind` — SDK synthesizes one). */
interface RawVaultLedgerTx {
  readonly time: number
  readonly txHash: string
  readonly userFrom: string
  readonly userTo: string
  readonly amount: number
  readonly token: string
}

function buildSummariesQuery(params: VaultSummariesParams): Query {
  const q: Query = {}
  if (params.limit !== undefined) q['limit'] = params.limit
  if (params.offset !== undefined) q['offset'] = params.offset
  if (params.includeClosed !== undefined) q['includeClosed'] = params.includeClosed
  return q
}

function buildDetailsQuery(params: VaultDetailsParams): Query {
  const q: Query = { vaultAddress: params.vaultAddress }
  if (params.startTime !== undefined) q['startTime'] = encodeTime(params.startTime, 'epochCamel')
  if (params.endTime !== undefined) q['endTime'] = encodeTime(params.endTime, 'epochCamel')
  return q
}

function buildSnapshotsQuery(params: VaultSnapshotsParams): Query {
  const q: Query = { vaultAddress: params.vaultAddress }
  if (params.startTime !== undefined) q['startTime'] = encodeTime(params.startTime, 'epochCamel')
  if (params.endTime !== undefined) q['endTime'] = encodeTime(params.endTime, 'epochCamel')
  if (params.limit !== undefined) q['limit'] = params.limit
  return q
}

function buildLedgerQuery(params: VaultLedgerParams): Query {
  const q: Query = { vaultAddress: params.vaultAddress }
  if (params.user !== undefined) q['user'] = params.user
  if (params.startTime !== undefined) q['startTime'] = encodeTime(params.startTime, 'epochCamel')
  if (params.endTime !== undefined) q['endTime'] = encodeTime(params.endTime, 'epochCamel')
  if (params.limit !== undefined) q['limit'] = params.limit
  return q
}

function buildUserVaultEquitiesQuery(params: UserVaultEquitiesParams): Query {
  return { user: params.user }
}

/**
 * Map the upstream `/vaults/vaultDetails` shape into the SDK's typed model.
 *
 * @remarks
 * **What:** Renames the upstream `portfolio[]` field to `leaderCommissionHistory`.
 *
 * **Why:** PLAN.md §I bug #24 — `portfolio[]` is misleadingly named: the rows
 * are leader-commission samples (`time`, `followerCount`, `leaderCommission`),
 * not vault positions. Renaming at the SDK boundary stops callers from
 * mistaking the data for a position list.
 *
 * @see PLAN.md §I #24
 */
function mapDetails(raw: RawVaultDetails): VaultDetails {
  const { portfolio, ...rest } = raw
  return {
    ...rest,
    leaderCommissionHistory: portfolio ?? [],
  }
}

/**
 * Resource client for the `/vaults/*` endpoints (batch-7).
 *
 * Envelope family: **bare** — every endpoint returns the raw model directly
 * (a JSON array for lists, a JSON object for `vaultDetails`). Wire field
 * names are camelCase; time params and response `time` fields are epoch-ms
 * integers.
 *
 * Known issues defended by this resource:
 * - #24 — `vaultDetails.portfolio[]` is leader-commission history, not
 *   positions. Renamed to `leaderCommissionHistory` on the typed model.
 * - #25 — `vaultLedger` rows lack a `kind` field. The SDK synthesizes
 *   `kind: 'deposit' | 'withdraw'` by comparing `userTo` to the requested
 *   `vaultAddress` (case-insensitive) per PLAN.md §I.
 *
 * Vault REST returns a 404 with string `detail` when `vaultAddress` does not
 * exist (e.g. zero address) — the transport's {@link parseError} maps this
 * to {@link NotFoundError} automatically.
 */
export class VaultsResource {
  constructor(private readonly http: HttpClient) {}

  /**
   * GET `/vaults/vaultSummaries` — offset-paginated list of vault summaries.
   *
   * Default sort is `followerCount desc` (empirically). `includeClosed: true`
   * surfaces closed vaults in the response.
   *
   * @param params - limit / offset / includeClosed filters.
   * @returns Page of {@link VaultSummary} rows (bare envelope).
   * @throws ValidationError when `limit > 5000`.
   */
  async list(params: VaultSummariesParams = {}): Promise<Page<VaultSummary>> {
    assertLimit(params.limit, VAULTS_LIMIT_CAP)
    const raw = await this.http.request<unknown>({
      path: '/vaults/vaultSummaries',
      query: buildSummariesQuery(params),
    })
    return unwrap<VaultSummary>(raw, 'bare')
  }

  /** Async iterator over `/vaults/vaultSummaries` — offset pagination. */
  iterate(params: VaultSummariesParams = {}): AsyncIterable<VaultSummary> {
    assertLimit(params.limit, VAULTS_LIMIT_CAP)
    const limit = params.limit ?? 500
    const initial: Record<string, unknown> = { ...params, limit }
    return iterate<VaultSummary, Record<string, unknown>>(
      (p) => this.list(p as VaultSummariesParams),
      initial,
      { kind: 'offset', limit },
    )
  }

  /**
   * GET `/vaults/vaultDetails?vaultAddress=...` — single vault detail.
   *
   * @remarks
   * Upstream `portfolio[]` is renamed to `leaderCommissionHistory` on the
   * typed model (PLAN.md §I bug #24); see {@link mapDetails}.
   *
   * @param params - required `vaultAddress`, optional time window.
   * @returns Single {@link VaultDetails} record (bare envelope).
   * @throws ValidationError when `vaultAddress` is not a valid address.
   * @throws NotFoundError when the vault is unknown.
   * @see PLAN.md §I #24
   */
  async details(params: VaultDetailsParams): Promise<Single<VaultDetails>> {
    assertAddress(params.vaultAddress, 'vaultAddress')
    const raw = await this.http.request<unknown>({
      path: '/vaults/vaultDetails',
      query: buildDetailsQuery(params),
    })
    const single = unwrapSingle<RawVaultDetails>(raw, 'bare')
    return { data: mapDetails(single.data), meta: single.meta }
  }

  /**
   * GET `/vaults/dailySnapshots?vaultAddress=...` — one snapshot per UTC day.
   * Time-window paginated (offset is not supported by the server); use
   * {@link iterateDailySnapshots} to walk the full history.
   *
   * @param params - required `vaultAddress`, optional time window / limit.
   * @returns Page of {@link VaultDailySnapshot} rows (bare envelope).
   * @throws ValidationError when `vaultAddress` invalid or `limit > 5000`.
   * @throws NotFoundError when the vault is unknown.
   */
  async dailySnapshots(params: VaultSnapshotsParams): Promise<Page<VaultDailySnapshot>> {
    assertAddress(params.vaultAddress, 'vaultAddress')
    assertLimit(params.limit, VAULTS_LIMIT_CAP)
    const raw = await this.http.request<unknown>({
      path: '/vaults/dailySnapshots',
      query: buildSnapshotsQuery(params),
    })
    return unwrap<VaultDailySnapshot>(raw, 'bare')
  }

  /**
   * Async iterator over `/vaults/dailySnapshots` — walks backwards by
   * decrementing `endTime` to the oldest row's `time - 1` per page.
   */
  iterateDailySnapshots(params: VaultSnapshotsParams): AsyncIterable<VaultDailySnapshot> {
    assertAddress(params.vaultAddress, 'vaultAddress')
    assertLimit(params.limit, VAULTS_LIMIT_CAP)
    return iterate<VaultDailySnapshot, Record<string, unknown>>(
      (p) => this.dailySnapshots(p as unknown as VaultSnapshotsParams),
      params as unknown as Record<string, unknown>,
      { kind: 'timeWindow', timeKey: 'time' },
    )
  }

  /**
   * GET `/vaults/equitySnapshots?vaultAddress=...` — higher-frequency raw
   * series (~hourly) without the `day` bucket field. Time-window paginated.
   *
   * @param params - required `vaultAddress`, optional time window / limit.
   * @returns Page of {@link VaultEquitySnapshot} rows (bare envelope).
   * @throws ValidationError when `vaultAddress` invalid or `limit > 5000`.
   * @throws NotFoundError when the vault is unknown.
   */
  async equitySnapshots(params: VaultSnapshotsParams): Promise<Page<VaultEquitySnapshot>> {
    assertAddress(params.vaultAddress, 'vaultAddress')
    assertLimit(params.limit, VAULTS_LIMIT_CAP)
    const raw = await this.http.request<unknown>({
      path: '/vaults/equitySnapshots',
      query: buildSnapshotsQuery(params),
    })
    return unwrap<VaultEquitySnapshot>(raw, 'bare')
  }

  /** Async iterator over `/vaults/equitySnapshots` — time-window pagination. */
  iterateEquitySnapshots(params: VaultSnapshotsParams): AsyncIterable<VaultEquitySnapshot> {
    assertAddress(params.vaultAddress, 'vaultAddress')
    assertLimit(params.limit, VAULTS_LIMIT_CAP)
    return iterate<VaultEquitySnapshot, Record<string, unknown>>(
      (p) => this.equitySnapshots(p as unknown as VaultSnapshotsParams),
      params as unknown as Record<string, unknown>,
      { kind: 'timeWindow', timeKey: 'time' },
    )
  }

  /**
   * GET `/vaults/vaultLedger?vaultAddress=...` — deposit / withdraw history.
   *
   * @remarks
   * **What:** Synthesizes the `kind: 'deposit' | 'withdraw'` field client-side.
   *
   * **Why:** PLAN.md §I bug #25 — the upstream wire payload has no `kind`
   * field; callers would otherwise need to re-implement the
   * `userTo === vaultAddress` (case-insensitive) check for every row. The SDK
   * does it once at the boundary so the typed model is self-describing.
   *
   * Time-window paginated — use {@link iterateLedger} for the full history.
   *
   * @param params - required `vaultAddress`, optional `user` / time window / limit.
   * @returns Page of {@link VaultLedgerTx} rows with synthesized `kind` (bare envelope).
   * @throws ValidationError when `vaultAddress` / `user` invalid or `limit > 5000`.
   * @throws NotFoundError when the vault is unknown.
   * @see PLAN.md §I #25
   */
  async ledger(params: VaultLedgerParams): Promise<Page<VaultLedgerTx>> {
    assertAddress(params.vaultAddress, 'vaultAddress')
    if (params.user !== undefined) assertAddress(params.user, 'user')
    assertLimit(params.limit, VAULTS_LIMIT_CAP)
    const raw = await this.http.request<unknown>({
      path: '/vaults/vaultLedger',
      query: buildLedgerQuery(params),
    })
    const page = unwrap<RawVaultLedgerTx>(raw, 'bare')
    const vault = params.vaultAddress.toLowerCase()
    const data: VaultLedgerTx[] = page.data.map((row) => ({
      ...row,
      kind: row.userTo.toLowerCase() === vault ? 'deposit' : 'withdraw',
    }))
    return { data, meta: page.meta }
  }

  /** Async iterator over `/vaults/vaultLedger` — time-window pagination. */
  iterateLedger(params: VaultLedgerParams): AsyncIterable<VaultLedgerTx> {
    assertAddress(params.vaultAddress, 'vaultAddress')
    if (params.user !== undefined) assertAddress(params.user, 'user')
    assertLimit(params.limit, VAULTS_LIMIT_CAP)
    return iterate<VaultLedgerTx, Record<string, unknown>>(
      (p) => this.ledger(p as unknown as VaultLedgerParams),
      params as unknown as Record<string, unknown>,
      { kind: 'timeWindow', timeKey: 'time' },
    )
  }

  /**
   * GET `/vaults/userVaultEquities?user=...` — per-user vault equity rows.
   *
   * Empty for every tested user during exploration (batch-7); the
   * {@link UserVaultEquity} shape is a placeholder derived from swagger and
   * may drift once a known HLP follower address is sampled.
   *
   * @param params - required `user` address.
   * @returns Page of {@link UserVaultEquity} rows (bare envelope, currently empty).
   * @throws ValidationError when `user` is not a valid address.
   * @see PLAN.md §I #14
   */
  async userVaultEquities(params: UserVaultEquitiesParams): Promise<Page<UserVaultEquity>> {
    assertAddress(params.user, 'user')
    const raw = await this.http.request<unknown>({
      path: '/vaults/userVaultEquities',
      query: buildUserVaultEquitiesQuery(params),
    })
    return unwrap<UserVaultEquity>(raw, 'bare')
  }
}
