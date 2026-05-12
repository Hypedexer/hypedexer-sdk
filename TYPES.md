# `@hypedexer/sdk` — Type System Blueprint

Source-of-truth TypeScript types for every endpoint group, derived from the 9 batch reports. Field shapes reflect *observed* responses; divergences from the OpenAPI spec are called out inline.

---

## 0. Core / shared types

```ts
// src/types/common.ts

export type Address = `0x${string}`        // 20-byte hex, lowercased on input normalize
export type Hex = `0x${string}`            // arbitrary hex
export type Wei = string & { readonly __wei: unique symbol }   // bigint-safe string
export type IsoTimestamp = string          // see PLAN.md §E for variants
export type EpochMs = number
export type DateOnly = string              // "YYYY-MM-DD"
export type Hip4Expiry = string            // "YYYYMMDD-HHMM"

export type Coin = string                  // see parseCoin() for kinds
export type Side = 'A' | 'B'               // A = Ask/Sell, B = Bid/Buy
export type Direction = 'long' | 'short'

export interface Page<T> {
  readonly data: T[]
  readonly meta: PageMeta
}

export interface Single<T> {
  readonly data: T
  readonly meta: PageMeta
}

export interface PageMeta {
  readonly family: 'apiResponse' | 'bare' | 'hip4'
  readonly message?: string
  readonly executionMs?: number
  readonly totalCount?: number | null
  readonly nextCursor?: string | null
  readonly hasMore?: boolean | null
  readonly status?: 'live' | 'not_yet_live'
  readonly testnetDocs?: string
}

// Time inputs accepted by every endpoint that takes a time window.
export type TimeInput = Date | EpochMs | IsoTimestamp

// Standard 422 detail entry from FastAPI.
export interface ValidationDetail {
  readonly type: string
  readonly loc: ReadonlyArray<string | number>
  readonly msg: string
  readonly input?: unknown
  readonly ctx?: Record<string, unknown>
}
```

### KPI / variation envelope (analytics, builders)

```ts
export interface KpiCard<T = number> {
  readonly value: T
  readonly variationPct: number | null   // null when previous=0 (batch-6)
}

export interface TimeRangeIso {
  readonly start: IsoTimestamp
  readonly end: IsoTimestamp
}
```

---

## 1. Fills (batch-1)

```ts
// src/types/fill.ts

// Unified perp Fill — observed fields across /fills/, /fills/recent, /fills/user.
// User-scoped responses omit startPosition/dir/closedPnl (batch-1 §user).
export interface Fill {
  readonly user: Address
  readonly coin: Coin
  readonly coinMeaning: string
  readonly px: number
  readonly sz: number
  readonly side: Side
  readonly time: IsoTimestamp           // ISO no TZ, µs — UTC
  readonly startPosition?: number       // present only on /fills/, /fills/recent (perp+spot mixed stream)
  readonly dir?: string                 // "Open Long" | "Close Long" | "Open Short" | "Close Short" | "Buy" | "Sell"
  readonly closedPnl?: number
  readonly hash: Hex
  readonly oid: number
  readonly tid: number                  // ~10^15 today; see PLAN §F.3
  readonly fee: number
  readonly feeToken: string             // "USDC" | "USDT0" | "HYPE" | "KNTQ" | "+250" | ...
  readonly typeTrade: 'perp' | 'spot'
  readonly isLiquidation: boolean       // coerced from int 0/1
  readonly liquidationRole: string      // "none" | actor role
  readonly liqMarkPx: number | null
  readonly liqMethod: string | null
  readonly liquidatedUser: Address | null
  readonly notional: number
  readonly priorityGas: number | null
}

// Spot fills are a strict subset and add feeUsdc; modeled separately for narrowing.
export interface SpotFill {
  readonly user: Address
  readonly coin: Coin                   // "@107" etc.
  readonly coinMeaning: string
  readonly px: number
  readonly sz: number
  readonly side: Side
  readonly time: IsoTimestamp
  readonly tid: number
  readonly oid: number
  readonly hash: Hex
  readonly fee: number
  readonly feeToken: string
  readonly feeUsdc: number              // present on spot only
  readonly typeTrade: 'spot'
  readonly priorityGas: number | null
}

export type AnyFill =
  | (Fill & { readonly typeTrade: 'perp' })
  | (SpotFill & { readonly typeTrade: 'spot' })

// /fills/count
export interface FillsCount {
  readonly count: number
  readonly timestamp: IsoTimestamp      // ISO with +00:00
  readonly executionTimeMs: number
}

// Request types
export type FillsTimeRange = '1h' | '24h' | '7d' | '30d'

export interface FillsListParams {
  readonly coin?: Coin
  readonly side?: Side
  readonly hasPriorityGas?: boolean
  readonly startTime?: TimeInput
  readonly endTime?: TimeInput
  readonly cursor?: string              // "<epoch_ms>:<tid>"
  readonly limit?: number               // 1..1000
}

export interface FillsUserParams extends Omit<FillsListParams, never> {
  readonly timeRange?: FillsTimeRange   // alternative to startTime/endTime
}

export interface SpotFillsListParams {
  readonly coin?: Coin
  readonly side?: Side
  readonly startTime?: TimeInput
  readonly endTime?: TimeInput
  readonly offset?: number              // cursor not supported on spot
  readonly limit?: number               // 1..1000 (assumed; not explicitly capped lower)
}
```

**Divergences from swagger:** swagger types `data: any`. The schema above is captured from observed payloads. Side values are `"A" / "B"` not human-readable. `isLiquidation` is wire-int-0/1 but exposed as `boolean`. `tid` exposed as `number` (see PLAN §F.3). User-scoped responses omit `startPosition/dir/closedPnl` — modeled via `?` optionals.

---

## 2. Analytics (batch-2)

```ts
// src/types/analytics.ts

export interface FillsStatsData {
  readonly totalFills: number
  readonly totalVolume: number
  readonly totalFees: number
  readonly totalBuilderFeesUsdc: number
  readonly uniqueUsers: number
  readonly uniqueCoins: number
  readonly timeRange: TimeRangeIso
  readonly coin?: Coin                   // present only when ?coin= filter applied
}

export interface PriorityFeesStatsData {
  readonly totalFillsWithPriority: number
  readonly totalPriorityGas: number
  readonly avgPriorityGas: number
  readonly minPriorityGas: number
  readonly maxPriorityGas: number
  readonly uniqueUsers: number
  readonly timeRange: TimeRangeIso
  readonly coin?: Coin
}

export interface PriorityFeesDailyPoint {
  readonly date: DateOnly
  readonly fills: number
  readonly fillsWithFee: number
  readonly totalGas: number
  readonly uniqueUsers: number
}

// gossip/leaderboard — address renamed to nodeIp (batch-2, batch-9 confirmed IPv4)
export interface GossipLeaderboardEntry {
  readonly nodeIp: string                // IPv4 string
  readonly totalGas: number
  readonly count: number
  readonly daysActive: number
}

export interface LiquidationsStatsData {
  readonly numberLiquidation: number
  readonly numberLongLiquidated: number
  readonly numberShortLiquidated: number
  readonly amountLiquidatedUsd: number
  readonly totalFees: number
  readonly topTokenLiquidated: Coin     // ignores ?coin= filter (batch-2 bug #8)
  readonly timeRange: TimeRangeIso
  readonly coin?: Coin
}

// Request param types
export interface FillsStatsParams { readonly hours?: number; readonly coin?: Coin }   // hours: 1..168
export interface PriorityFeesStatsParams extends FillsStatsParams {}
export interface LiquidationsStatsParams { readonly days?: number; readonly coin?: Coin }   // days: 1..30
export interface PriorityFeesChartDailyParams { readonly startTime?: TimeInput; readonly endTime?: TimeInput }
export interface GossipLeaderboardParams { readonly limit?: number }   // 1..200
```

