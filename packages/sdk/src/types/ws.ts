import type { Address, Coin, Hex, Side } from './common.js'
import type { Fill } from './fill.js'
import type { Liquidation } from './liquidation.js'

/**
 * Canonical WS channel allowlist, sourced from the welcome frame observed in
 * batch-9. Frozen at compile time. The SDK rejects subscribe calls to anything
 * not in this set (or in the runtime-augmented allowlist; see PLAN §H.4).
 *
 * Note: `liquidation` is **singular**, as advertised by the server. Treating it
 * as `liquidations` would silently fail (server-side bogus-channel accept).
 */
export const KNOWN_CHANNELS = [
  'completed_trades',
  'fills_spot',
  'recent_activity',
  'liquidation',
  'hip4_events',
] as const

export type WSChannel = (typeof KNOWN_CHANNELS)[number]

/**
 * Single completed-trade item pushed on the `completed_trades` channel. Per
 * batch-9 the shape matches REST `tradeHistory` rows.
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
 * values: `'completed_trades'`, `'fills_spot'` (batch-9).
 */
export type RecentActivityItem =
  | ({ readonly stream: 'completed_trades' } & CompletedTradeItem)
  | ({ readonly stream: 'fills_spot' } & Fill)
  | ({ readonly stream: 'liquidation' } & Liquidation)

/** Mapping from WS channel name to the item element type. */
export interface ItemForMap {
  completed_trades: CompletedTradeItem
  fills_spot: Fill
  liquidation: Liquidation
  hip4_events: Hip4Event
  recent_activity: RecentActivityItem
}

export type ItemFor<C extends WSChannel> = ItemForMap[C]

/**
 * Normalized push message dispatched to channel listeners. Wire shape is
 * `{type, count, data}` (PLAN §H.6); the SDK renames `type → channel` and
 * `data → items` so user code never confuses a push with a control frame.
 */
export interface WSMessage<C extends WSChannel> {
  readonly channel: C
  readonly count: number
  readonly items: ReadonlyArray<ItemFor<C>>
}

/** Wire-level push frame (pre-normalization). */
export interface WSPushFrame {
  readonly type: string
  readonly count: number
  readonly data: ReadonlyArray<unknown>
}

/** Welcome frame — first message after the upgrade succeeds. */
export interface WSWelcomeFrame {
  readonly type: 'welcome'
  readonly message?: string
  readonly available_methods?: ReadonlyArray<string>
  readonly available_subscriptions: ReadonlyArray<string>
}

export interface WSSubscriptionsListFrame {
  readonly type: 'subscriptions_list'
  readonly active_subscriptions: ReadonlyArray<string>
}

export interface WSSubscriptionAddedFrame {
  readonly type: 'subscription_added'
  readonly subscription: {
    readonly type: string
    readonly user?: string
    readonly status?: string
  }
  readonly active_subscriptions?: ReadonlyArray<string>
}

export interface WSSubscriptionRemovedFrame {
  readonly type: 'subscription_removed'
  readonly subscription: {
    readonly type: string
    readonly user?: string
    readonly status?: string
  }
  readonly active_subscriptions?: ReadonlyArray<string>
}

export interface WSErrorFrame {
  readonly type: 'error'
  readonly message: string
}

/** All server → client control frame shapes. */
export type WSControlFrame =
  | WSWelcomeFrame
  | WSSubscriptionsListFrame
  | WSSubscriptionAddedFrame
  | WSSubscriptionRemovedFrame
  | WSErrorFrame

/** Outbound (client → server) frame shapes. */
export type WSOutboundFrame =
  | { method: 'list_subscriptions' }
  | { method: 'subscribe'; subscription: { type: string; user?: string } }
  | { method: 'unsubscribe'; subscription: { type: string; user?: string } }
