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
import { WSClient } from './transport/ws.js'

/**
 * WS-only options forwarded to the underlying {@link WSClient}. `wsBaseUrl`
 * defaults to `baseUrl` with the scheme rewritten (http→ws, https→wss).
 */
export interface HypedexerWsOptions {
  /** Override the WS base URL. Defaults to `baseUrl` with scheme http→ws. */
  wsBaseUrl?: string
  /** Forwarded to `WSClient` — `'browser'` throws at construction (PLAN §H.2). */
  wsTransport?: 'node' | 'browser'
  /** Forwarded to `WSClient` — auto-reconnect on disconnect (default `true`). */
  wsAutoReconnect?: boolean
  /** Forwarded to `WSClient` — WS-level ping interval (default 25_000 ms). */
  wsHeartbeatMs?: number
  /** Forwarded to `WSClient` — request/ack timeout (default 5_000 ms). */
  wsRequestTimeoutMs?: number
}

/**
 * Construction options for {@link createClient}. Extends {@link HttpClientOptions}
 * with optional {@link HypedexerWsOptions} for the realtime WebSocket client.
 */
export interface HypedexerClientOptions extends HttpClientOptions, HypedexerWsOptions {}

function httpToWsBaseUrl(baseUrl: string | undefined): string | undefined {
  if (baseUrl == null) return undefined
  return baseUrl.replace(/^http(s?):/, (_m, s) => `ws${s}:`)
}

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
  /**
   * Realtime WebSocket client. Construction is cheap (no socket opened) —
   * call `ws.connect()` to actually establish the connection. Optional peer
   * dep `ws` is lazy-loaded on the first connect.
   */
  readonly ws: WSClient
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
  const wsBaseUrl = opts.wsBaseUrl ?? httpToWsBaseUrl(opts.baseUrl)
  const ws = new WSClient({
    apiKey: opts.apiKey,
    ...(wsBaseUrl !== undefined ? { baseUrl: wsBaseUrl } : {}),
    ...(opts.wsTransport !== undefined ? { transport: opts.wsTransport } : {}),
    ...(opts.wsAutoReconnect !== undefined ? { autoReconnect: opts.wsAutoReconnect } : {}),
    ...(opts.wsHeartbeatMs !== undefined ? { heartbeatMs: opts.wsHeartbeatMs } : {}),
    ...(opts.wsRequestTimeoutMs !== undefined ? { requestTimeoutMs: opts.wsRequestTimeoutMs } : {}),
  })
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
    ws,
  }
}