---

## 3. Overview (batch-2)

```ts
// included in src/types/analytics.ts

export type TopTraderSort = 'pnl_pos' | 'pnl_neg' | 'volume' | 'trades'

export interface TopTraderEntry {
  readonly user: Address
  readonly tradeCount: number
  readonly totalVolume: number
  readonly winRate: number             // [0, 1]
  readonly totalPnl: number
}

export interface TotalFees24h {
  readonly feesSpot: number
  readonly feesPerpUsdc: number
  readonly totalFees: number
}

export type ActiveTraders24h = KpiCard<number>
export type TradingVolume24h = KpiCard<number>
export type TotalFills24h = KpiCard<number>

export interface DailyVolumePoint { readonly date: DateOnly; readonly volume: number }
export interface DailyPnlEntry { readonly date: DateOnly; readonly coin: Coin; readonly pnl: number }
export interface CoinDistributionEntry { readonly coin: Coin; readonly volume: number; readonly fills: number }

export interface TopTradersParams { readonly sort?: TopTraderSort; readonly limit?: number }   // default 20
export interface DailyVolumeParams { readonly user?: Address }
export interface CoinDistributionParams { readonly user: Address }   // required
```

---

## 4. Users (batch-3)

```ts
// src/types/user.ts

export interface UserOverview {
  readonly user: Address                  // echoes input verbatim — not normalized
  readonly totalVolume: number
  readonly totalFees: number
  readonly fillCount: number
  readonly uniqueCoins: number
  readonly totalPnl: number
  readonly totalTrades: number            // ≠ fillCount; trade = open+close
  readonly totalPriorityGas: number       // currently always 0 — see bug #6
  readonly lastActivity: IsoTimestamp | null   // sentinel "1970-01-01T00:00:00" → null
  readonly winRate: number
}

export interface UserPerformance {
  readonly user: Address
  readonly totalTrades: number
  readonly winRate: number
  readonly avgWin: number
  readonly avgLoss: number
  readonly profitFactor: number
  readonly maxDrawdown: number
  readonly avgTradeSize: number
  readonly avgHoldingTimeS: number        // observed inflated; see bug #8
  readonly wins: number
  readonly losses: number
  readonly totalPnl: number
}

export interface UserCoinAggregate {
  readonly coin: Coin
  readonly totalVolume: number
  readonly fillCount: number
  readonly totalFees: number
  readonly avgPrice: number
  readonly priceRange: { readonly min: number; readonly max: number }
  readonly totalPnl: number
}

export interface ActiveUser {
  readonly user: Address
  readonly fillCount: number
  readonly totalVolume: number
  readonly uniqueCoins: number
  readonly lastActivity: IsoTimestamp
}

// Polymorphic leaderboard — discriminated on `by`
export type LeaderboardBy = 'volume' | 'pnl' | 'trades' | 'priority_fees'

export interface LeaderboardByVolume {
  readonly user: Address
  readonly totalVolume: number
  readonly fillCount: number
  readonly uniqueCoins: number
}
export interface LeaderboardByPnl {
  readonly user: Address
  readonly totalPnl: number
  readonly tradeCount: number
}
export interface LeaderboardByTrades {
  readonly user: Address
  readonly fillCount: number
  readonly totalVolume: number
}
export interface LeaderboardByPriorityFees {
  readonly user: Address
  readonly totalPriorityGas: number
  readonly fillCount: number
}

export type LeaderboardEntry<B extends LeaderboardBy> =
  B extends 'volume' ? LeaderboardByVolume :
  B extends 'pnl' ? LeaderboardByPnl :
  B extends 'trades' ? LeaderboardByTrades :
  B extends 'priority_fees' ? LeaderboardByPriorityFees :
  never

export interface LeaderboardParams<B extends LeaderboardBy> {
  readonly by: B
  readonly hours?: number               // 1..168
  readonly limit?: number               // 1..100
}

// User detail param types
export interface UserOverviewParams { readonly startTime?: TimeInput; readonly endTime?: TimeInput }
export interface UserCoinsParams extends UserOverviewParams { readonly limit?: number }   // 1..100
export interface ActiveUsersParams { readonly hours?: number; readonly limit?: number }
```

---

## 5. Completed trades (batch-3)

```ts
// src/types/trade.ts

export type TradeSortBy = 'pnl' | 'time' | 'volume' | 'duration'   // server validates loosely; SDK enforces
export type TradeSortDir = 'asc' | 'desc'

export interface Trade {
  readonly user: Address
  readonly coin: Coin
  readonly direction: Direction
  readonly startTime: IsoTimestamp
  readonly endTime: IsoTimestamp
  readonly durationS: number
  readonly entryPrice: number
  readonly exitPrice: number
  readonly sizeClose: number
  readonly pnlRealized: number
  readonly leverageType: 'cross' | 'isolated'
  readonly positionValue: number
  readonly totalFills: number
  readonly totalFees: number
  readonly avgFillPrice: number
  readonly firstFillTime: IsoTimestamp
  readonly lastFillTime: IsoTimestamp
  readonly totalVolume: number
  readonly tradeId: string              // "trade_<coin>_<8hex>"; URL-encode (`:` in coin)
  readonly closeHash: Hex
  readonly createdAt: IsoTimestamp
}

export interface TradesSummary {
  readonly totalTrades: number
  readonly totalPnl: number
  readonly avgPnlPct: number            // appears to be a true % (1.09 = +1.09%) — see bug #9 batch-3
  readonly avgDurationS: number         // currently inflated; see bug #8
  readonly totalFees: number
  readonly totalVolume: number
  readonly timeRange: TimeRangeIso
  readonly directionBreakdown: ReadonlyArray<{
    readonly direction: Direction
    readonly count: number
    readonly totalPnl: number
  }>
  readonly topCoins: ReadonlyArray<{
    readonly coin: Coin
    readonly tradeCount: number
    readonly totalPnl: number
    readonly totalVolume: number
  }>
}

// /completed-trades/{id}/fills returns rows with shifted last-two keys (batch-3 bug #2).
// SDK omits feeUsdc/typeTrade until backend fix; exposes the recoverable fields.
export interface TradeFill {
  readonly user: Address
  readonly coin: Coin
  readonly coinMeaning: string
  readonly px: number
  readonly sz: number
  readonly side: Side
  readonly time: IsoTimestamp
  readonly startPosition: number
  readonly dir: string
  readonly closedPnl: number
  readonly hash: Hex
  readonly oid: number
  readonly crossed: boolean             // wire int 0/1
  readonly tid: number
  readonly cloid: Hex                   // 32-byte client order id
  readonly fee: number
  readonly feeToken: string
  // feeUsdc / typeTrade omitted: server bug ships shifted values (PLAN §I bug #3)
}

export interface CompletedTradesListParams {
  readonly user?: Address
  readonly coin?: Coin
  readonly direction?: Direction
  readonly startTime?: TimeInput
  readonly endTime?: TimeInput
  readonly minPnl?: number
  readonly maxPnl?: number
  readonly offset?: number
  readonly limit?: number               // SDK hard-caps 100 (no server cap)
  readonly doCount?: boolean            // currently no observable effect
  readonly sortBy?: TradeSortBy
  readonly sortDir?: TradeSortDir
}

export interface CompletedTradesSummaryParams {
  readonly user?: Address
  readonly coin?: Coin
  readonly direction?: Direction
  readonly startTime?: TimeInput
  readonly endTime?: TimeInput
}
```

