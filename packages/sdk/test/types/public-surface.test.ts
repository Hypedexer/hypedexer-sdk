/**
 * Public-surface type regression net.
 *
 * Uses vitest's `expectTypeOf` to pin the shape of every load-bearing public
 * export. Assertions execute at compile time — a breaking change to any of the
 * pinned shapes surfaces as a `tsc` error here, not as a silent contract drift
 * downstream.
 *
 * The runtime bodies are intentionally inert: real method invocations are
 * wrapped in never-called `_typeOnly` closures so vitest does not trigger
 * actual HTTP / WebSocket round-trips. The TypeScript checker still type-checks
 * the closure bodies, which is the whole point of the file.
 *
 * See PLAN.md §A / §B / §H / §I for the surfaces being pinned.
 */

import { describe, expect, expectTypeOf, it } from 'vitest'
import {
  type AnalyticsResource,
  AuthError,
  type BuildersResource,
  type CompletedTradeItem,
  type CompletedTradesResource,
  type EnvelopeFamily,
  type EvmResource,
  type Fill,
  type FillsCount,
  type FillsResource,
  type FundingResource,
  type Hip3Resource,
  type Hip4Resource,
  type HypedexerClient,
  HypedexerError,
  type InfoResource,
  type LeaderboardByPnl,
  type LeaderboardByTrades,
  type LeaderboardByVolume,
  type Liquidation,
  type LiquidationsResource,
  type NetworkError,
  type NotFoundError,
  type OverviewResource,
  type Page,
  type PageMeta,
  type PriorityFeesResource,
  type RateLimitError,
  type ServerError,
  type Single,
  type TwapDetail,
  type TwapStatus,
  type TwapsResource,
  type UserOverview,
  type UsersResource,
  type ValidationError,
  type VaultsResource,
  WSAuthError,
  type WSChannel,
  type WSClient,
  type WSMessage,
  type WSProtocolError,
  type WSSubprotocolError,
  WebSocketError,
  type Wei,
  createClient,
  parseCoin,
  toBigInt,
} from '../../src/index.js'
import type { HttpClient } from '../../src/transport/HttpClient.js'

