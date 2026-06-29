import type { Address, Coin, Hex, Side } from './common.js'
import type { Fill } from './fill.js'
import type { Liquidation } from './liquidation.js'

/**
 * Canonical WS channel allowlist, sourced from the welcome frame observed in
 * batch-9 (PLAN §H.1). Frozen tuple at compile time so {@link WSChannel} stays
 * a literal union; the runtime allowlist used by the transport is initialised
 * from this set and then **augmented** by any extra entries advertised in the
 * server's welcome `available_subscriptions` list, so future server-side
 * additions don't immediately break the SDK (PLAN §H.4, bug #18).
 *
 * Note: `liquidation` is **singular**, as advertised by the server. Treating it
 * as `liquidations` would silently fail (server-side bogus-channel accept; see
 * PLAN §I bug #18).
 */
export const KNOWN_CHANNELS = [
  'completed_trades',
  'fills_spot',
  'recent_activity',
  'liquidation',
  'hip4_events',
] as const

/** Literal union of valid WS channel names; see PLAN §H.1. */
export type WSChannel = (typeof KNOWN_CHANNELS)[number]

/**
 * Single completed-trade item pushed on the `completed_trades` channel. Per
 * batch-9 the shape matches REST `tradeHistory` rows.
 *
 * Field semantics:
 * - `user` — taker wallet address.
 * - `coin`/`coinMeaning` — raw coin token (e.g. `@142`) and decoded label.
 * - `px`/`sz` — execution price and size (base units).
 * - `side` — `'B'` (buy) or `'A'` (ask/sell); see {@link Side}.
 * - `time` — ISO-8601 without timezone, µs precision (PLAN §E.1 format #1).
 * - `startPosition` — taker's signed position before the fill.
 * - `dir` — human dir tag (e.g. `"Open Long"`, `"Close Short"`).
 * - `closedPnl` — realised PnL from closing portion of the fill, in USDC.
 * - `hash` — L1 tx hash if available.
 * - `oid` — order id; `tid` — trade id (server-issued, unique per fill).
 * - `fee`/`feeToken` — fee paid and token denomination.
 * - `typeTrade` — `'perp'` or `'spot'`.
 */
export interface CompletedTradeItem {
  readonly user: Address
  readonly coin: Coin
  readonly coinMeaning?: string
  readonly px: number
  readonly sz: number
  readonly side?: Side
  /** ISO no TZ, µs precision (see PLAN §E.1 format #1). */
  readonly time: string
  readonly startPosition?: number
  readonly dir?: string
  readonly closedPnl?: number
  readonly hash?: Hex
  readonly oid?: number
  readonly tid: number
  readonly fee?: number
  readonly feeToken?: string
  readonly typeTrade?: 'perp' | 'spot'
}

/**
 * Minimal `hip4_events` item shape. The batch-9 session observed zero pushes
 * on this channel; the type stays intentionally permissive until live samples
 * are available.
 *
 * Field semantics (best-effort, pending wire samples):
 * - `type` — event discriminator (e.g. settlement, market state change).
 * - `outcome_id` — affected HIP-4 outcome token id, when applicable.
 * - `time` — ISO timestamp of the event.
 * - `data` — opaque payload; consumers should narrow defensively.
 */
export interface Hip4Event {
  readonly type?: string
  readonly outcome_id?: number
  readonly time?: string
  readonly data?: unknown
}

/**
 * `recent_activity` is a multiplexed firehose. Each item carries a `stream`
 * discriminator identifying which underlying channel emitted it. Observed
 * values: `'completed_trades'`, `'fills_spot'` (batch-9); `'liquidation'` is
 * included pre-emptively in case the server re-broadcasts it on this stream.
 *
 * Consumers should switch on `item.stream` to narrow to the per-channel
 * payload shape.
 */
export type RecentActivityItem =
  | ({ readonly stream: 'completed_trades' } & CompletedTradeItem)
  | ({ readonly stream: 'fills_spot' } & Fill)
  | ({ readonly stream: 'liquidation' } & Liquidation)