---

## 6. Liquidations (batch-3)

```ts
// src/types/liquidation.ts

export interface Liquidation {
  readonly time: IsoTimestamp           // ISO no TZ, second precision
  readonly timeMs: number               // CORRUPT on very old rows (year 2245); see bug #5
  readonly coin: Coin
  readonly hash: Hex
  readonly liquidatedUser: Address | null   // empty string in wire → null
  readonly sizeTotal: number
  readonly notionalTotal: number
  readonly fillPxVwap: number | null
  readonly markPx: number | null
  readonly method: string | null        // "market" | other strings | null
  readonly feeTotalLiquidated: number
  readonly liquidators: ReadonlyArray<Address>   // up to 8 observed
  readonly liquidatorCount: number
  readonly liqDir: 'Long' | 'Short' | null      // direction of liquidated position
  readonly tid: number
}

export type LiquidationOrder = 'asc' | 'desc'

export interface LiquidationsListParams {
  readonly coin?: Coin
  readonly user?: Address
  readonly startTime?: TimeInput
  readonly endTime?: TimeInput
  readonly amountDollars?: number       // min notional
  readonly cursor?: string              // "<epoch_ms>:<tid>"
  readonly limit?: number               // 1..100
  readonly order?: LiquidationOrder     // iterate({order:'asc'}) throws — see bug #4
}
```

---

## 7. HIP-3 (batch-4) — bare envelope

```ts
// src/types/hip3.ts

export interface Hip3Overview {
  readonly totalDexs: number
  readonly totalAssets: number
  readonly totalVolume24h: number
  readonly totalFees24h: number
  readonly totalTrades24h: number
  readonly totalOpenInterest: number
  readonly auctionActive: boolean
  readonly auctionPriceHype: number
  readonly auctionEndAt: IsoTimestamp | null      // ISO with Z (outlier)
  readonly nextAuctionAt: IsoTimestamp | null
}

export interface DexRegistry {
  readonly dexId: string                // short lowercase
  readonly name: string
  readonly deployerAddress: Address
  readonly oracleUpdater: Address | ''
  readonly collateralAsset: 'USDC' | string
  readonly feeSharePct: number          // 0..1 float
  readonly isGrowthMode: boolean
  readonly activeSince: IsoTimestamp
  readonly totalStakedHype: number      // currently always 0
}

export interface AssetConfig {
  readonly dexId: string
  readonly assetId: number              // ALWAYS 0 today — bug #6
  readonly ticker: Coin                 // prefixed form, e.g. "xyz:CL"
  readonly symbol: string               // "CL/USDC" — display only
  readonly maxLeverage: number
  readonly oiCapUsd: number
  readonly isHalted: boolean
  readonly oracleSource: 'hip3_node' | string
  readonly updateTimestamp: IsoTimestamp
  readonly feeSharePct: number
}

export type AuctionStatus = 'open' | 'closed' | 'expired'

export interface Auction {
  readonly auctionId: number            // epoch-sec
  readonly startTime: IsoTimestamp
  readonly endTimeScheduled: IsoTimestamp
  readonly startPriceHype: number
  readonly floorPriceHype: number
  readonly currentGas: number | null
  readonly winnerAddress: Address | null
  readonly winningBidHype: number | null
  readonly winningTicker: Coin | null
  readonly status: AuctionStatus
  readonly txHash: Hex | null
}

export interface AuctionHistory {
  readonly time: IsoTimestamp
  readonly dexId: string | ''
  readonly coin: Coin | ''
  readonly auctionId: string            // STRING here, not int — divergence from /auctions
  readonly startPx: number
  readonly endPx: number
  readonly clearedPx: number
  readonly winner: Address | ''
  readonly sz: number
  readonly status: AuctionStatus
  readonly durationSeconds: number
}

export interface LiveSnapshot {
  readonly dexId: string
  readonly coin: Coin
  readonly currentMarkPrice: number
  readonly currentOraclePrice: number
  readonly currentFundingRate: number
  readonly openInterest: number
  readonly volume24h: number
  readonly fees24h: number
  readonly trades24h: number
  readonly totalVolumeCumulative: number
  readonly totalFeesCumulative: number
  readonly isHalted: boolean
  readonly lastUpdate: IsoTimestamp
}

export interface OhlcvBar {
  readonly time: IsoTimestamp
  readonly dexId: string
  readonly coin: Coin
  readonly open: number
  readonly high: number
  readonly low: number
  readonly close: number
  readonly volume: number               // ALWAYS 0 today — bug #7
  readonly fees: number                 // ALWAYS 0 today — bug #7
  readonly trades: number
}

export interface OracleStats1m {
  readonly bucket: IsoTimestamp
  readonly dexId: string
  readonly assetId: number
  readonly markOpen: number
  readonly markHigh: number
  readonly markLow: number
  readonly markClose: number
  readonly oracleOpen: number
  readonly oracleHigh: number
  readonly oracleLow: number
  readonly oracleClose: number
  readonly maxDeviationPct: number
  readonly avgFundingRate: number
  readonly totalOi: number
  readonly tradeCount: number
}

export interface Hip3Fill {
  readonly time: IsoTimestamp
  readonly dexId: string
  readonly coin: Coin                   // "<dex>:<TICKER>"
  readonly user: Address
  readonly side: Side
  readonly px: number
  readonly sz: number
  readonly notional: number
  readonly fee: number
  readonly builderFeeUsd: number
  readonly isLiquidation: boolean       // wire int 0/1
  readonly hash: Hex
  readonly tid: number
}

export interface TraderStats {
  readonly dexId: string
  readonly trader: Address
  readonly coin: Coin
  readonly totalVolume: number
  readonly totalFees: number
  readonly totalTrades: number
  readonly pnlRealized: number
  readonly lastUpdate: IsoTimestamp
}

export type Hip3LeaderboardBy = 'volume' | 'pnl' | 'trades' | 'fees'

export interface Hip3LeaderboardEntry {
  readonly trader: Address
  readonly totalVolume: number
  readonly totalFees: number
  readonly totalTrades: number
  readonly pnlRealized: number
}

export interface UserHip3Overview {
  readonly trader: Address
  readonly totalVolume: number
  readonly totalFees: number
  readonly totalTrades: number
  readonly pnlRealized: number
  readonly coinsTraded: number
  readonly dexsTraded: number
}

export interface UserCoinStats {
  readonly dexId: string
  readonly coin: Coin
  readonly totalVolume: number
  readonly totalFees: number
  readonly totalTrades: number
  readonly pnlRealized: number
}

// Request types
export interface Hip3DexsParams { readonly limit?: number; readonly offset?: number }     // 1..500
export interface Hip3AssetsParams { readonly dexId?: string; readonly search?: string; readonly limit?: number; readonly offset?: number }   // 1..1000
export interface Hip3AuctionsParams { readonly status?: AuctionStatus; readonly limit?: number; readonly offset?: number }   // 1..200
export interface Hip3SnapshotsParams { readonly dexId?: string; readonly coin?: Coin }
export interface Hip3OhlcvParams { readonly coin: Coin; readonly dexId?: string; readonly startTime?: TimeInput; readonly endTime?: TimeInput; readonly limit?: number }   // 1..2000, default 168
export interface Hip3OracleStatsParams { readonly dexId: string; readonly assetId?: number; readonly startTime?: TimeInput; readonly endTime?: TimeInput; readonly limit?: number }   // 1..10000
export interface Hip3FillsParams { readonly dexId?: string; readonly coin?: Coin; readonly user?: Address; readonly side?: Side; readonly startTime?: TimeInput; readonly endTime?: TimeInput; readonly minNotional?: number; readonly limit?: number; readonly offset?: number }
export interface Hip3TopMoversParams { readonly limit?: number }   // 1..100
export interface Hip3StatsTradersParams { readonly dexId?: string; readonly coin?: Coin; readonly limit?: number; readonly offset?: number }
export interface Hip3LeaderboardParams { readonly by: Hip3LeaderboardBy; readonly dexId?: string; readonly limit?: number }
export interface Hip3UserCoinsParams { readonly limit?: number }   // 1..100
```

