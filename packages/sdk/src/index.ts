export const VERSION = '0.0.0'

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

export { encodeTime, parseHip4Expiry, parseTimestamp } from './time/index.js'
export type { TimeEncodeTarget, TimeInput, TimestampMode } from './time/index.js'

export { HttpClient } from './transport/HttpClient.js'
export type { FetchLike, HttpClientOptions, HttpRequest } from './transport/HttpClient.js'

export { iterate } from './pagination/iterator.js'
export type { PageFetcher, PaginationContext, PaginationKind } from './pagination/iterator.js'
