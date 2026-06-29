export const VERSION = '0.0.0'

// -----------------------------------------------------------------------------
// Common types & envelopes
// -----------------------------------------------------------------------------

export type {
  Address,
  Coin,
  EnvelopeFamily,
  Hex,
  Page,
  PageMeta,
  Side,
  Single,
  Wei,
  APIResponse,
  Hip4Envelope,
} from './types/common.js'

// -----------------------------------------------------------------------------
// Errors
// -----------------------------------------------------------------------------

export {
  AuthError,
  HypedexerError,
  NetworkError,
  NotFoundError,
  RateLimitError,
  ServerError,
  ValidationError,
  WebSocketError,
  WSAuthError,
  WSProtocolError,
  WSSubprotocolError,
  parseError,
} from './errors/index.js'
export type { HypedexerErrorOptions, ValidationDetail } from './errors/index.js'

// -----------------------------------------------------------------------------
// Time helpers
// -----------------------------------------------------------------------------

export { encodeTime, parseHip4Expiry, parseTimestamp } from './time/index.js'
export type { TimeEncodeTarget, TimeInput, TimestampMode } from './time/index.js'

// -----------------------------------------------------------------------------
// Transport
// -----------------------------------------------------------------------------

export { HttpClient } from './transport/HttpClient.js'
export type { FetchLike, HttpClientOptions, HttpRequest } from './transport/HttpClient.js'

export { unwrap, unwrapSingle } from './transport/envelopes.js'

export { parseCoin, formatCoin } from './transport/coin.js'
export type { ParsedCoin } from './transport/coin.js'

export { toBigInt, toNumber, parseFundingRate } from './transport/numbers.js'

// -----------------------------------------------------------------------------
// Pagination
// -----------------------------------------------------------------------------

export { iterate } from './pagination/iterator.js'
export type { PageFetcher, PaginationContext, PaginationKind } from './pagination/iterator.js'

// -----------------------------------------------------------------------------
// Internal guards (address / url / assert)
// -----------------------------------------------------------------------------

export {
  ADDRESS_REGEX,
  assertAddress,
  isValidAddress,
  normalizeAddress,
} from './internal/address.js'
export { encodeSegment, joinPath } from './internal/url.js'
export { assertEnum, assertLimit, assertOptionalEnum } from './internal/assert.js'

// -----------------------------------------------------------------------------
// Resource types — Tier-1
// -----------------------------------------------------------------------------

export type {
  AnyFill,
  Fill,
  FillsCount,
  FillsListParams,
  FillsRecentParams,
  FillsTimeRange,
  FillsUserParams,
  SpotFill,
  SpotFillsListParams,
  SpotFillsUserParams,
} from './types/fill.js'

export type {
  AnalyticsIsoTimestamp,
  DateOnly as AnalyticsDateOnly,
  FillsStatsData,
  FillsStatsParams,
  GossipLeaderboardEntry,
  GossipLeaderboardParams,
  LiquidationsStatsData,
  LiquidationsStatsParams,
  PriorityFeesChartDailyParams,
  PriorityFeesDailyPoint,
  PriorityFeesStatsData,
  PriorityFeesStatsParams,
  TimeRangeIso,
} from './types/analytics.js'

export { TOP_TRADER_SORTS } from './types/overview.js'
export type {
  ActiveTraders24h,
  CoinDistributionEntry,
  CoinDistributionParams,
  DailyPnlEntry,
  DailyVolumePoint,
  DailyVolumeParams,
  DateOnly as OverviewDateOnly,
  IsoTimestamp,
  KpiCard,
  TopTraderEntry,
  TopTraderSort,
  TopTradersParams,
  TotalFees24h,
  TotalFills24h,
  TradingVolume24h,
} from './types/overview.js'

export type {
  ActiveUser,
  ActiveUsersParams,
  LeaderboardBy,
  LeaderboardByPnl,
  LeaderboardByPriorityFees,
  LeaderboardByTrades,
  LeaderboardByVolume,
  LeaderboardEntry,
  LeaderboardParams,
  UserCoinAggregate,
  UserCoinsParams,
  UserOverview,
  UserOverviewParams,
  UserPerformance,
} from './types/user.js'

export type {
  CompletedTradesListParams,
  CompletedTradesSummaryParams,
  Direction,
  LeverageType,
  Trade,
  TradeFill,
  TradeSortBy,
  TradeSortDir,
  TradesSummary,
} from './types/trade.js'

export type {
  Liquidation,
  LiquidationOrder,
  LiquidationsListParams,
  LiquidationsRecentParams,
} from './types/liquidation.js'

// -----------------------------------------------------------------------------
// Resource types — Tier-2: HIP-3
// -----------------------------------------------------------------------------

export { AUCTION_STATUSES, HIP3_LEADERBOARD_BY } from './types/hip3.js'
export type {
  AssetConfig,
  Auction,
  AuctionHistory,
  AuctionStatus,
  DexRegistry,
  Hip3AssetsParams,
  Hip3AuctionsHistoryParams,
  Hip3AuctionsParams,
  Hip3DexsParams,
  Hip3Fill,
  Hip3FillsParams,
  Hip3LeaderboardBy,
  Hip3LeaderboardEntry,
  Hip3LeaderboardParams,
  Hip3OhlcvParams,
  Hip3OracleStatsParams,
  Hip3Overview,
  Hip3SnapshotsParams,
  Hip3StatsTradersParams,
  Hip3TopMoversParams,
  Hip3UserCoinsParams,
  Hip3UserFillsParams,
  LiveSnapshot,
  OhlcvBar,
  OracleStats1m,
  TraderStats,
  UserCoinStats,
  UserHip3Overview,
} from './types/hip3.js'