---

## 8. HIP-4 (batch-5) — Hip4Envelope

```ts
// src/types/hip4.ts

export interface Hip4Envelope<T> {
  readonly status: 'live' | 'not_yet_live'
  readonly count: number
  readonly data: T[]
  readonly message?: string
  readonly testnetDocs?: string
}

// Outcome / Market — same upstream record exposed under two paths.
export type Hip4Class = 'priceBinary' | 'priceBucket' | ''

export interface Hip4Outcome {
  readonly outcomeId: number
  readonly coin: Coin                   // "#<id>" or "" for fallback
  readonly name: string
  readonly description: string          // pipe-delimited; see parseHip4Description
  readonly class: Hip4Class
  readonly underlying: string | ''      // "BTC" | "ETH" | ...
  readonly expiry: Hip4Expiry           // "YYYYMMDD-HHMM"
  readonly targetPrice: number | null
  readonly period: string | ''          // "1d" | ...
  readonly sideSpecs: string            // stringified JSON, e.g. '[{"name":"Yes"},{"name":"No"}]'
  readonly questionId: number | null
  readonly quoteToken: number           // outcome_id of paired quote token
  readonly blockTime: IsoTimestamp
  readonly settled: boolean             // wire int 0/1
  readonly questionName: string
  readonly questionDescription: string
  readonly totalFills: number
  readonly totalVolume: number
  readonly uniqueUsers: number
}

export interface Hip4Question {
  readonly questionId: number
  readonly name: string
  readonly description: string          // pipe-delimited
  readonly fallbackOutcome: number
  readonly namedOutcomes: ReadonlyArray<number>
  readonly settledNamedOutcomes: ReadonlyArray<number>
  readonly updatedAt: IsoTimestamp
}

export interface Hip4OutcomeToken {
  readonly outcomeId: number
  readonly coin: Coin                   // "@<spot_index>"
  readonly spotIndex: number
  readonly spotName: string
  readonly deployerFeeShare: number
  readonly szDecimals: number
  readonly weiDecimals: number
  readonly updatedAt: IsoTimestamp
}

export interface Hip4Fill {
  readonly user: Address
  readonly coin: Coin                   // "#<outcome_id>"
  readonly outcomeId: number
  readonly px: number                   // 0..1 probability
  readonly sz: number
  readonly side: Side
  readonly timeMs: number
  readonly dir: string                  // "Buy" | "Merge Outcome" | ...
  readonly closedPnl: number
  readonly hash: Hex
  readonly oid: number
  readonly tid: number
  readonly fee: number
  readonly feeToken: string             // "USDH" | "+<NNN>"
  readonly feeUsdc: number
  readonly typeTrade: string            // "perp" today
  readonly marketName: string
  readonly marketDescription: string
}

export interface Hip4Fee {
  readonly user: Address
  readonly coin: Coin
  readonly feeToken: string
  readonly date: DateOnly
  readonly fills: number
  readonly totalFeeRaw: number
  readonly totalFeeUsdc: number
  readonly totalNotional: number
  readonly effectiveRate: number        // ~0.0015 universally
}

export interface Hip4Settlement {
  readonly outcomeId: number
  readonly settleFraction: number       // 0..1
  readonly details: string              // free-form, e.g. "price:80812.7"
  readonly broadcaster: Address
  readonly blockTime: IsoTimestamp
  readonly blockHeight: number
  readonly nonce: number                // logical clock; treat as opaque
}

export type Hip4Interval = '1h' | '4h' | '1d'

// Without coin/outcome_id: aggregate (no `coin` field).
// With coin filter: rows include `coin`.
export interface Hip4AnalyticsRowAggregate {
  readonly bucket: IsoTimestamp
  readonly fills: number
  readonly volume: number
  readonly buyVolume: number
  readonly sellVolume: number
  readonly feesUsdc: number
  readonly uniqueUsers: number
}
export interface Hip4AnalyticsRowByCoin extends Hip4AnalyticsRowAggregate {
  readonly coin: Coin
}
export type Hip4AnalyticsRow = Hip4AnalyticsRowAggregate | Hip4AnalyticsRowByCoin

// Request types
export interface Hip4MarketsParams {
  readonly outcomeId?: number
  readonly class?: Hip4Class
  readonly underlying?: string
  readonly questionId?: number
  readonly limit?: number               // 1..1000
  readonly offset?: number
  // coin filter intentionally omitted — silently ignored upstream (PLAN bug #22)
}

export interface Hip4QuestionsParams {
  readonly questionId?: number
  readonly limit?: number
  readonly offset?: number
}

export interface Hip4OutcomeTokensParams {
  readonly outcomeId?: number
  readonly coin?: Coin
  readonly limit?: number
  readonly offset?: number
}

export interface Hip4FillsParams {
  readonly user?: Address
  readonly coin?: Coin
  readonly outcomeId?: number
  readonly startTime?: TimeInput
  readonly endTime?: TimeInput
  readonly limit?: number               // 1..1000
  readonly offset?: number
}

export interface Hip4FeesParams {
  readonly user?: Address
  readonly coin?: Coin
  readonly startTime?: TimeInput
  readonly endTime?: TimeInput
  readonly limit?: number
  readonly offset?: number
}

export interface Hip4SettlementsParams {
  readonly outcomeId?: number
  readonly startTime?: TimeInput
  readonly endTime?: TimeInput
  readonly limit?: number
  readonly offset?: number
}

export interface Hip4AnalyticsParams {
  readonly interval?: Hip4Interval
  readonly coin?: Coin | ReadonlyArray<Coin | number>   // server normalizes ints
  readonly outcomeId?: number
  readonly startTime?: TimeInput
  readonly endTime?: TimeInput
  readonly limit?: number               // 1..2000
}

// Description parser
export interface ParsedHip4Description {
  readonly class?: Hip4Class
  readonly underlying?: string
  readonly expiry?: Hip4Expiry
  readonly targetPrice?: number
  readonly priceThresholds?: ReadonlyArray<number>
  readonly period?: string
}
export function parseHip4Description(raw: string): ParsedHip4Description
```

