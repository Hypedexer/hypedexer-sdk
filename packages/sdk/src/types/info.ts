import type { TimeInput } from '../time/index.js'
import type { FillsStatsData } from './analytics.js'
import type { BuildersTopData } from './builder.js'
import type { Address, Coin, Side } from './common.js'
import type { Fill } from './fill.js'
import type { FundingRate } from './funding.js'
import type { DexRegistry, Hip3Overview, LiveSnapshot } from './hip3.js'
import type { Liquidation } from './liquidation.js'
import type { TopTraderEntry, TradingVolume24h } from './overview.js'
import type { TradeFill, TradesSummary } from './trade.js'
import type { Twap } from './twap.js'
import type { UserOverview } from './user.js'
import type { VaultSummary } from './vault.js'

// -----------------------------------------------------------------------------
// Type ↔ return-payload map (escape-hatch dispatcher — PLAN.md §M, §K ex. 16)
// -----------------------------------------------------------------------------

/**
 * Map from `/info` discriminator → return type of the matching REST endpoint.
 *
 * For every supported type the SDK extracts `.data` from the `APIResponse`
 * envelope that `/info` wraps the underlying handler in. Two of those wraps
 * are *artificial* — `currentFundingRates` and `vaultList` are bare on REST
 * but APIResponse-wrapped on `/info` (PLAN.md §I bug #11). Extracting `.data`
 * therefore restores the REST-shaped inner array.
 *
 * Two entries return `unknown` because the SDK has no first-class typed
 * resource for them yet:
 *   - `tradeHistory` (`/users/{addr}/trade-history` — not implemented)
 *   - `gossipLiveStatus` (`/hip3/priority-fees/gossip/status` — see PLAN §J)
 *
 * Two entries are `unknown[]` because the upstream endpoints currently 500
 * with a ClickHouse stack trace (PLAN.md §I bug #1): `spotTokenList` and
 * `spotPairList`. Calls reach the wire and surface as `ServerError` through
 * {@link parseError}.
 */
export interface InfoResultMap {
  fills: Fill[]
  recentFills: Fill[]
  /** `/completed-trades/{trade_id}/fills` — see PLAN §I #3 for shifted-key bug. */
  fillsByTradeId: TradeFill[]
  /** `/completed-trades/summary` — verified mapping per ENDPOINTS.md `fillsSummary`. */
  fillsSummary: TradesSummary
  fillAnalytics: FillsStatsData
  accountOverview: UserOverview
  bestTraders24h: TopTraderEntry[]
  volume24h: TradingVolume24h
  liqHistory: Liquidation[]
  twapList: Twap[]
  topBuilders: BuildersTopData
  hip3Summary: Hip3Overview
  hip3DexList: DexRegistry[]
  hip3Snapshots: LiveSnapshot[]
  /** Broken upstream — 500 ClickHouse (PLAN.md §I #1). Use WS `fills_spot`. */
  spotTokenList: unknown[]
  /** Broken upstream — 500 ClickHouse (PLAN.md §I #1). Use WS `fills_spot`. */
  spotPairList: unknown[]
  /** `/info` wraps in APIResponse even though REST is bare — SDK unwraps (PLAN.md §I #11). */
  currentFundingRates: FundingRate[]
  /** `/info` wraps in APIResponse even though REST is bare — SDK unwraps (PLAN.md §I #11). */
  vaultList: VaultSummary[]
  /** No first-class SDK type yet — `/users/{addr}/trade-history`. */
  tradeHistory: unknown[]
  /** No first-class SDK type yet — `/hip3/priority-fees/gossip/status`. */
  gossipLiveStatus: unknown
}

/** Discriminator literal supported by {@link InfoRequest}. */
export type InfoType = keyof InfoResultMap

// -----------------------------------------------------------------------------
// Per-variant body shapes
// -----------------------------------------------------------------------------

/**
 * Optional fills filter params shared by `fills`, `recentFills`, and
 * `fillAnalytics`-adjacent calls. Field names mirror the wire (snake_case)
 * because `/info` proxies through to the same REST handler. Time fields
 * accept the standard {@link TimeInput} and are encoded to ISO snake-case.
 */
export interface InfoFillsBody {
  readonly coin?: Coin
  readonly side?: Side
  readonly has_priority_gas?: boolean
  readonly cursor?: string
  readonly limit?: number
  readonly start_time?: TimeInput
  readonly end_time?: TimeInput
}

/** Body params for the `fillAnalytics` type — same shape as `/analytics/fills/stats`. */
export interface InfoFillAnalyticsBody {
  /** 1..168 server-side cap. */
  readonly hours?: number
  readonly coin?: Coin
}

/** Body params for `fillsSummary` — same shape as `/completed-trades/summary`. */
export interface InfoFillsSummaryBody {
  readonly user?: Address
  readonly coin?: Coin
  readonly direction?: 'long' | 'short'
  readonly start_time?: TimeInput
  readonly end_time?: TimeInput
}

