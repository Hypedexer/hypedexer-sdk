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
// Resource types
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
// Resources
// -----------------------------------------------------------------------------

export { Fills as FillsResource } from './resources/fills.js'
export { AnalyticsResource } from './resources/analytics.js'
export { OverviewResource } from './resources/overview.js'
export { UsersResource } from './resources/users.js'
export { CompletedTradesResource } from './resources/completed-trades.js'
export { Liquidations as LiquidationsResource } from './resources/liquidations.js'

// -----------------------------------------------------------------------------
// Client factory
// -----------------------------------------------------------------------------

export { createClient } from './client.js'
export type { HypedexerClient, HypedexerClientOptions } from './client.js'