---

## 9. Builders (batch-6)

```ts
// src/types/builder.ts

export type BuilderTimeframe = '1h' | '24h' | '7d' | '30d'
export type BuilderTopSort = 'volume' | 'fees' | 'builder_fees' | 'fills' | 'users'
export type ReferrerStage = 'ready' | 'needToTrade' | 'needToCreateCode' | null

export interface Builder {
  readonly builder: Address
  readonly builderName: string | null
  readonly fillCount: number
  readonly totalVolume: number
  readonly totalFees: number
  readonly totalBuilderFees: number
  readonly uniqueUsers: number
  readonly uniqueCoins: number
}

export interface BuildersTopData {
  readonly timeframe: BuilderTimeframe
  readonly sort: BuilderTopSort
  readonly builders: ReadonlyArray<Builder>
}

export interface BuilderStatsBlock {
  readonly fillCount: number
  readonly totalVolume: number
  readonly totalFees: number
  readonly totalBuilderFees: number
  readonly uniqueBuilders?: number      // present on global stats, absent on per-addr
  readonly uniqueUsers: number
  readonly uniqueCoins: number
}

export interface BuilderVariations {
  readonly fillCountPct: number | null
  readonly totalVolumePct: number | null
  readonly totalFeesPct: number | null
  readonly totalBuilderFeesPct: number | null
  readonly uniqueBuildersPct?: number | null
  readonly uniqueUsersPct: number | null
}

export interface BuildersStatsData {
  readonly timeframe: BuilderTimeframe
  readonly current: BuilderStatsBlock
  readonly previous: BuilderStatsBlock
  readonly variations: BuilderVariations
}

export type BuildersStatsAllTimeframesData = Record<BuilderTimeframe, Omit<BuildersStatsData, 'timeframe'>>

export interface BuilderCoinBreakdown {
  readonly coin: Coin
  readonly coinMeaning: string
  readonly fillCount: number
  readonly totalVolume: number
  readonly totalFees: number
  readonly totalBuilderFees: number
  readonly uniqueUsers: number
}

export interface BuilderAddrStatsData {
  readonly builder: Address
  readonly builderName: string | null
  readonly timeframe: BuilderTimeframe
  readonly current: BuilderStatsBlock
  readonly previous: BuilderStatsBlock
  readonly variations: BuilderVariations
  readonly coinBreakdown: ReadonlyArray<BuilderCoinBreakdown>
}

export interface BuilderUser {
  readonly user: Address
  readonly fillCount: number
  readonly totalVolume: number
  readonly totalFees: number
  readonly totalBuilderFees: number
  readonly uniqueCoins: number
}

export interface BuilderUsersData {
  readonly timeframe: BuilderTimeframe
  readonly builder: Address
  readonly users: ReadonlyArray<BuilderUser>
}

export interface BuilderEntry {
  readonly address: Address
  readonly name: string | null
  readonly referredBy: Address | null
  readonly referrerStage: ReferrerStage
}

// Request types
export interface BuildersTopParams { readonly timeframe?: BuilderTimeframe; readonly sort?: BuilderTopSort; readonly limit?: number; readonly offset?: number }   // limit 1..100
export interface BuildersStatsParams { readonly timeframe?: BuilderTimeframe }
export interface BuilderAddrStatsParams { readonly timeframe?: BuilderTimeframe }
export interface BuilderUsersParams { readonly timeframe?: BuilderTimeframe; readonly limit?: number }
```

---

## 10. TWAPs (batch-6)

```ts
// src/types/twap.ts

export type TwapStatusKnown = 'activated' | 'finished' | 'terminated'
export type TwapStatusError = `error: ${string}`
export type TwapStatus = TwapStatusKnown | TwapStatusError

export type TwapStatusFilter = TwapStatusKnown | 'all'

export interface Twap {
  readonly twapId: number
  readonly status: TwapStatus
  readonly coin: Coin
  readonly user: Address
  readonly side: Side
  readonly sz: number
  readonly executedSz: number
  readonly executedNtl: number
  readonly minutes: number
  readonly reduceOnly: boolean
  readonly randomize: boolean
  readonly startTime: IsoTimestamp      // sentinel "1970-01-01T00:00:00" → null in time$()
  readonly updatedAt: IsoTimestamp
  readonly executionPct?: number        // present on user-scoped + detail; 0..100
}

export interface TwapEvent {
  readonly eventTime: IsoTimestamp
  readonly status: TwapStatus
  readonly executedSz: number
  readonly executedNtl: number
}

export interface TwapFillAggregate {
  readonly fillCount: number
  readonly totalNotional: number
  readonly totalSz: number
  readonly avgPx: number
  readonly minPx: number
  readonly maxPx: number
  readonly totalFees: number
  readonly totalBuilderFees: number
  readonly firstFill: IsoTimestamp
  readonly lastFill: IsoTimestamp
}

export interface TwapDetail {
  readonly meta: Twap
  readonly events: ReadonlyArray<TwapEvent>
  readonly fills: TwapFillAggregate
}

export interface TwapsStatsData {
  readonly hours: number
  readonly totalTwaps: number
  readonly totalExecutedNtl: number
  readonly byStatus: ReadonlyArray<{
    readonly status: TwapStatus
    readonly count: number
    readonly totalSz: number
    readonly executedSz: number
    readonly executedNtl: number
    readonly avgMinutes: number
    readonly uniqueUsers: number
    readonly uniqueCoins: number
  }>
  readonly fills: {
    readonly count: number
    readonly volume: number
    readonly totalFees: number
    readonly uniqueUsers: number
    readonly uniqueTwaps: number
  }
}

// /twaps/{id}/fills returns the perp Fill shape from §1, plus `builderFee` field.
export interface TwapFill extends Omit<Fill, 'liquidationRole' | 'liqMarkPx' | 'liqMethod' | 'liquidatedUser' | 'isLiquidation' | 'startPosition' | 'closedPnl' | 'dir'> {
  readonly builderFee: number
}

// Request types
export type TwapsOrder = 'asc' | 'desc'

export interface TwapsListParams {
  readonly status?: TwapStatusFilter
  readonly coin?: Coin
  readonly user?: Address
  readonly order?: TwapsOrder
  readonly limit?: number               // 1..500
  readonly offset?: number
}

export interface TwapsStatsParams {
  readonly hours?: number
  readonly coin?: Coin
}

export interface TwapsUserParams {
  readonly status?: TwapStatusFilter
  readonly order?: TwapsOrder
  readonly limit?: number               // 1..200
  readonly offset?: number
}

export interface TwapFillsParams {
  readonly limit?: number               // 1..1000
  readonly offset?: number
}
```

