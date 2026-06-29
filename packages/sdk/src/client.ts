import { AnalyticsResource } from './resources/analytics.js'
import { CompletedTradesResource } from './resources/completed-trades.js'
import { Fills } from './resources/fills.js'
import { Liquidations } from './resources/liquidations.js'
import { OverviewResource } from './resources/overview.js'
import { UsersResource } from './resources/users.js'
import { HttpClient, type HttpClientOptions } from './transport/HttpClient.js'

/**
 * Construction options for {@link createClient}. Identical to
 * {@link HttpClientOptions} — the factory wires a single `HttpClient` into all
 * Tier-1 resources.
 */
export interface HypedexerClientOptions extends HttpClientOptions {}

/**
 * Top-level SDK surface returned by {@link createClient}. Exposes one
 * resource handle per logical endpoint group plus the underlying
 * {@link HttpClient} (for escape-hatch raw calls and tests).
 */
export interface HypedexerClient {
  readonly fills: Fills
  readonly analytics: AnalyticsResource
  readonly overview: OverviewResource
  readonly users: UsersResource
  readonly completedTrades: CompletedTradesResource
  readonly liquidations: Liquidations
  readonly http: HttpClient
}

/**
 * Construct a {@link HypedexerClient} bound to a single shared {@link HttpClient}.
 *
 * All resources reuse the same underlying transport (headers, base URL,
 * timeout, fetch-stub) so cross-resource calls share connection lifecycle and
 * are individually testable by swapping `opts.fetch`.
 */
export function createClient(opts: HypedexerClientOptions): HypedexerClient {
  const http = new HttpClient(opts)
  return {
    fills: new Fills(http),
    analytics: new AnalyticsResource(http),
    overview: new OverviewResource(http),
    users: new UsersResource(http),
    completedTrades: new CompletedTradesResource(http),
    liquidations: new Liquidations(http),
    http,
  }
}