describe('public surface — type regression net', () => {
  it('1. createClient returns a HypedexerClient with all 16 handles plus http', () => {
    expectTypeOf(createClient).returns.toEqualTypeOf<HypedexerClient>()

    // Spot-check each handle is the right *Resource type so a future rename or
    // accidental swap (e.g. assigning `Fills` to the `liquidations` slot)
    // surfaces here.
    expectTypeOf<HypedexerClient['fills']>().toEqualTypeOf<FillsResource>()
    expectTypeOf<HypedexerClient['analytics']>().toEqualTypeOf<AnalyticsResource>()
    expectTypeOf<HypedexerClient['overview']>().toEqualTypeOf<OverviewResource>()
    expectTypeOf<HypedexerClient['users']>().toEqualTypeOf<UsersResource>()
    expectTypeOf<HypedexerClient['completedTrades']>().toEqualTypeOf<CompletedTradesResource>()
    expectTypeOf<HypedexerClient['liquidations']>().toEqualTypeOf<LiquidationsResource>()
    expectTypeOf<HypedexerClient['hip3']>().toEqualTypeOf<Hip3Resource>()
    expectTypeOf<HypedexerClient['hip4']>().toEqualTypeOf<Hip4Resource>()
    expectTypeOf<HypedexerClient['builders']>().toEqualTypeOf<BuildersResource>()
    expectTypeOf<HypedexerClient['twaps']>().toEqualTypeOf<TwapsResource>()
    expectTypeOf<HypedexerClient['funding']>().toEqualTypeOf<FundingResource>()
    expectTypeOf<HypedexerClient['vaults']>().toEqualTypeOf<VaultsResource>()
    expectTypeOf<HypedexerClient['priorityFees']>().toEqualTypeOf<PriorityFeesResource>()
    expectTypeOf<HypedexerClient['info']>().toEqualTypeOf<InfoResource>()
    expectTypeOf<HypedexerClient['evm']>().toEqualTypeOf<EvmResource>()
    expectTypeOf<HypedexerClient['http']>().toEqualTypeOf<HttpClient>()
    expectTypeOf<HypedexerClient['ws']>().toEqualTypeOf<WSClient>()
  })

  it('2. Page<T> exposes data: T[] and meta: PageMeta with the family discriminant', () => {
    expectTypeOf<Page<Fill>>().toEqualTypeOf<{ data: Fill[]; meta: PageMeta }>()
    expectTypeOf<Page<Fill>['data']>().toEqualTypeOf<Fill[]>()
    expectTypeOf<Page<Fill>['meta']>().toEqualTypeOf<PageMeta>()

    // The envelope family is required on every PageMeta — the canonical
    // discriminant the SDK uses to disambiguate apiResponse vs bare vs hip4
    // (PLAN.md §B).
    expectTypeOf<PageMeta['family']>().toEqualTypeOf<EnvelopeFamily>()
    expectTypeOf<EnvelopeFamily>().toEqualTypeOf<'apiResponse' | 'bare' | 'hip4'>()
  })

  it('3. cursor methods (fills/liquidations list+recent) return Promise<Page<...>>', () => {
    // Use the type-only `expectTypeOf<T>()` form so nothing is evaluated at
    // runtime — the assertions are pure tsc checks.
    type FillsList = HypedexerClient['fills']['list']
    type FillsRecent = HypedexerClient['fills']['recent']
    type LiqList = HypedexerClient['liquidations']['list']
    type LiqRecent = HypedexerClient['liquidations']['recent']

    expectTypeOf<FillsList>().returns.toEqualTypeOf<Promise<Page<Fill>>>()
    expectTypeOf<FillsRecent>().returns.toEqualTypeOf<Promise<Page<Fill>>>()
    expectTypeOf<LiqList>().returns.toEqualTypeOf<Promise<Page<Liquidation>>>()
    expectTypeOf<LiqRecent>().returns.toEqualTypeOf<Promise<Page<Liquidation>>>()
  })

  it('4. iterate methods return AsyncIterable<T> (one per resource family)', () => {
    // Tier-1.
    expectTypeOf<HypedexerClient['fills']['iterate']>().returns.toEqualTypeOf<AsyncIterable<Fill>>()
    expectTypeOf<HypedexerClient['liquidations']['iterate']>().returns.toEqualTypeOf<
      AsyncIterable<Liquidation>
    >()

    // Tier-2 — one canary per family. We don't pin the element type here
    // because each family has its own per-resource row union; the regression
    // we care about is "iterate stays AsyncIterable<...>", caught via
    // structural matching against a generic `AsyncIterable<unknown>`.
    expectTypeOf<HypedexerClient['twaps']['iterate']>().returns.toMatchTypeOf<
      AsyncIterable<unknown>
    >()
    expectTypeOf<HypedexerClient['vaults']['iterate']>().returns.toMatchTypeOf<
      AsyncIterable<unknown>
    >()
    expectTypeOf<HypedexerClient['hip3']['dexs']['iterate']>().returns.toMatchTypeOf<
      AsyncIterable<unknown>
    >()
    expectTypeOf<HypedexerClient['hip4']['markets']['iterate']>().returns.toMatchTypeOf<
      AsyncIterable<unknown>
    >()
    expectTypeOf<HypedexerClient['completedTrades']['iterate']>().returns.toMatchTypeOf<
      AsyncIterable<unknown>
    >()
  })

  it('5. single-record methods return Promise<Single<T>>', () => {
    expectTypeOf<HypedexerClient['fills']['count']>().returns.toEqualTypeOf<
      Promise<Single<FillsCount>>
    >()
    expectTypeOf<HypedexerClient['users']['overview']>().returns.toEqualTypeOf<
      Promise<Single<UserOverview>>
    >()
    expectTypeOf<HypedexerClient['twaps']['get']>().returns.toEqualTypeOf<
      Promise<Single<TwapDetail>>
    >()

    // Single<T> mirrors Page<T> minus the array — the meta envelope is the same.
    expectTypeOf<Single<FillsCount>['data']>().toEqualTypeOf<FillsCount>()
    expectTypeOf<Single<FillsCount>['meta']>().toEqualTypeOf<PageMeta>()
  })

  it('6. polymorphic /users/leaderboard narrows on the `by` literal (PLAN §I #23)', () => {
    // Overload resolution depends on the literal type of `by`, so we must
    // write actual call expressions for tsc to pick the right overload. Wrap
    // them in a never-invoked closure so no network request happens.
    // biome-ignore lint/correctness/noUnusedFunctionParameters: probe arg
    function _typeOnly(c: HypedexerClient): void {
      const volume = c.users.leaderboard({ by: 'volume' })
      const pnl = c.users.leaderboard({ by: 'pnl' })
      const trades = c.users.leaderboard({ by: 'trades' })
      expectTypeOf(volume).toEqualTypeOf<Promise<Page<LeaderboardByVolume>>>()
      expectTypeOf(pnl).toEqualTypeOf<Promise<Page<LeaderboardByPnl>>>()
      expectTypeOf(trades).toEqualTypeOf<Promise<Page<LeaderboardByTrades>>>()
    }
    // `void` keeps tsc happy under `noUnusedLocals` without ever invoking it.
    void _typeOnly

    // The four row shapes are mutually distinct — cross-asserting would
    // compile-fail. This is the canary that catches a future refactor that
    // accidentally widens one row into the others.
    expectTypeOf<LeaderboardByVolume>().not.toEqualTypeOf<LeaderboardByPnl>()
    expectTypeOf<LeaderboardByVolume>().not.toEqualTypeOf<LeaderboardByTrades>()
    expectTypeOf<LeaderboardByPnl>().not.toEqualTypeOf<LeaderboardByTrades>()
  })

  it('7. TwapStatus admits the three known values plus `error: ${string}` (PLAN §I #13)', () => {
    const activated: TwapStatus = 'activated'
    const finished: TwapStatus = 'finished'
    const terminated: TwapStatus = 'terminated'
    const errored: TwapStatus = 'error: Insufficient margin to place order.'

    expectTypeOf(activated).toMatchTypeOf<TwapStatus>()
    expectTypeOf(finished).toMatchTypeOf<TwapStatus>()
    expectTypeOf(terminated).toMatchTypeOf<TwapStatus>()
    expectTypeOf(errored).toMatchTypeOf<TwapStatus>()

    // Reject something that is neither a known value nor an `error: ` prefix.
    // @ts-expect-error — 'in_progress' is not in TwapStatus.
    const bogus: TwapStatus = 'in_progress'
    void bogus
  })

  it('8. parseCoin returns a discriminated ParsedCoin union; spot narrows to {index}', () => {
    const parsed = parseCoin('@107')
    expectTypeOf(parsed).toHaveProperty('kind')

    if (parsed.kind === 'spot') {
      expectTypeOf(parsed).toEqualTypeOf<{ kind: 'spot'; index: number }>()
      expectTypeOf(parsed.index).toEqualTypeOf<number>()
    }
    if (parsed.kind === 'perp') {
      expectTypeOf(parsed).toEqualTypeOf<{ kind: 'perp'; ticker: string }>()
    }
    if (parsed.kind === 'hip3') {
      expectTypeOf(parsed).toEqualTypeOf<{ kind: 'hip3'; dex: string; ticker: string }>()
    }
  })

  it('9. ws.on(channel, handler) narrows the message payload per channel', () => {
    // Wrap the `.on()` calls in a never-invoked closure: tsc still type-checks
    // every handler signature, but vitest doesn't touch the socket.
    // biome-ignore lint/correctness/noUnusedFunctionParameters: probe arg
    function _typeOnly(c: HypedexerClient): void {
      c.ws.on('completed_trades', (msg) => {
        expectTypeOf(msg).toEqualTypeOf<WSMessage<'completed_trades'>>()
        expectTypeOf(msg.items).toEqualTypeOf<ReadonlyArray<CompletedTradeItem>>()
        expectTypeOf(msg.channel).toEqualTypeOf<'completed_trades'>()
        expectTypeOf(msg.count).toEqualTypeOf<number>()
      })
      c.ws.on('fills_spot', (msg) => {
        // `fills_spot` reuses the perp Fill shape (PLAN §H — ItemForMap).
        expectTypeOf(msg.items).toEqualTypeOf<ReadonlyArray<Fill>>()
      })
      c.ws.on('liquidation', (msg) => {
        expectTypeOf(msg.items).toEqualTypeOf<ReadonlyArray<Liquidation>>()
      })

      // Lifecycle events get their own payloads — pinned so they don't drift.
      c.ws.on('open', () => {
        // no-op
      })
      c.ws.on('close', (info) => {
        expectTypeOf(info.code).toEqualTypeOf<number | undefined>()
        expectTypeOf(info.reason).toEqualTypeOf<string | undefined>()
      })
      c.ws.on('reconnect', (info) => {
        expectTypeOf(info.attempt).toEqualTypeOf<number>()
      })
      c.ws.on('error', (err) => {
        expectTypeOf(err).toMatchTypeOf<WebSocketError | RateLimitError | ValidationError>()
      })
    }
    void _typeOnly
  })

  it('10. ws.subscribe enforces the WSChannel literal union', () => {
    // Wrap subscribe() calls in a never-invoked closure — the calls would
    // otherwise reject with `WebSocketError("not connected")` and become an
    // unhandled-rejection in vitest. The tsc check still runs on the body.
    // biome-ignore lint/correctness/noUnusedFunctionParameters: probe arg
    function _typeOnly(c: HypedexerClient): void {
      // Allowed — every literal in WSChannel must accept.
      void c.ws.subscribe('completed_trades')
      void c.ws.subscribe('fills_spot')
      void c.ws.subscribe('recent_activity')
      void c.ws.subscribe('liquidation')
      void c.ws.subscribe('hip4_events')

      // Rejected — bogus channel literal. If `WSChannel` ever widens to
      // `string` (or this literal sneaks in), the `@ts-expect-error` becomes
      // unused and tsc itself raises an error here.
      // @ts-expect-error — 'not_a_channel' is not in WSChannel.
      void c.ws.subscribe('not_a_channel')
    }
    void _typeOnly

    // WSChannel is a closed string-literal union, not a free string.
    expectTypeOf<WSChannel>().toEqualTypeOf<
      'completed_trades' | 'fills_spot' | 'recent_activity' | 'liquidation' | 'hip4_events'
    >()
  })

  it('11. toBigInt accepts Wei-branded strings (Wei is assignable to string)', () => {
    // Wei is `string & { readonly __brand: 'Wei' }` — a structural sub-type of
    // string. `toBigInt` accepts `string | number`, so passing a `Wei` must
    // compile without an assertion / cast.
    const wei = '1000000000000000000' as Wei
    expectTypeOf(toBigInt).parameter(0).toEqualTypeOf<string | number>()
    expectTypeOf(toBigInt(wei)).toEqualTypeOf<bigint>()
    expectTypeOf(toBigInt(42)).toEqualTypeOf<bigint>()
  })

  it('12. error hierarchy — every error class extends HypedexerError', () => {
    // Every public error class is a subclass of `HypedexerError`. We assert
    // via instance types (the natural shape `expectTypeOf` reasons about).
    expectTypeOf<AuthError>().toMatchTypeOf<HypedexerError>()
    expectTypeOf<NetworkError>().toMatchTypeOf<HypedexerError>()
    expectTypeOf<NotFoundError>().toMatchTypeOf<HypedexerError>()
    expectTypeOf<RateLimitError>().toMatchTypeOf<HypedexerError>()
    expectTypeOf<ServerError>().toMatchTypeOf<HypedexerError>()
    expectTypeOf<ValidationError>().toMatchTypeOf<HypedexerError>()
    expectTypeOf<WebSocketError>().toMatchTypeOf<HypedexerError>()
    expectTypeOf<WSAuthError>().toMatchTypeOf<WebSocketError>()
    expectTypeOf<WSProtocolError>().toMatchTypeOf<WebSocketError>()
    expectTypeOf<WSSubprotocolError>().toMatchTypeOf<WebSocketError>()

    // ValidationError exposes a `.detail` ValidationDetail[] field (PLAN §A #14).
    type VErr = InstanceType<typeof ValidationError>
    expectTypeOf<VErr['detail']>().toMatchTypeOf<ReadonlyArray<{ msg: string }>>()

    // WebSocketError exposes `.closeCode` and `.reason` (PLAN §H.3 / §I #20).
    type WSErr = InstanceType<typeof WebSocketError>
    expectTypeOf<WSErr['closeCode']>().toEqualTypeOf<number | undefined>()
    expectTypeOf<WSErr['reason']>().toEqualTypeOf<string | undefined>()

    // Runtime cross-check so vitest doesn't complain about "no assertions"
    // when running this file in `--reporter=verbose`. Also pins the
    // constructor signatures — `new AuthError('x')` is the canonical shape.
    expect(new AuthError('x') instanceof HypedexerError).toBe(true)
    expect(new WSAuthError('x') instanceof WebSocketError).toBe(true)
    // createClient is the single entry point — ensure it stays a value export.
    expect(typeof createClient).toBe('function')
  })
})