---

## 11. Funding (batch-7) — bare envelope

```ts
// src/types/funding.ts

export interface FundingRate {
  readonly coin: Coin
  readonly fundingRate: string          // string-encoded float, e.g. "-0.0000101097"
  readonly premium: string
  readonly time: EpochMs
}

export interface FundingHistoryParams {
  readonly coin: Coin                   // required
  readonly startTime?: TimeInput
  readonly endTime?: TimeInput
  readonly limit?: number               // 1..5000, default 500
}

export interface UserFundingParams {
  readonly user: Address
  readonly startTime?: TimeInput
  readonly endTime?: TimeInput
  readonly limit?: number
}

// Untyped in swagger; placeholder until live data is captured.
export interface FundingPayment {
  readonly time: EpochMs
  readonly coin: Coin
  readonly usdc: string                 // assumed string per Hyperliquid convention
  readonly szi: string
  readonly delta: string
}
```

---

## 12. Vaults (batch-7) — bare envelope

```ts
// src/types/vault.ts

export interface VaultSummary {
  readonly vaultAddress: Address
  readonly name: string
  readonly leader: Address
  readonly leaderCommission: number     // 0..1
  readonly isClosed: boolean
  readonly followerCount: number
  readonly snapshotTime: EpochMs
  readonly createTime: EpochMs
}

export interface VaultDetails extends VaultSummary {
  readonly lockupDurationSeconds: number
  readonly allowDeposits: boolean
  // Renamed from `portfolio` — actually leader-commission history (PLAN bug #24)
  readonly leaderCommissionHistory: ReadonlyArray<{
    readonly time: EpochMs
    readonly followerCount: number
    readonly leaderCommission: number
  }>
}

export interface VaultDailySnapshot {
  readonly time: EpochMs
  readonly day: DateOnly
  readonly totalDeposits: number
  readonly accountValue: number
  readonly totalNotional: number
  readonly totalRawPnl: number
  readonly nPositions: number
  readonly followerCount: number
}

export interface VaultEquitySnapshot {
  readonly time: EpochMs
  readonly totalDeposits: number
  readonly accountValue: number
  readonly totalNotional: number
  readonly totalRawPnl: number
  readonly nPositions: number
  readonly followerCount: number
}

export interface VaultLedgerTx {
  readonly time: EpochMs
  readonly txHash: Hex
  readonly userFrom: Address
  readonly userTo: Address
  readonly amount: number
  readonly token: 'USDC' | string
  readonly kind: 'deposit' | 'withdraw'   // synthesized from userTo === vaultAddress
}

// Untyped in swagger; placeholder until live data captured.
export interface UserVaultEquity {
  readonly vaultAddress: Address
  readonly equity: string
  readonly lockedUntil?: EpochMs
}

// Request types
export interface VaultDetailsParams { readonly vaultAddress: Address; readonly startTime?: TimeInput; readonly endTime?: TimeInput }
export interface VaultSummariesParams { readonly limit?: number; readonly includeClosed?: boolean }
export interface VaultSnapshotsParams { readonly vaultAddress: Address; readonly startTime?: TimeInput; readonly endTime?: TimeInput; readonly limit?: number }
export interface VaultLedgerParams { readonly vaultAddress: Address; readonly user?: Address; readonly startTime?: TimeInput; readonly endTime?: TimeInput; readonly limit?: number }
export interface UserVaultEquitiesParams { readonly user: Address }
```

---

## 13. Spot (batch-7) — currently broken

```ts
// src/types/spot.ts
// NOTE: every method in resources/spot.ts throws ServerError on call.
// Types below are derived from swagger only — unverified against live data.

export interface SpotToken {
  readonly index: number
  readonly name: string
  readonly weiDecimals: number
  readonly szDecimals: number
  readonly isCanonical: boolean
}

export interface SpotPair {
  readonly index: number
  readonly name: string
  readonly tokens: readonly [number, number]
}

export interface SpotAuctionLive {
  readonly auctionId: number
  readonly startTime: IsoTimestamp
  readonly currentPrice: number
}

export interface SpotAuctionHist {
  readonly auctionId: number
  readonly startTime: IsoTimestamp
  readonly endTime: IsoTimestamp
  readonly winner: Address | null
  readonly clearedPrice: number
}
```

---

## 14. EVM (batch-8)