/**
 * Body params for `accountOverview` and `tradeHistory` — both proxy to
 * `/users/{user}/...`. `user` is required; address is validated client-side
 * to match the REST behaviour (PLAN.md §I bug #14).
 */
export interface InfoUserBody {
  readonly user: Address
  readonly start_time?: TimeInput
  readonly end_time?: TimeInput
}

/** Body params for `bestTraders24h` — `/overview/top-traders-24h`. */
export interface InfoBestTradersBody {
  /** Validated downstream: bogus values silently fall back upstream (PLAN.md §I #5). */
  readonly sort?: 'pnl_pos' | 'pnl_neg' | 'volume' | 'trades'
  readonly limit?: number
}

/** Body params for `liqHistory` — `/liquidations/`. */
export interface InfoLiqHistoryBody {
  readonly coin?: Coin
  readonly user?: Address
  readonly amount_dollars?: number
  readonly cursor?: string
  /** 1..100 server cap. */
  readonly limit?: number
  /** `'asc'` produces a corrupt cursor on follow-up pages — see PLAN.md §I #4. */
  readonly order?: 'asc' | 'desc'
  readonly start_time?: TimeInput
  readonly end_time?: TimeInput
}

/** Body params for `twapList` — `/twaps/`. */
export interface InfoTwapListBody {
  readonly status?: 'activated' | 'finished' | 'terminated' | 'all'
  readonly coin?: Coin
  readonly user?: Address
  readonly order?: 'asc' | 'desc'
  readonly limit?: number
  readonly offset?: number
}

/** Body params for `topBuilders` — `/builders/top`. */
export interface InfoTopBuildersBody {
  readonly timeframe?: '1h' | '24h' | '7d' | '30d'
  readonly sort?: 'volume' | 'fees' | 'builder_fees' | 'fills' | 'users'
  readonly limit?: number
  readonly offset?: number
}

/** Body params for `hip3DexList` — `/hip3/dexs`. */
export interface InfoHip3DexListBody {
  readonly limit?: number
  readonly offset?: number
}

/** Body params for `hip3Snapshots` — `/hip3/snapshots`. */
export interface InfoHip3SnapshotsBody {
  readonly dex_id?: string
  readonly coin?: Coin
}

/** Body params for `vaultList` — `/vaults/vaultSummaries`. */
export interface InfoVaultListBody {
  /** 1..5000 server cap. */
  readonly limit?: number
  readonly offset?: number
  readonly includeClosed?: boolean
}

/** Body params for `fillsByTradeId` — `/completed-trades/{trade_id}/fills`. */
export interface InfoFillsByTradeIdBody {
  /** Composite id (may contain `:` for HIP-3 coins). Required by the server. */
  readonly tradeId: string
}

// -----------------------------------------------------------------------------
// Discriminated union of all valid /info request payloads.
// -----------------------------------------------------------------------------

/**
 * The {@link InfoResource.info} request discriminated union.
 *
 * Every variant pairs a `type` literal with the body shape the matching REST
 * handler expects. Field names mirror the wire shape (snake_case for
 * fills/liq/users; camelCase for hip3 dex_id, includeClosed, etc) so the
 * payload is forwarded verbatim alongside `type`.
 *
 * The `type` field also keys into {@link InfoResultMap} to determine the
 * return type of {@link InfoResource.info}.
 */
export type InfoRequest =
  | ({ readonly type: 'fills' } & InfoFillsBody)
  | ({ readonly type: 'recentFills' } & InfoFillsBody)
  | ({ readonly type: 'fillsByTradeId' } & InfoFillsByTradeIdBody)
  | ({ readonly type: 'fillsSummary' } & InfoFillsSummaryBody)
  | ({ readonly type: 'fillAnalytics' } & InfoFillAnalyticsBody)
  | ({ readonly type: 'accountOverview' } & InfoUserBody)
  | ({ readonly type: 'bestTraders24h' } & InfoBestTradersBody)
  | { readonly type: 'volume24h' }
  | ({ readonly type: 'liqHistory' } & InfoLiqHistoryBody)
  | ({ readonly type: 'twapList' } & InfoTwapListBody)
  | ({ readonly type: 'topBuilders' } & InfoTopBuildersBody)
  | { readonly type: 'hip3Summary' }
  | ({ readonly type: 'hip3DexList' } & InfoHip3DexListBody)
  | ({ readonly type: 'hip3Snapshots' } & InfoHip3SnapshotsBody)
  | { readonly type: 'spotTokenList' }
  | { readonly type: 'spotPairList' }
  | { readonly type: 'currentFundingRates' }
  | ({ readonly type: 'vaultList' } & InfoVaultListBody)
  | ({ readonly type: 'tradeHistory' } & InfoUserBody)
  | { readonly type: 'gossipLiveStatus' }