/**
 * Mapping from WS channel name to the element type carried in
 * {@link WSMessage}`.items`. Used by {@link ItemFor} to per-channel narrow.
 */
export interface ItemForMap {
  completed_trades: CompletedTradeItem
  fills_spot: Fill
  liquidation: Liquidation
  hip4_events: Hip4Event
  recent_activity: RecentActivityItem
}

/** Resolves a channel literal to its push-item type via {@link ItemForMap}. */
export type ItemFor<C extends WSChannel> = ItemForMap[C]

/**
 * Normalized push message dispatched to channel listeners. Wire shape is
 * `{type, count, data}` (PLAN §H.6, batch-9); the SDK renames `type → channel`
 * and `data → items` so user code never confuses a push with a control frame.
 *
 * The generic parameter `C extends WSChannel` per-channel narrows `items` to
 * `ReadonlyArray<ItemFor<C>>` via the {@link ItemForMap} lookup, so listeners
 * registered for e.g. `'fills_spot'` see `items: ReadonlyArray<Fill>` without
 * a runtime cast.
 */
export interface WSMessage<C extends WSChannel> {
  readonly channel: C
  readonly count: number
  readonly items: ReadonlyArray<ItemFor<C>>
}

/** Wire-level push frame (pre-normalization); see PLAN §H.6 (batch-9). */
export interface WSPushFrame {
  readonly type: string
  readonly count: number
  readonly data: ReadonlyArray<unknown>
}

/**
 * Welcome control frame — first message after the upgrade succeeds. Carries
 * the canonical `available_subscriptions` list used to seed/augment the
 * client-side allowlist (PLAN §H.4, batch-9).
 */
export interface WSWelcomeFrame {
  readonly type: 'welcome'
  readonly message?: string
  readonly available_methods?: ReadonlyArray<string>
  readonly available_subscriptions: ReadonlyArray<string>
}

/** Reply to `list_subscriptions`; reports currently-active subs (batch-9). */
export interface WSSubscriptionsListFrame {
  readonly type: 'subscriptions_list'
  readonly active_subscriptions: ReadonlyArray<string>
}

/**
 * Ack for a `subscribe` request; also fires unsolicited on resync. Note the
 * server accepts bogus channel names here (PLAN §I bug #18, batch-9), which is
 * why the SDK validates against {@link KNOWN_CHANNELS} before sending.
 */
export interface WSSubscriptionAddedFrame {
  readonly type: 'subscription_added'
  readonly subscription: {
    readonly type: string
    readonly user?: string
    readonly status?: string
  }
  readonly active_subscriptions?: ReadonlyArray<string>
}

/** Ack for an `unsubscribe` request; mirrors `subscription_added` (batch-9). */
export interface WSSubscriptionRemovedFrame {
  readonly type: 'subscription_removed'
  readonly subscription: {
    readonly type: string
    readonly user?: string
    readonly status?: string
  }
  readonly active_subscriptions?: ReadonlyArray<string>
}

/**
 * Server-emitted error frame (batch-9). Note this is distinct from
 * transport-level close codes (e.g. the spurious `1011` returned on graceful
 * close, PLAN §I bug #20, which is surfaced via reconnect/`error` events on
 * the transport rather than via this frame type).
 */
export interface WSErrorFrame {
  readonly type: 'error'
  readonly message: string
}

/** All server → client control frame shapes (batch-9 inventory). */
export type WSControlFrame =
  | WSWelcomeFrame
  | WSSubscriptionsListFrame
  | WSSubscriptionAddedFrame
  | WSSubscriptionRemovedFrame
  | WSErrorFrame

/**
 * Outbound (client → server) frame shapes. The SDK never sends raw-string
 * frames — they crash the server (PLAN §I bug #18, batch-9) — so this union
 * is the only thing that ever hits the socket.
 */
export type WSOutboundFrame =
  | { method: 'list_subscriptions' }
  | { method: 'subscribe'; subscription: { type: string; user?: string } }
  | { method: 'unsubscribe'; subscription: { type: string; user?: string } }