```ts
// src/types/evm.ts

export interface EvmStats {
  readonly totalBlocks: number
  readonly totalTransactions: number
  readonly totalLogs: number
  readonly firstBlock: number
  readonly lastBlock: number
  readonly firstBlockTime: IsoTimestamp
  readonly lastBlockTime: IsoTimestamp
}

export interface EvmDailyStat {
  readonly day: DateOnly
  readonly blocks: number
  readonly transactions: number
  readonly systemTxs: number
  readonly gasUsed: number
}

export interface EvmBlock {
  readonly blockTime: IsoTimestamp
  readonly blockNumber: number
  readonly blockHash: Hex
  readonly parentHash: Hex
  readonly gasLimit: number
  readonly gasUsed: number
  readonly baseFeePerGas: number
  readonly txCount: number
  readonly systemTxCount: number
}

export type EvmTxType = 'Eip1559' | string

export interface EvmTransaction {
  readonly blockTime: IsoTimestamp
  readonly blockNumber: number
  readonly txIndex: number
  readonly txHash: Hex | ''             // empty in every observed row (bug #10)
  readonly txType: EvmTxType
  readonly fromAddr: Address | ''       // empty in every observed row (bug #10)
  readonly toAddr: Address
  readonly valueWei: Wei
  readonly gasLimit: number
  readonly gasUsed: number
  readonly success: boolean             // wire int 0/1
  readonly inputLen: number
  readonly isSystemTx: boolean          // wire int 0/1
  readonly txKey: string                // synthesized: `${blockNumber}:${txIndex}`
}

export interface EvmLog {
  readonly blockTime: IsoTimestamp
  readonly blockNumber: number
  readonly txIndex: number
  readonly logIndex: number
  readonly address: Address
  readonly topic0: Hex
  readonly topic1: Hex | ''
  readonly topic2: Hex | ''
  readonly topic3: Hex | ''
  readonly data: Hex
}

export type EvmLedgerActionType = 'usdSend' | 'spotSend' | 'subAccount' | string   // loose enum

export interface EvmLedgerTransfer {
  readonly time: IsoTimestamp
  readonly blockHeight: number
  readonly txHash: Hex
  readonly actionType: EvmLedgerActionType
  readonly userFrom: Address
  readonly userTo: Address
  readonly token: string                // "USDC" | "HYPE" | "SYM:0x<32hex>"
  readonly amountRaw: Wei
  readonly amount: number
  readonly sourceDex: string | null
  readonly destinationDex: string | null
}

export type EvmBridgeEventType = 'withdrawal_finalized' | 'deposit_vote' | 'withdraw3' | string

export interface EvmBridgeEvent {
  readonly time: IsoTimestamp
  readonly blockHeight: number
  readonly eventType: EvmBridgeEventType
  readonly userAddr: Address
  readonly validator: Address | ''
  readonly amount: number
  readonly destination: string
  readonly nonce: number
  readonly raw: string                  // JSON string or '' for withdraw3
}

export type EvmUserLedgerEventType =
  | 'deposit' | 'withdrawal' | 'transfer_in' | 'transfer_out'
  | 'class_transfer' | 'sub_account' | 'vault' | 'agent_send'

export interface EvmUserLedgerEvent {
  readonly time: IsoTimestamp
  readonly eventType: EvmUserLedgerEventType
  readonly counterparty: Address | ''
  readonly token: string
  readonly amount: number
  readonly amountRaw: Wei
  readonly txHash: Hex
  readonly sourceDex: string | null
  readonly destinationDex: string | null
}

export interface EvmUserLedgerSummaryRow {
  readonly actionType: string
  readonly count: number
  readonly totalAmount: number
  readonly tokens: ReadonlyArray<string>
}

export interface EvmBackstopHealth {
  readonly dexId: string
  readonly backstopAddress: Address
  readonly dexIndex: number
  readonly principalDepositedUsdc: number
  readonly principalWithdrawnUsdc: number
  readonly netPrincipalUsdc: number
  readonly fillCount: number
  readonly notionalTraded: number
  readonly feesPaid: number
  readonly fillsLast24h: number
  readonly lastFillTime: IsoTimestamp
  readonly coinsActive: number
  readonly firstFillTime: IsoTimestamp
}

export interface EvmBackstopFill {
  readonly time: IsoTimestamp
  readonly dexId: string
  readonly coin: Coin                   // "<dex>:<TICKER>"
  readonly side: Side
  readonly px: number
  readonly sz: number
  readonly notional: number
  readonly fee: number
  readonly isLiquidation: boolean
  readonly hash: Hex
}

export interface EvmBackstopTransfer {
  readonly time: IsoTimestamp
  readonly dexId: string
  readonly isDeposit: boolean
  readonly signer: Address
  readonly amount: number
  // observed-empty in samples; types from swagger
}

export interface EvmBackstopTransfersSummary {
  readonly dexId: string
  readonly totalDepositedUsdc: number
  readonly totalWithdrawnUsdc: number
  readonly netPrincipalUsdc: number
  readonly transferCount: number
}

// Request types
export interface EvmBlocksParams { readonly startBlock?: number; readonly endBlock?: number; readonly startTime?: TimeInput; readonly endTime?: TimeInput; readonly limit?: number; readonly offset?: number }
export interface EvmTransactionsParams { readonly toAddr?: Address; readonly blockNumber?: number; readonly includeSystem?: boolean; readonly startTime?: TimeInput; readonly endTime?: TimeInput; readonly limit?: number; readonly offset?: number }
export interface EvmLogsParams { readonly address?: Address; readonly topic0?: Hex; readonly blockNumber?: number; readonly limit?: number; readonly offset?: number }
export interface EvmLedgerTransfersParams { readonly actionType?: EvmLedgerActionType; readonly token?: string; readonly user?: Address; readonly startTime?: TimeInput; readonly endTime?: TimeInput; readonly limit?: number; readonly offset?: number }
export interface EvmBridgeEventsParams { readonly eventType?: EvmBridgeEventType; readonly user?: Address; readonly startTime?: TimeInput; readonly endTime?: TimeInput; readonly limit?: number; readonly offset?: number }
export interface EvmUserLedgerEventsParams { readonly eventType?: EvmUserLedgerEventType | ReadonlyArray<EvmUserLedgerEventType>; readonly token?: string; readonly startTime?: TimeInput; readonly endTime?: TimeInput; readonly limit?: number; readonly offset?: number }
export interface EvmStatsDailyParams { readonly days?: number }   // 1..365
export interface EvmBackstopFillsParams { readonly coin?: Coin; readonly limit?: number; readonly offset?: number }
export interface EvmBackstopTransfersParams { readonly dex?: string; readonly isDeposit?: boolean; readonly limit?: number; readonly offset?: number }
```

---

## 15. Priority fees / gossip (batch-2 + batch-9)

```ts
// src/types/priority-fees.ts (extends analytics types)

export interface GossipAuction {
  readonly slotId: number               // 0..4
  readonly startTime: IsoTimestamp
  readonly durationSeconds: number
  readonly startGas: number
  readonly currentGas: number | null
  readonly endGas: number | null
  readonly winner: string               // IPv4 string
  readonly lastUpdate: IsoTimestamp
}

export interface GossipLiveStatus {
  readonly previousWinners: ReadonlyArray<string | null>   // 5-tuple aligned to slot 0..4
  readonly currentAuctions: ReadonlyArray<GossipAuction>
}

export interface GossipHistoryEntry {
  readonly slotId: number               // 0..4
  readonly startTime: IsoTimestamp
  readonly durationSeconds: number
  readonly startGas: number
  readonly endGas: number | null
  readonly winner: string               // IPv4
  readonly snapshotTs: IsoTimestamp
}

export interface GossipHistoryParams {
  readonly slotId?: number              // 0..4 (422 on 5)
  readonly winner?: string              // IPv4
  readonly startTime?: TimeInput
  readonly endTime?: TimeInput
  readonly limit?: number
}
```

---

## 16. WebSocket (batch-9)

