import { AnalyticsResource } from './resources/analytics.js'
import { BuildersResource } from './resources/builders.js'
import { CompletedTradesResource } from './resources/completed-trades.js'
import { EvmResource } from './resources/evm.js'
import { Fills } from './resources/fills.js'
import { FundingResource } from './resources/funding.js'
import { Hip3Resource } from './resources/hip3.js'
import { Hip4Resource } from './resources/hip4.js'
import { InfoResource } from './resources/info.js'
import { Liquidations } from './resources/liquidations.js'
import { OverviewResource } from './resources/overview.js'
import { PriorityFeesResource } from './resources/priority-fees.js'
import { TwapsResource } from './resources/twaps.js'
import { UsersResource } from './resources/users.js'
import { VaultsResource } from './resources/vaults.js'
import { HttpClient, type HttpClientOptions } from './transport/HttpClient.js'

/**
 * Construction options for {@link createClient}. Identical to
 * {@link HttpClientOptions} — the factory wires a single `HttpClient` into all
 * resources.
 */
export interface HypedexerClientOptions extends HttpClientOptions {}

/**
 * Top-level SDK surface returned by {@link createClient}. Exposes one
 * resource handle per logical endpoint group plus the underlying
 * {@link HttpClient} (for escape-hatch raw calls and tests).
 */
export interface HypedexerClient {
  // Tier-1 — fills, analytics, overview, users, completed-trades, liquidations.
  readonly fills: Fills
  readonly analytics: AnalyticsResource
  readonly overview: OverviewResource
  readonly users: UsersResource
  readonly completedTrades: CompletedTradesResource
  readonly liquidations: Liquidations
  // Tier-2 — hip3, hip4, builders, twaps, funding, vaults, priority-fees, info, evm.
  readonly hip3: Hip3Resource
  readonly hip4: Hip4Resource
  readonly builders: BuildersResource
  readonly twaps: TwapsResource
  readonly funding: FundingResource
  readonly vaults: VaultsResource
  readonly priorityFees: PriorityFeesResource
  readonly info: InfoResource
  readonly evm: EvmResource
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
    // Tier-1
    fills: new Fills(http),
    analytics: new AnalyticsResource(http),
    overview: new OverviewResource(http),
    users: new UsersResource(http),
    completedTrades: new CompletedTradesResource(http),
    liquidations: new Liquidations(http),
    // Tier-2
    hip3: new Hip3Resource(http),
    hip4: new Hip4Resource(http),
    builders: new BuildersResource(http),
    twaps: new TwapsResource(http),
    funding: new FundingResource(http),
    vaults: new VaultsResource(http),
    priorityFees: new PriorityFeesResource(http),
    info: new InfoResource(http),
    evm: new EvmResource(http),
    http,
  }
}
