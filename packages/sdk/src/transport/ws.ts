import {
  RateLimitError,
  ValidationError,
  WSAuthError,
  WSProtocolError,
  WSSubprotocolError,
  WebSocketError,
} from '../errors/index.js'
import type { Address } from '../types/common.js'
import { KNOWN_CHANNELS, type WSChannel, type WSMessage } from '../types/ws.js'

const DEFAULT_BASE_URL = 'wss://api.hypedexer.com'
const DEFAULT_HEARTBEAT_MS = 25_000
const DEFAULT_REQUEST_TIMEOUT_MS = 5_000
const RECONNECT_BACKOFF_MS = [1_000, 2_000, 4_000, 8_000, 16_000, 60_000] as const
const RECONNECT_CAP_MS = 60_000
const STABLE_CONNECTION_MS = 60_000
const FALLBACK_RATE_LIMIT_BACKOFF_MS = 5_000

/**
 * Construction options for {@link WSClient}.
 *
 * The defaults are tuned for the Hypedexer realtime API as observed in
 * batch-9; only `apiKey` is mandatory.
 */
export interface WSClientOptions {
  /** Required. Sent as `X-API-Key` on the HTTP upgrade request. */
  readonly apiKey: string
  /**
   * Base WebSocket URL. Trailing slashes are stripped.
   * @defaultValue `'wss://api.hypedexer.com'`
   */
  readonly baseUrl?: string
  /**
   * Transport mode. v0.1 supports `'node'` only — `'browser'` throws on
   * construction because the upstream server fails to echo
   * `Sec-WebSocket-Protocol`, which strict clients (browsers, the `ws`
   * library) reject with close code 1006 (PLAN §I #19).
   * @defaultValue `'node'`
   */
  readonly transport?: 'node' | 'browser'
  /**
   * Extra request headers merged onto the upgrade (besides `X-API-Key`).
   * Use for `Authorization: Bearer …`, custom user agents, etc.
   */
  readonly headers?: Record<string, string>
  /**
   * Whether the client auto-reconnects on transient closures with
   * exponential backoff (1 s → 60 s, reset after a stable >60 s open).
   * 4xxx close codes and 4xx upgrade failures stop the loop regardless.
   * @defaultValue `true`
   */
  readonly autoReconnect?: boolean
  /**
   * Interval between WS-level pings (`ws.ping()`) used as an app-layer
   * heartbeat. Cloudflare idle-disconnects the upstream at ~100 s, so the
   * default keeps us well under that. Set to `0` to disable.
   * @defaultValue `25_000`
   */
  readonly heartbeatMs?: number
  /**
   * Per-request timeout (subscribe / unsubscribe / listSubscriptions / welcome
   * frame). The welcome timer uses `4 × requestTimeoutMs` internally to
   * tolerate slow upstreams without hanging connect().
   * @defaultValue `5_000`
   */
  readonly requestTimeoutMs?: number
}

interface Subscription {
  readonly type: WSChannel
  readonly user?: string
}

export interface WSReconnectInfo {
  readonly attempt: number
}

export interface WSCloseInfo {
  readonly code?: number
  readonly reason?: string
}

// Per-event handler shapes — used by the typed `on()` overloads below.
export type WSEventHandlers = {
  completed_trades: (msg: WSMessage<'completed_trades'>) => void
  fills_spot: (msg: WSMessage<'fills_spot'>) => void
  liquidation: (msg: WSMessage<'liquidation'>) => void
  hip4_events: (msg: WSMessage<'hip4_events'>) => void
  recent_activity: (msg: WSMessage<'recent_activity'>) => void
  error: (err: WebSocketError | RateLimitError | ValidationError) => void
  reconnect: (info: WSReconnectInfo) => void
  open: () => void
  close: (info: WSCloseInfo) => void
}

export type WSEvent = keyof WSEventHandlers

// Loose handler shape used for internal listener storage. The typed `on()`
// overloads enforce the correct payload per event at the call site; the
// implementation signature stores them as opaque callbacks.
// biome-ignore lint/suspicious/noExplicitAny: see overload note above
type AnyHandler = (...args: any[]) => void

interface PendingRequest<T> {
  resolve: (value: T) => void
  reject: (reason: unknown) => void
  timer: ReturnType<typeof setTimeout>
}

const BROWSER_TRANSPORT_MESSAGE =
  "WSClient: 'browser' transport is not supported in this SDK version. The upstream WebSocket " +
  'server fails to echo `Sec-WebSocket-Protocol`, so strict clients (browsers, the `ws` library) ' +
  'abort the handshake with close code 1006. Use Node with header auth (the default) until the ' +
  'upstream fix lands.'

const WS_MISSING_MESSAGE =
  "WSClient: optional peer dependency 'ws' is not installed. Install it with `npm install ws` " +
  '(or `pnpm add ws`) to use the Node WebSocket transport.'