```ts
// src/types/ws.ts

export type WSChannel = 'completed_trades' | 'fills_spot' | 'recent_activity' | 'liquidation' | 'hip4_events'

export interface WSWelcomeFrame {
  readonly type: 'welcome'
  readonly message: string
  readonly availableMethods: ReadonlyArray<string>
  readonly availableSubscriptions: ReadonlyArray<string>
}

export interface WSSubscriptionsListFrame {
  readonly type: 'subscriptions_list'
  readonly activeSubscriptions: ReadonlyArray<string>
}

export interface WSSubscriptionAddedFrame {
  readonly type: 'subscription_added'
  readonly subscription: { readonly type: WSChannel; readonly user?: Address; readonly status: 'active' }
  readonly activeSubscriptions: ReadonlyArray<string>
}

export interface WSSubscriptionRemovedFrame {
  readonly type: 'subscription_removed'
  readonly subscription: { readonly type: WSChannel; readonly status: 'inactive' }
  readonly activeSubscriptions: ReadonlyArray<string>
}

export interface WSErrorFrame {
  readonly type: 'error'
  readonly message: string
}

export type WSControlFrame =
  | WSWelcomeFrame
  | WSSubscriptionsListFrame
  | WSSubscriptionAddedFrame
  | WSSubscriptionRemovedFrame
  | WSErrorFrame

// Push frames — normalized to {channel, count, items} by the SDK dispatcher.
// `data[]` element type narrows per channel.

export interface WSCompletedTradesMessage {
  readonly channel: 'completed_trades'
  readonly count: number
  readonly items: ReadonlyArray<TradeFill>
}

export interface WSFillsSpotMessage {
  readonly channel: 'fills_spot'
  readonly count: number
  readonly items: ReadonlyArray<SpotFill>
}

export interface WSLiquidationMessage {
  readonly channel: 'liquidation'
  readonly count: number
  readonly items: ReadonlyArray<Liquidation>
}

export interface WSHip4EventMessage {
  readonly channel: 'hip4_events'
  readonly count: number
  readonly items: ReadonlyArray<Hip4Settlement | Hip4Fill>   // multiplexed; discriminate at use
}

export type WSRecentActivityItem =
  | (TradeFill & { readonly stream: 'completed_trades' })
  | (SpotFill & { readonly stream: 'fills_spot' })
  | (Liquidation & { readonly stream: 'liquidation' })

export interface WSRecentActivityMessage {
  readonly channel: 'recent_activity'
  readonly count: number
  readonly items: ReadonlyArray<WSRecentActivityItem>
}

export type WSPushMessage =
  | WSCompletedTradesMessage
  | WSFillsSpotMessage
  | WSLiquidationMessage
  | WSHip4EventMessage
  | WSRecentActivityMessage

// Outbound
export type WSSubscription =
  | { readonly type: 'completed_trades'; readonly user?: Address }
  | { readonly type: 'fills_spot' }
  | { readonly type: 'recent_activity' }
  | { readonly type: 'liquidation' }
  | { readonly type: 'hip4_events' }

export type WSOutbound =
  | { readonly method: 'list_subscriptions' }
  | { readonly method: 'subscribe'; readonly subscription: WSSubscription }
  | { readonly method: 'unsubscribe'; readonly subscription: WSSubscription }
```

---

## 17. `/info` dispatcher (batch-9)

```ts
// src/types/info.ts

// Discriminated union of every verified `type`. Each variant maps to the same
// typed return as the corresponding REST method.
export type InfoRequest =
  | { readonly type: 'fills'; readonly market?: 'perp' | 'spot'; readonly user?: Address; readonly coin?: Coin; readonly limit?: number; readonly cursor?: string }
  | { readonly type: 'recentFills'; readonly coin?: Coin; readonly limit?: number; readonly cursor?: string }
  | { readonly type: 'fillsSummary'; readonly user?: Address; readonly coin?: Coin }   // CF 524 today
  | { readonly type: 'fillsByTradeId'; readonly tradeId: string }
  | { readonly type: 'tradeHistory'; readonly user: Address; readonly limit?: number }
  | { readonly type: 'accountOverview'; readonly user: Address }
  | { readonly type: 'fillAnalytics'; readonly hours?: number; readonly coin?: Coin }
  | { readonly type: 'bestTraders24h'; readonly sort?: TopTraderSort; readonly limit?: number }
  | { readonly type: 'volume24h' }
  | { readonly type: 'liqHistory'; readonly coin?: Coin; readonly limit?: number; readonly cursor?: string }
  | { readonly type: 'twapList'; readonly status?: TwapStatusFilter; readonly limit?: number }   // CF 524 today
  | { readonly type: 'topBuilders'; readonly timeframe?: BuilderTimeframe; readonly sort?: BuilderTopSort; readonly limit?: number }
  | { readonly type: 'hip3Summary' }
  | { readonly type: 'hip3DexList'; readonly limit?: number; readonly offset?: number }
  | { readonly type: 'hip3Snapshots'; readonly dexId?: string; readonly coin?: Coin }
  | { readonly type: 'spotTokenList' }   // 500 today
  | { readonly type: 'spotPairList' }    // 500 today
  | { readonly type: 'currentFundingRates' }   // SDK unwraps APIResponse
  | { readonly type: 'vaultList' }              // SDK unwraps APIResponse
  | { readonly type: 'gossipLiveStatus' }

// Return-type map — narrows on R['type']
export type InfoResponse<R extends InfoRequest> =
  R extends { type: 'fills' | 'recentFills' } ? Fill[] :
  R extends { type: 'fillsByTradeId' } ? TradeFill[] :
  R extends { type: 'tradeHistory' } ? Trade[] :
  R extends { type: 'accountOverview' } ? UserOverview :
  R extends { type: 'fillAnalytics' } ? FillsStatsData :
  R extends { type: 'bestTraders24h' } ? TopTraderEntry[] :
  R extends { type: 'volume24h' } ? KpiCard<number> :
  R extends { type: 'liqHistory' } ? Liquidation[] :
  R extends { type: 'twapList' } ? Twap[] :
  R extends { type: 'topBuilders' } ? BuildersTopData :
  R extends { type: 'hip3Summary' } ? Hip3Overview :
  R extends { type: 'hip3DexList' } ? DexRegistry[] :
  R extends { type: 'hip3Snapshots' } ? LiveSnapshot[] :
  R extends { type: 'spotTokenList' } ? SpotToken[] :
  R extends { type: 'spotPairList' } ? SpotPair[] :
  R extends { type: 'currentFundingRates' } ? FundingRate[] :
  R extends { type: 'vaultList' } ? VaultSummary[] :
  R extends { type: 'gossipLiveStatus' } ? GossipLiveStatus :
  R extends { type: 'fillsSummary' } ? TradesSummary :
  never
```

---

## 18. Configuration / client

```ts
// src/types/config.ts

export interface ClientConfig {
  readonly apiKey: string
  readonly baseUrl?: string                 // default: https://api.hypedexer.com
  readonly wsUrl?: string                   // default: wss://api.hypedexer.com/ws
  readonly fetch?: typeof fetch
  readonly timeoutMs?: number               // default: 30_000
  readonly transport?: 'node' | 'browser'   // default: 'node'; 'browser' WS throws today
  readonly logger?: Logger
}

export interface Logger {
  debug(message: string, meta?: Record<string, unknown>): void
  info(message: string, meta?: Record<string, unknown>): void
  warn(message: string, meta?: Record<string, unknown>): void
  error(message: string, meta?: Record<string, unknown>): void
}
```