// -----------------------------------------------------------------------------
// Resource types — Tier-2: HIP-4
// -----------------------------------------------------------------------------

export { HIP4_ACTION_TYPES, HIP4_CLASSES, HIP4_INTERVALS } from './types/hip4.js'
export type {
  Hip4ActionType,
  Hip4AnalyticsParams,
  Hip4AnalyticsRow,
  Hip4AnalyticsRowAggregate,
  Hip4AnalyticsRowByCoin,
  Hip4Class,
  Hip4DateOnly,
  Hip4Expiry,
  Hip4Fee,
  Hip4FeeScale,
  Hip4FeesParams,
  Hip4Fill,
  Hip4FillsParams,
  Hip4Interval,
  Hip4IsoTimestamp,
  Hip4Market,
  Hip4MarketsParams,
  Hip4Outcome,
  Hip4OutcomeToken,
  Hip4OutcomeTokensParams,
  Hip4OutcomesParams,
  Hip4Question,
  Hip4QuestionsParams,
  Hip4Settlement,
  Hip4SettlementsParams,
  Hip4UserAction,
  Hip4UserActionsParams,
  ParsedHip4Description,
} from './types/hip4.js'

// -----------------------------------------------------------------------------
// Resource types — Tier-2: Builders
// -----------------------------------------------------------------------------

export type {
  Builder,
  BuilderAddrStatsData,
  BuilderAddrStatsParams,
  BuilderCoinBreakdown,
  BuilderEntry,
  BuilderStatsBlock,
  BuilderTimeframe,
  BuilderTopSort,
  BuilderUser,
  BuilderUsersData,
  BuilderUsersParams,
  BuilderVariations,
  BuildersStatsAllTimeframesData,
  BuildersStatsData,
  BuildersStatsParams,
  BuildersTopData,
  BuildersTopParams,
  ReferrerStage,
} from './types/builder.js'

// -----------------------------------------------------------------------------
// Resource types — Tier-2: TWAPs
// -----------------------------------------------------------------------------

export type {
  Twap,
  TwapDetail,
  TwapEvent,
  TwapFill,
  TwapFillAggregate,
  TwapFillsParams,
  TwapStatus,
  TwapStatusError,
  TwapStatusFilter,
  TwapStatusKnown,
  TwapsListParams,
  TwapsOrder,
  TwapsStatsData,
  TwapsStatsFillSummary,
  TwapsStatsParams,
  TwapsStatusBucket,
  TwapsUserParams,
} from './types/twap.js'

// -----------------------------------------------------------------------------
// Resource types — Tier-2: Funding
// -----------------------------------------------------------------------------

export type {
  FundingHistoryParams,
  FundingPayment,
  FundingRate,
  UserFundingParams,
} from './types/funding.js'

// -----------------------------------------------------------------------------
// Resource types — Tier-2: Vaults
// -----------------------------------------------------------------------------

export type {
  DateOnly as VaultDateOnly,
  EpochMs as VaultEpochMs,
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
} from './types/vault.js'

// -----------------------------------------------------------------------------
// Resource types — Tier-2: Priority Fees (gossip)
// -----------------------------------------------------------------------------

export type {
  GossipAuction,
  GossipHistoryEntry,
  GossipHistoryParams,
  GossipIsoTimestamp,
  GossipLiveStatus,
} from './types/priority-fees.js'

// -----------------------------------------------------------------------------
// Resource types — Tier-2: /info dispatcher
// -----------------------------------------------------------------------------

export type {
  InfoBestTradersBody,
  InfoFillAnalyticsBody,
  InfoFillsBody,
  InfoFillsByTradeIdBody,
  InfoFillsSummaryBody,
  InfoHip3DexListBody,
  InfoHip3SnapshotsBody,
  InfoLiqHistoryBody,
  InfoRequest,
  InfoResultMap,
  InfoTopBuildersBody,
  InfoTwapListBody,
  InfoType,
  InfoUserBody,
  InfoVaultListBody,
} from './types/info.js'

// -----------------------------------------------------------------------------
// Resources — Tier-1
// -----------------------------------------------------------------------------

export { Fills as FillsResource } from './resources/fills.js'
export { AnalyticsResource } from './resources/analytics.js'
export { OverviewResource } from './resources/overview.js'
export { UsersResource } from './resources/users.js'
export { CompletedTradesResource } from './resources/completed-trades.js'
export { Liquidations as LiquidationsResource } from './resources/liquidations.js'

// -----------------------------------------------------------------------------
// Resources — Tier-2
// -----------------------------------------------------------------------------

export { Hip3Resource } from './resources/hip3.js'
export { Hip4Resource, parseHip4Description } from './resources/hip4.js'
export { BuildersResource } from './resources/builders.js'
export { TwapsResource } from './resources/twaps.js'
export { FundingResource } from './resources/funding.js'
export { VaultsResource } from './resources/vaults.js'
export { PriorityFeesResource } from './resources/priority-fees.js'
export { InfoResource } from './resources/info.js'

// -----------------------------------------------------------------------------
// Client factory
// -----------------------------------------------------------------------------

export { createClient } from './client.js'
export type { HypedexerClient, HypedexerClientOptions } from './client.js'