function buildErrorOpts(opts: {
  status?: number
  rawBody?: string | object
  closeCode?: number
  reason?: string
  cause?: unknown
}): {
  status?: number
  rawBody?: string | object
  closeCode?: number
  reason?: string
  cause?: unknown
} {
  const out: {
    status?: number
    rawBody?: string | object
    closeCode?: number
    reason?: string
    cause?: unknown
  } = {}
  if (opts.status !== undefined) out.status = opts.status
  if (opts.rawBody !== undefined) out.rawBody = opts.rawBody
  if (opts.closeCode !== undefined) out.closeCode = opts.closeCode
  if (opts.reason !== undefined) out.reason = opts.reason
  if (opts.cause !== undefined) out.cause = opts.cause
  return out
}

function subscriptionKey(type: string, user: string | undefined): string {
  return `${type}|user=${user ?? '*'}`
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Node-first WebSocket client for the Hypedexer realtime API.
 *
 * v0.1 is Node-only. Browser construction throws with a clear message
 * (PLAN §I #19) because the upstream server fails to echo
 * `Sec-WebSocket-Protocol`, which strict clients (browsers, the `ws`
 * library) abort with close code 1006. Header auth (`X-API-Key`) is the
 * only working scheme today.
 *
 * The underlying `ws` package is declared as an **optional peer
 * dependency** and lazy-imported on `connect()`. Bundles that don't use
 * WebSockets can install the SDK without it; calling `connect()` without
 * `ws` installed throws a friendly install hint.
 *
 * Behaviour summary (full spec: PLAN §H):
 *
 * - **Auth**: header-only (`X-API-Key` plus any user-supplied headers).
 *   Subprotocol auth is intentionally not attempted — see PLAN §I #19.
 * - **Heartbeat**: WS-level ping every 25 s (configurable). Cloudflare
 *   idle-disconnects the upstream at ~100 s.
 * - **Reconnect**: exponential backoff 1 s → 2 s → 4 s → 8 s → 16 s,
 *   capped at 60 s. The attempt counter resets to 0 after the connection
 *   stays open >60 s.
 * - **Subscription resync**: every stored subscription, keyed by
 *   `(type|user=…)`, is replayed before `connect()` resolves and on every
 *   reopen.
 * - **Allowlist**: client-side channel allowlist enforced before sending
 *   `subscribe` frames (PLAN §I #18 — server silently accepts bogus
 *   channels and never streams). The welcome frame's
 *   `available_subscriptions` augments the allowlist at runtime so the
 *   client can tolerate new server-side channels without an SDK release.
 * - **Outbound discipline**: every frame is `JSON.stringify`'d in
 *   {@link WSClient.connect | sendJson}. The SDK NEVER sends a raw string
 *   (PLAN §I #19 — raw strings crash the server's Python handler).
 *   Inbound non-JSON frames are dropped with a warn for symmetry.
 * - **Close-code classification** (PLAN §H.3, §I #20): 1011 after a
 *   stable open is treated as transient (graceful-close artefact);
 *   isolated 1006 after the welcome surfaces as `WSSubprotocolError` but
 *   still triggers a reconnect; 4xxx codes surface as `WSAuthError` and
 *   stop the loop.
 * - **Upgrade failures**: 429 → `RateLimitError`, honouring `Retry-After`;
 *   other 4xx → `WSAuthError` (loop stops, terminal flag set so the
 *   subsequent 1006 from `ws.terminate()` doesn't kick off a fresh
 *   reconnect).
 */
export class WSClient {
  private readonly apiKey: string
  private readonly baseUrl: string
  private readonly headers: Record<string, string>
  private readonly autoReconnect: boolean
  private readonly heartbeatMs: number
  private readonly requestTimeoutMs: number

  // biome-ignore lint/suspicious/noExplicitAny: 'ws' is an optional peer dep loaded lazily; the WebSocket instance is typed any.
  private socket: any = null
  // biome-ignore lint/suspicious/noExplicitAny: 'ws' constructor reference is opaque (no static type without @types/ws).
  private wsCtor: any = null

  private readonly subscriptions = new Map<string, Subscription>()
  private readonly listeners = new Map<string, Set<AnyHandler>>()

  // Frozen base + runtime additions from welcome frame.
  private allowlist: Set<string> = new Set(KNOWN_CHANNELS)

  private reconnectAttempts = 0
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null
  private stableTimer: ReturnType<typeof setTimeout> | null = null
  private explicitlyClosed = false
  // Sticky after a non-retryable upgrade failure (e.g. 401/403). Prevents the
  // post-terminate 1006 close from triggering a reconnect (verifier blocker #2).
  // Cleared on every connect() call so users can manually retry.
  private terminallyFailed = false
  private welcomeReceived = false

  private readonly pendingListSubscriptions: PendingRequest<string[]>[] = []
  private readonly pendingSubscribe = new Map<string, PendingRequest<void>>()
  private readonly pendingUnsubscribe = new Map<string, PendingRequest<void>>()
  private pendingWelcome: PendingRequest<void> | null = null

  constructor(opts: WSClientOptions) {
    if (!opts.apiKey) {
      throw new ValidationError('WSClient requires an apiKey', [
        {
          msg: 'apiKey is required and must be a non-empty string',
          loc: ['options', 'apiKey'],
          type: 'ws_missing_api_key',
          input: opts.apiKey,
        },
      ])
    }
    if (opts.transport === 'browser') {
      throw new Error(BROWSER_TRANSPORT_MESSAGE)
    }
    this.apiKey = opts.apiKey
    this.baseUrl = (opts.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, '')
    this.headers = { ...(opts.headers ?? {}) }
    this.autoReconnect = opts.autoReconnect ?? true
    this.heartbeatMs = opts.heartbeatMs ?? DEFAULT_HEARTBEAT_MS
    this.requestTimeoutMs = opts.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS
  }

  // ---------------------------------------------------------------------------
  // Public surface
  // ---------------------------------------------------------------------------

  /**
   * Open the WebSocket connection.
   *
   * Resolves only after:
   * 1. the HTTP upgrade succeeds,
   * 2. the server's `welcome` frame is received (and its
   *    `available_subscriptions` merged into the allowlist), and
   * 3. every previously stored subscription has been replayed.
   *
   * On reconnects the same sequence runs internally, but callers don't
   * await it — they observe progress via the `'reconnect'`, `'open'`,
   * `'error'` and `'close'` events.
   *
   * Clears the terminal-failure flag so the user can manually retry
   * after a previous `WSAuthError`.
   *
   * @throws `Error` with install hint when the optional `ws` peer dep is
   *   missing.
   * @throws {@link WSAuthError} when the upgrade returns a 4xx status
   *   (auth/permission) — see PLAN §I bug.
   * @throws {@link RateLimitError} when the upgrade returns 429.
   *   `Retry-After` is honoured if present; the reconnect loop then
   *   schedules the next attempt automatically.
   * @throws {@link WebSocketError} for welcome timeouts, transport
   *   errors, or 5xx upgrade failures.
   */
  async connect(): Promise<void> {
    this.explicitlyClosed = false
    this.terminallyFailed = false
    await this.ensureWsCtor()
    await this.openOnce()
  }

  /**
   * Cleanly close the WebSocket.
   *
   * Sends close code 1000 with reason `client_disconnect`, clears all
   * timers (heartbeat, reconnect, stable-reset), stops the reconnect
   * loop, and resolves once the socket emits `'close'` (or after a 100 ms
   * safety timeout if the socket never fires it).
   *
   * Idempotent: calling it on an already-closed client is a no-op.
   *
   * Note: per PLAN §I #20 the server may reply with `1011 /origin`
   * instead of `1000`; the SDK classifies that as the expected
   * graceful-close artefact and does not surface it to the user.
   */
  async disconnect(): Promise<void> {
    this.explicitlyClosed = true
    this.stopReconnect()
    this.stopHeartbeat()
    this.clearStableTimer()
    const sock = this.socket
    this.socket = null
    if (sock == null) return
    return new Promise<void>((resolve) => {
      try {
        sock.once?.('close', () => resolve())
        sock.close?.(1000, 'client_disconnect')
      } catch {
        resolve()
      }
      // Safety: if the socket never fires close, resolve after a short tick.
      // Unref so the timer never keeps the event loop alive on its own.
      const safety = setTimeout(() => resolve(), 100)
      safety.unref?.()
    })
  }

  /**
   * Register a typed listener for a channel push or lifecycle event.
   *
   * The overload set narrows the handler's payload to the right shape
   * per event:
   * - `'completed_trades' | 'fills_spot' | 'liquidation' | 'hip4_events' |
   *   'recent_activity'` → {@link WSMessage} `<channel>` (the SDK
   *   normalises wire `{type, count, data}` to `{channel, count, items}`,
   *   PLAN §H.6).
   * - `'error'` → `WebSocketError | RateLimitError | ValidationError`.
   *   Listener errors are caught and warned; they never crash the WS
   *   loop.
   * - `'reconnect'` → `{attempt: number}`.
   * - `'open'` → no payload (fired on every successful socket open,
   *   including reconnects).
   * - `'close'` → `{code?: number, reason?: string}`.
   *
   * @returns a disposer that removes the listener. Calling it twice is
   *   a no-op.
   */
  on(event: 'completed_trades', handler: WSEventHandlers['completed_trades']): () => void
  on(event: 'fills_spot', handler: WSEventHandlers['fills_spot']): () => void
  on(event: 'liquidation', handler: WSEventHandlers['liquidation']): () => void
  on(event: 'hip4_events', handler: WSEventHandlers['hip4_events']): () => void
  on(event: 'recent_activity', handler: WSEventHandlers['recent_activity']): () => void
  on(event: 'error', handler: WSEventHandlers['error']): () => void
  on(event: 'reconnect', handler: WSEventHandlers['reconnect']): () => void
  on(event: 'open', handler: WSEventHandlers['open']): () => void
  on(event: 'close', handler: WSEventHandlers['close']): () => void
  on(event: WSEvent, handler: AnyHandler): () => void {
    let bucket = this.listeners.get(event)
    if (!bucket) {
      bucket = new Set()
      this.listeners.set(event, bucket)
    }
    bucket.add(handler)
    return () => {
      const b = this.listeners.get(event)
      if (!b) return
      b.delete(handler)
      if (b.size === 0) this.listeners.delete(event)
    }
  }

  /**
   * Remove a listener previously registered with {@link WSClient.on}.
   *
   * Pass the exact same handler reference that was registered — the
   * client matches by identity. Removing a handler that isn't registered
   * is a no-op. Prefer the disposer returned by `on()` whenever possible.
   */
  off(event: 'completed_trades', handler: WSEventHandlers['completed_trades']): void
  off(event: 'fills_spot', handler: WSEventHandlers['fills_spot']): void
  off(event: 'liquidation', handler: WSEventHandlers['liquidation']): void
  off(event: 'hip4_events', handler: WSEventHandlers['hip4_events']): void
  off(event: 'recent_activity', handler: WSEventHandlers['recent_activity']): void
  off(event: 'error', handler: WSEventHandlers['error']): void
  off(event: 'reconnect', handler: WSEventHandlers['reconnect']): void
  off(event: 'open', handler: WSEventHandlers['open']): void
  off(event: 'close', handler: WSEventHandlers['close']): void
  off(event: WSEvent, handler: AnyHandler): void {
    const bucket = this.listeners.get(event)
    if (!bucket) return
    bucket.delete(handler)
    if (bucket.size === 0) this.listeners.delete(event)
  }

  /**
   * Subscribe to a channel.
   *
   * The channel name is validated client-side against the allowlist
   * BEFORE any frame is sent (PLAN §I #18 — the server silently accepts
   * bogus subscriptions and never streams). The allowlist is the union
   * of {@link KNOWN_CHANNELS} and the `available_subscriptions` list
   * advertised in the welcome frame.
   *
   * The subscription is stored in the client-side map keyed by
   * `${type}|user=${user ?? '*'}` so it can be replayed on reconnect.
   * Per batch-9 the server treats `(type, user)` as distinct keys, so
   * subscribing to `completed_trades` and to `completed_trades` with a
   * `user` filter creates two independent server-side subscriptions.
   *
   * Resolves when the server acknowledges with `subscription_added` for
   * the matching `(type, user)` key.
   *
   * @throws {@link ValidationError} when `type` is not in the allowlist
   *   (PLAN §I #18 defence).
   * @throws {@link WebSocketError} when the socket is not open or the
   *   server doesn't ack within `requestTimeoutMs`.
   */
  async subscribe(type: WSChannel, opts?: { user?: Address }): Promise<void> {
    this.assertChannel(type)
    const user = opts?.user
    const key = subscriptionKey(type, user)
    const sub: Subscription = user !== undefined ? { type, user } : { type }
    this.subscriptions.set(key, sub)
    await this.sendSubscribe(sub)
  }

  /**
   * Unsubscribe from a channel.
   *
   * The `(type, user)` key is removed from the client-side resync map so
   * future reconnects don't replay it, then an `unsubscribe` frame is
   * sent. Resolves on the matching `subscription_removed` ack or
   * rejects after `requestTimeoutMs`.
   *
   * Per batch-9 the server keys subscriptions by `(type|user)`, so
   * unsubscribing the global variant does NOT remove user-scoped ones
   * (and vice-versa). Call `unsubscribe(type, { user })` explicitly for
   * each user filter you previously subscribed with.
   *
   * @throws {@link ValidationError} when `type` is not in the allowlist
   *   (PLAN §I #18 defence).
   * @throws {@link WebSocketError} when the socket is not open or the
   *   server doesn't ack within `requestTimeoutMs`.
   */
  async unsubscribe(type: WSChannel, opts?: { user?: Address }): Promise<void> {
    this.assertChannel(type)
    const user = opts?.user
    const key = subscriptionKey(type, user)
    this.subscriptions.delete(key)
    await this.sendUnsubscribe({ type, ...(user !== undefined ? { user } : {}) })
  }

  /**
   * Request the server's view of active subscriptions for this socket.
   *
   * Sends a `list_subscriptions` frame and resolves with the
   * `active_subscriptions` array returned in the `subscriptions_list`
   * reply. Entries are formatted as `${type}` or `${type}|user=${addr}`,
   * matching the SDK's client-side key shape so consumers can diff
   * server vs local state directly.
   *
   * @throws {@link WebSocketError} when the socket is not open or the
   *   server doesn't reply within `requestTimeoutMs`.
   */
  async listSubscriptions(): Promise<string[]> {
    this.assertOpen()
    return new Promise<string[]>((resolve, reject) => {
      const timer = setTimeout(() => {
        const idx = this.pendingListSubscriptions.indexOf(pending)
        if (idx >= 0) this.pendingListSubscriptions.splice(idx, 1)
        reject(new WebSocketError('listSubscriptions timed out', buildErrorOpts({})))
      }, this.requestTimeoutMs)
      const pending: PendingRequest<string[]> = { resolve, reject, timer }
      this.pendingListSubscriptions.push(pending)
      try {
        this.sendJson({ method: 'list_subscriptions' })
      } catch (err) {
        clearTimeout(timer)
        const idx = this.pendingListSubscriptions.indexOf(pending)
        if (idx >= 0) this.pendingListSubscriptions.splice(idx, 1)
        reject(err)
      }
    })
  }

  // ---------------------------------------------------------------------------
  // Internals
  // ---------------------------------------------------------------------------

  private async ensureWsCtor(): Promise<void> {
    if (this.wsCtor != null) return
    try {
      // 'ws' is declared as an optional peer dep — lazy-loaded so the SDK
      // package can be installed without it (e.g. in non-WS-using bundles).
      // The dynamic specifier is a string variable to keep bundlers from
      // hard-resolving it at build time.
      const specifier = 'ws'
      // biome-ignore lint/suspicious/noExplicitAny: optional peer dep without types in v0.1
      const mod: any = await import(/* @vite-ignore */ specifier)
      this.wsCtor = mod.WebSocket ?? mod.default ?? mod
    } catch (cause) {
      throw new Error(WS_MISSING_MESSAGE, { cause })
    }
  }

  private openOnce(): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const headers: Record<string, string> = {
        'X-API-Key': this.apiKey,
        ...this.headers,
      }
      // biome-ignore lint/suspicious/noExplicitAny: see WebSocket instance note above
      let ws: any
      try {
        // biome-ignore lint/suspicious/noExplicitAny: lazy ctor
        const Ctor: any = this.wsCtor
        ws = new Ctor(this.baseUrl, { headers })
      } catch (cause) {
        reject(new WebSocketError('failed to construct WebSocket', buildErrorOpts({ cause })))
        return
      }
      this.socket = ws
      this.welcomeReceived = false

      // Per-attempt flag: once we've handled a typed upgrade failure
      // (WSAuthError / RateLimitError), suppress the noisy ws-library error
      // that ws.terminate() emits right after (verifier blocker #1
      // follow-through — that noisy error otherwise overwrites lastErr).
      let upgradeFailureHandled = false

      const welcomeTimer = setTimeout(() => {
        if (this.pendingWelcome) {
          const pending = this.pendingWelcome
          this.pendingWelcome = null
          pending.reject(
            new WebSocketError('welcome frame not received before timeout', buildErrorOpts({})),
          )
        }
        // Free the socket so the reconnect loop's handleClose path can take
        // over (verifier minor #5).
        try {
          ws.terminate?.() ?? ws.close?.()
        } catch {
          /* noop */
        }
      }, this.requestTimeoutMs * 4)

      this.pendingWelcome = {
        timer: welcomeTimer,
        resolve: () => {
          clearTimeout(welcomeTimer)
          this.replaySubscriptions().then(resolve).catch(reject)
        },
        reject: (err) => {
          clearTimeout(welcomeTimer)
          reject(err)
        },
      }

      ws.on?.('open', () => {
        this.startHeartbeat()
        this.scheduleStableReset()
        this.emit('open')
      })

      ws.on?.('message', (data: unknown) => this.handleMessage(data))

      ws.on?.('error', (err: Error) => {
        // When 'unexpected-response' has already produced a typed error, drop
        // the subsequent generic ws error (e.g. "WebSocket was closed before
        // the connection was established" from ws.terminate()) so the user's
        // 'error' listener keeps the typed error as the last one observed.
        if (upgradeFailureHandled) return
        const message = err?.message ?? 'WebSocket error'
        this.emit('error', new WebSocketError(message, buildErrorOpts({ cause: err })))
      })

      ws.on?.('unexpected-response', (_req: unknown, res: unknown) => {
        upgradeFailureHandled = true
        // biome-ignore lint/suspicious/noExplicitAny: 'res' is an http.IncomingMessage
        const r: any = res
        const status: number = r?.statusCode ?? 0
        // biome-ignore lint/suspicious/noExplicitAny: retry-after header may be string|string[]
        const retryAfterRaw: any = r?.headers?.['retry-after']
        const retryAfter: string | undefined = Array.isArray(retryAfterRaw)
          ? retryAfterRaw[0]
          : retryAfterRaw

        let body = ''
        const finish = (): void => {
          this.handleUpgradeFailure(status, body, retryAfter, reject)
          try {
            ws.terminate?.() ?? ws.close?.()
          } catch {
            /* noop */
          }
        }

        if (typeof r?.on === 'function') {
          r.on('data', (chunk: Buffer | string) => {
            body += chunk.toString()
          })
          r.on('end', finish)
          r.on('error', finish)
        } else {
          finish()
        }
      })

      ws.on?.('close', (code: number, reasonBuf: Buffer | string | undefined) => {
        const reason =
          typeof reasonBuf === 'string' ? reasonBuf : (reasonBuf?.toString?.('utf-8') ?? '')
        this.handleClose(code, reason, reject)
      })
    })
  }

  private handleUpgradeFailure(
    status: number,
    body: string,
    retryAfter: string | undefined,
    reject: (err: unknown) => void,
  ): void {
    // Build the specific error FIRST, then settle the pending connect()
    // promise with it. (Verifier blocker #1: previously a generic
    // WebSocketError was used to reject pendingWelcome, settling the outer
    // promise before the typed error could ever reach it.)
    let err: WebSocketError

    if (status === 429) {
      err = new RateLimitError(
        body || 'rate limited on WebSocket upgrade',
        buildErrorOpts({ status, rawBody: body }),
      )
      this.emit('error', err)
      if (this.autoReconnect && !this.explicitlyClosed) {
        const ms = retryAfter != null ? Number.parseFloat(retryAfter) * 1_000 : Number.NaN
        const backoff = Number.isFinite(ms) && ms > 0 ? ms : FALLBACK_RATE_LIMIT_BACKOFF_MS
        this.scheduleReconnect(backoff)
      }
    } else if (status >= 400 && status < 500) {
      err = new WSAuthError(
        body || `WebSocket upgrade failed with status ${status}`,
        buildErrorOpts({ status, rawBody: body }),
      )
      this.emit('error', err)
      this.stopReconnect()
      // Verifier blocker #2: mark terminal so the imminent ws.terminate()
      // 1006 close does NOT schedule a fresh reconnect.
      this.terminallyFailed = true
    } else {
      err = new WebSocketError(
        `WebSocket upgrade failed with status ${status}`,
        buildErrorOpts({ status, rawBody: body }),
      )
      this.emit('error', err)
    }

    if (this.pendingWelcome) {
      const pending = this.pendingWelcome
      this.pendingWelcome = null
      // The pendingWelcome.reject closure calls the outer openOnce reject
      // with the same argument, so the connect() promise rejects with the
      // typed error.
      pending.reject(err)
    } else {
      reject(err)
    }
  }

  private handleClose(
    code: number,
    reason: string,
    rejectOpenPromise: (err: unknown) => void,
  ): void {
    this.stopHeartbeat()
    this.clearStableTimer()
    const wasOpen = this.socket != null
    this.socket = null

    // Reject any in-flight requests so callers don't hang.
    this.failPending(
      new WebSocketError(`WebSocket closed (${code})`, buildErrorOpts({ closeCode: code, reason })),
    )

    this.emit('close', { code, reason })

    if (this.explicitlyClosed) return
    // After a non-retryable upgrade failure, the ws.terminate() that follows
    // emits a 1006 close. Don't treat that as a transient subprotocol issue
    // and don't try to reconnect. (Verifier blocker #2 / major #3.)
    if (this.terminallyFailed) return

    if (!wasOpen) return

    if (!this.welcomeReceived) {
      // Closed before the welcome was sent — surface to the open() promise.
      rejectOpenPromise(
        new WebSocketError(
          `WebSocket closed before welcome (${code})`,
          buildErrorOpts({ closeCode: code, reason }),
        ),
      )
    }

    // PLAN §I #20 — 1011 has been observed on graceful close; treat as transient.
    // 1006 is only an interesting subprotocol-echo signal after the connection
    // had reached the welcome stage; otherwise it's just upstream-noise.
    if (code === 1006 && this.welcomeReceived) {
      this.emit(
        'error',
        new WSSubprotocolError(
          'WebSocket closed with 1006 (transient — typical subprotocol-echo failure)',
          buildErrorOpts({ closeCode: code, reason }),
        ),
      )
    }

    if (code >= 4000 && code < 5000) {
      this.emit(
        'error',
        new WSAuthError(
          `WebSocket closed with ${code}`,
          buildErrorOpts({ closeCode: code, reason }),
        ),
      )
      this.stopReconnect()
      return
    }

    if (this.autoReconnect) {
      this.scheduleReconnect()
    }
  }

  private handleMessage(data: unknown): void {
    let text: string
    if (typeof data === 'string') {
      text = data
    } else if (
      data != null &&
      typeof (data as { toString?: () => string }).toString === 'function'
    ) {
      text = (data as Buffer).toString()
    } else {
      // Defensive — should never fire.
      console.warn('[hypedexer/ws] dropped non-stringifiable frame')
      return
    }

    let parsed: unknown
    try {
      parsed = JSON.parse(text)
    } catch {
      // PLAN §I #19 — server crashes on non-JSON; defensively drop inbound non-JSON too.
      console.warn('[hypedexer/ws] dropped non-JSON frame:', text.slice(0, 200))
      return
    }

    if (!isRecord(parsed)) {
      console.warn('[hypedexer/ws] dropped non-object frame')
      return
    }

    const type = parsed['type']
    if (typeof type !== 'string') return

    if (type === 'welcome') {
      this.handleWelcome(parsed)
      return
    }
    if (type === 'subscriptions_list') {
      this.handleSubscriptionsList(parsed)
      return
    }
    if (type === 'subscription_added') {
      this.handleSubscriptionAdded(parsed)
      return
    }
    if (type === 'subscription_removed') {
      this.handleSubscriptionRemoved(parsed)
      return
    }
    if (type === 'error') {
      this.handleErrorFrame(parsed)
      return
    }

    // Otherwise treat as a push frame: {type: ChannelName, count, data}.
    this.handlePush(type, parsed)
  }

  private handleWelcome(frame: Record<string, unknown>): void {
    this.welcomeReceived = true
    const subs = frame['available_subscriptions']
    if (Array.isArray(subs)) {
      const next = new Set<string>(KNOWN_CHANNELS)
      for (const s of subs) {
        if (typeof s !== 'string') continue
        if (!next.has(s)) {
          // Detect drift: server is advertising a channel we don't know about.
          console.warn(
            `[hypedexer/ws] welcome frame advertises unknown channel "${s}". Accepting client-side; consider upgrading the SDK.`,
          )
        }
        next.add(s)
      }
      this.allowlist = next
    }
    const pending = this.pendingWelcome
    this.pendingWelcome = null
    pending?.resolve(undefined as never)
  }

  private handleSubscriptionsList(frame: Record<string, unknown>): void {
    const active = frame['active_subscriptions']
    const list = Array.isArray(active)
      ? (active.filter((s) => typeof s === 'string') as string[])
      : []
    const pending = this.pendingListSubscriptions.shift()
    if (pending) {
      clearTimeout(pending.timer)
      pending.resolve(list)
    }
  }

  private handleSubscriptionAdded(frame: Record<string, unknown>): void {
    const subscription = frame['subscription']
    if (!isRecord(subscription)) return
    const subType = subscription['type']
    const subUser = subscription['user']
    if (typeof subType !== 'string') return
    const key = subscriptionKey(subType, typeof subUser === 'string' ? subUser : undefined)
    const pending = this.pendingSubscribe.get(key)
    if (pending) {
      clearTimeout(pending.timer)
      this.pendingSubscribe.delete(key)
      pending.resolve()
    }
  }

  private handleSubscriptionRemoved(frame: Record<string, unknown>): void {
    const subscription = frame['subscription']
    if (!isRecord(subscription)) return
    const subType = subscription['type']
    const subUser = subscription['user']
    if (typeof subType !== 'string') return
    const key = subscriptionKey(subType, typeof subUser === 'string' ? subUser : undefined)
    const pending = this.pendingUnsubscribe.get(key)
    if (pending) {
      clearTimeout(pending.timer)
      this.pendingUnsubscribe.delete(key)
      pending.resolve()
    }
  }

  private handleErrorFrame(frame: Record<string, unknown>): void {
    const message =
      typeof frame['message'] === 'string' ? (frame['message'] as string) : 'WS error frame'
    this.emit('error', new WSProtocolError(message, buildErrorOpts({ rawBody: frame })))
  }

  private handlePush(channelName: string, frame: Record<string, unknown>): void {
    // Only deliver to listeners for channels we actually know about. Unknown
    // channels are accepted (welcome may have extended the allowlist) but
    // only if a listener is registered.
    const items = Array.isArray(frame['data']) ? (frame['data'] as unknown[]) : []
    const count = typeof frame['count'] === 'number' ? (frame['count'] as number) : items.length
    const msg = { channel: channelName, count, items }
    this.dispatch(channelName, msg)
  }

  private dispatch(event: string, payload: unknown): void {
    const bucket = this.listeners.get(event)
    if (!bucket) return
    for (const handler of bucket) {
      try {
        handler(payload)
      } catch (err) {
        // Never let a user handler crash the WS loop.
        console.warn('[hypedexer/ws] listener for', event, 'threw:', err)
      }
    }
  }

  private emit<E extends WSEvent>(event: E, payload?: Parameters<WSEventHandlers[E]>[0]): void {
    this.dispatch(event, payload)
  }

  // -- Heartbeat / reconnect / replay -----------------------------------------

  private startHeartbeat(): void {
    this.stopHeartbeat()
    if (this.heartbeatMs <= 0) return
    this.heartbeatTimer = setInterval(() => {
      const sock = this.socket
      if (sock == null) return
      try {
        sock.ping?.()
      } catch {
        /* swallow — connection issues will surface via 'close' */
      }
    }, this.heartbeatMs)
    // Don't keep the event loop alive just for the heartbeat.
    this.heartbeatTimer.unref?.()
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer)
      this.heartbeatTimer = null
    }
  }

  private scheduleStableReset(): void {
    this.clearStableTimer()
    this.stableTimer = setTimeout(() => {
      this.reconnectAttempts = 0
    }, STABLE_CONNECTION_MS)
    this.stableTimer.unref?.()
  }

  private clearStableTimer(): void {
    if (this.stableTimer) {
      clearTimeout(this.stableTimer)
      this.stableTimer = null
    }
  }

  private scheduleReconnect(forcedDelayMs?: number): void {
    if (this.explicitlyClosed) return
    if (this.terminallyFailed) return
    if (this.reconnectTimer != null) return
    const idx = Math.min(this.reconnectAttempts, RECONNECT_BACKOFF_MS.length - 1)
    const backoffEntry = RECONNECT_BACKOFF_MS[idx] ?? RECONNECT_CAP_MS
    const delay = forcedDelayMs ?? Math.min(backoffEntry, RECONNECT_CAP_MS)
    this.reconnectAttempts += 1
    const attempt = this.reconnectAttempts
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null
      if (this.explicitlyClosed || this.terminallyFailed) return
      this.emit('reconnect', { attempt })
      this.openOnce().catch(() => {
        // openOnce rejected — schedule the next attempt (unless we've stopped).
        if (this.explicitlyClosed || this.terminallyFailed) return
        this.scheduleReconnect()
      })
    }, delay)
    this.reconnectTimer.unref?.()
  }

  private stopReconnect(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
  }

  private async replaySubscriptions(): Promise<void> {
    if (this.subscriptions.size === 0) return
    const pending: Promise<void>[] = []
    for (const sub of this.subscriptions.values()) {
      pending.push(this.sendSubscribe(sub).catch(() => undefined))
    }
    await Promise.all(pending)
  }

  // -- Outbound ---------------------------------------------------------------

  private async sendSubscribe(sub: Subscription): Promise<void> {
    this.assertOpen()
    const key = subscriptionKey(sub.type, sub.user)
    // If a pending ack already exists for this key (e.g. duplicate subscribe
    // mid-replay), reuse it.
    const existing = this.pendingSubscribe.get(key)
    if (existing) {
      return new Promise<void>((resolve, reject) => {
        const inner: PendingRequest<void> = {
          resolve,
          reject,
          timer: setTimeout(
            () => reject(new WebSocketError('subscribe ack timed out')),
            this.requestTimeoutMs,
          ),
        }
        // wrap: when existing resolves, resolve inner too
        const origResolve = existing.resolve
        existing.resolve = (v) => {
          origResolve(v)
          clearTimeout(inner.timer)
          inner.resolve(v)
        }
        const origReject = existing.reject
        existing.reject = (e) => {
          origReject(e)
          clearTimeout(inner.timer)
          inner.reject(e)
        }
      })
    }
    return new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingSubscribe.delete(key)
        reject(new WebSocketError('subscribe ack timed out', buildErrorOpts({})))
      }, this.requestTimeoutMs)
      const pending: PendingRequest<void> = { resolve, reject, timer }
      this.pendingSubscribe.set(key, pending)
      try {
        this.sendJson({
          method: 'subscribe',
          subscription: { type: sub.type, ...(sub.user !== undefined ? { user: sub.user } : {}) },
        })
      } catch (err) {
        clearTimeout(timer)
        this.pendingSubscribe.delete(key)
        reject(err)
      }
    })
  }

  private async sendUnsubscribe(sub: { type: string; user?: string }): Promise<void> {
    this.assertOpen()
    const key = subscriptionKey(sub.type, sub.user)
    return new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingUnsubscribe.delete(key)
        reject(new WebSocketError('unsubscribe ack timed out', buildErrorOpts({})))
      }, this.requestTimeoutMs)
      const pending: PendingRequest<void> = { resolve, reject, timer }
      this.pendingUnsubscribe.set(key, pending)
      try {
        this.sendJson({
          method: 'unsubscribe',
          subscription: { type: sub.type, ...(sub.user !== undefined ? { user: sub.user } : {}) },
        })
      } catch (err) {
        clearTimeout(timer)
        this.pendingUnsubscribe.delete(key)
        reject(err)
      }
    })
  }

  // Outbound JSON. Per PLAN §I #19 the SDK NEVER sends a non-JSON frame.
  private sendJson(obj: unknown): void {
    const sock = this.socket
    if (sock == null) {
      throw new WebSocketError('WebSocket is not connected', buildErrorOpts({}))
    }
    const payload = JSON.stringify(obj)
    sock.send(payload)
  }

  // -- Helpers ----------------------------------------------------------------

  private assertOpen(): void {
    if (this.socket == null) {
      throw new WebSocketError(
        'WebSocket is not connected; call connect() first',
        buildErrorOpts({}),
      )
    }
  }

  private assertChannel(type: unknown): asserts type is WSChannel {
    if (typeof type !== 'string' || !this.allowlist.has(type)) {
      throw new ValidationError(`unknown WS channel "${String(type)}"`, [
        {
          msg: `channel must be one of: ${[...this.allowlist].join(', ')}`,
          loc: ['subscription', 'type'],
          type: 'ws_channel_allowlist',
          input: type,
          ctx: { allowed: [...this.allowlist] },
        },
      ])
    }
  }

  private failPending(err: WebSocketError): void {
    if (this.pendingWelcome) {
      const p = this.pendingWelcome
      this.pendingWelcome = null
      p.reject(err)
    }
    for (const p of this.pendingListSubscriptions.splice(0)) {
      clearTimeout(p.timer)
      p.reject(err)
    }
    for (const [k, p] of this.pendingSubscribe) {
      clearTimeout(p.timer)
      this.pendingSubscribe.delete(k)
      p.reject(err)
    }
    for (const [k, p] of this.pendingUnsubscribe) {
      clearTimeout(p.timer)
      this.pendingUnsubscribe.delete(k)
      p.reject(err)
    }
  }
}
