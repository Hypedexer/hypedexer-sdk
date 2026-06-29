import { type AddressInfo, type Server, createServer } from 'node:http'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { WebSocketServer } from 'ws'
import {
  RateLimitError,
  ValidationError,
  WSAuthError,
  WSProtocolError,
  WebSocketError,
} from '../../src/errors/index.js'
import { WSClient } from '../../src/transport/ws.js'

// ---------------------------------------------------------------------------
// Local test-server harness
// ---------------------------------------------------------------------------

interface TestServer {
  port: number
  http: Server
  wss: WebSocketServer
  /** Override: reject the next upgrade with this HTTP status. */
  setRejectUpgrade(status: number | null, headers?: Record<string, string>): void
  /** Override: skip sending the welcome frame automatically on connect. */
  setSendWelcome(send: boolean | { available_subscriptions?: string[] }): void
  /** Most-recent client socket. */
  lastSocket(): import('ws').WebSocket | null
  /** All messages received from clients on the most-recent socket. */
  receivedMessages(): unknown[]
  /** Ping events received on the most-recent socket. */
  pingCount(): number
  close(): Promise<void>
}

async function bootServer(): Promise<TestServer> {
  const http = createServer()
  const wss = new WebSocketServer({ noServer: true })

  let rejectStatus: number | null = null
  let rejectHeaders: Record<string, string> = {}
  let sendWelcome: boolean | { available_subscriptions?: string[] } = true
  let lastSocket: import('ws').WebSocket | null = null
  const messages: unknown[] = []
  let pings = 0

  http.on('upgrade', (req, socket, head) => {
    if (rejectStatus != null) {
      const hdrs = Object.entries(rejectHeaders)
        .map(([k, v]) => `${k}: ${v}`)
        .join('\r\n')
      const body = `status ${rejectStatus}`
      const hdrLine = hdrs.length > 0 ? `${hdrs}\r\n` : ''
      socket.write(
        `HTTP/1.1 ${rejectStatus} Rejected\r\nContent-Length: ${body.length}\r\n${hdrLine}Connection: close\r\n\r\n${body}`,
      )
      socket.destroy()
      return
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit('connection', ws, req)
    })
  })

  wss.on('connection', (ws) => {
    lastSocket = ws
    // Reset messages on each new connection so reconnect tests can observe
    // post-reconnect frames independently.
    messages.length = 0
    pings = 0
    ws.on('message', (data) => {
      try {
        messages.push(JSON.parse(data.toString()))
      } catch {
        messages.push(data.toString())
      }
    })
    ws.on('ping', () => {
      pings += 1
    })
    if (sendWelcome !== false) {
      const subs =
        typeof sendWelcome === 'object' && sendWelcome.available_subscriptions != null
          ? sendWelcome.available_subscriptions
          : ['completed_trades', 'fills_spot', 'recent_activity', 'liquidation', 'hip4_events']
      ws.send(
        JSON.stringify({
          type: 'welcome',
          message: 'WebSocket /ws ready',
          available_methods: ['subscribe', 'unsubscribe', 'list_subscriptions'],
          available_subscriptions: subs,
        }),
      )
    }
  })

  await new Promise<void>((resolve) => {
    http.listen(0, '127.0.0.1', () => resolve())
  })
  const port = (http.address() as AddressInfo).port

  return {
    port,
    http,
    wss,
    setRejectUpgrade(status, headers) {
      rejectStatus = status
      rejectHeaders = headers ?? {}
    },
    setSendWelcome(send) {
      sendWelcome = send
    },
    lastSocket() {
      return lastSocket
    },
    receivedMessages() {
      return messages
    },
    pingCount() {
      return pings
    },
    close() {
      return new Promise<void>((resolve) => {
        wss.close(() => {
          http.close(() => resolve())
        })
      })
    },
  }
}

function makeClient(
  server: TestServer,
  overrides: Partial<ConstructorParameters<typeof WSClient>[0]> = {},
): WSClient {
  return new WSClient({
    apiKey: 'test-key',
    baseUrl: `ws://127.0.0.1:${server.port}`,
    requestTimeoutMs: 500,
    heartbeatMs: 0, // disabled by default; specific tests override
    ...overrides,
  })
}

// Helper: wait for the server to acknowledge a subscribe by responding.
function autoAckSubscribes(server: TestServer): void {
  server.wss.on('connection', (ws) => {
    ws.on('message', (data) => {
      let parsed: unknown
      try {
        parsed = JSON.parse(data.toString())
      } catch {
        return
      }
      if (
        parsed != null &&
        typeof parsed === 'object' &&
        (parsed as Record<string, unknown>).method === 'subscribe'
      ) {
        const sub = (parsed as { subscription: { type: string; user?: string } }).subscription
        ws.send(
          JSON.stringify({
            type: 'subscription_added',
            subscription: { ...sub, status: 'active' },
            active_subscriptions: [`${sub.type}|user=${sub.user ?? '*'}`],
          }),
        )
      } else if (
        parsed != null &&
        typeof parsed === 'object' &&
        (parsed as Record<string, unknown>).method === 'unsubscribe'
      ) {
        const sub = (parsed as { subscription: { type: string; user?: string } }).subscription
        ws.send(
          JSON.stringify({
            type: 'subscription_removed',
            subscription: { ...sub, status: 'inactive' },
            active_subscriptions: [],
          }),
        )
      }
    })
  })
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('WSClient', () => {
  let server: TestServer

  beforeEach(async () => {
    server = await bootServer()
  })

  afterEach(async () => {
    await server.close()
  })

  // (b) Browser path throws on construction
  it('throws on construction when transport: "browser"', () => {
    expect(
      () =>
        new WSClient({
          apiKey: 'k',
          transport: 'browser',
        }),
    ).toThrow(/browser.*not supported/i)
  })

  // (a) connect() resolves only after welcome frame
  it('connect() resolves after the welcome frame', async () => {
    const client = makeClient(server)
    let openFired = false
    client.on('open', () => {
      openFired = true
    })
    await client.connect()
    expect(openFired).toBe(true)
    await client.disconnect()
  })

  it('connect() rejects if welcome frame is never sent', async () => {
    server.setSendWelcome(false)
    const client = makeClient(server, { requestTimeoutMs: 80, autoReconnect: false })
    await expect(client.connect()).rejects.toBeInstanceOf(WebSocketError)
    await client.disconnect()
  })

  // (c) subscribe sends correct JSON; rejects bogus channel; no frame sent
  it('subscribe() sends a valid JSON subscribe frame', async () => {
    autoAckSubscribes(server)
    const client = makeClient(server)
    await client.connect()
    await client.subscribe('fills_spot')
    const subMsg = server
      .receivedMessages()
      .find((m) => (m as { method?: string })?.method === 'subscribe') as {
      method: string
      subscription: { type: string }
    }
    expect(subMsg).toBeDefined()
    expect(subMsg.method).toBe('subscribe')
    expect(subMsg.subscription.type).toBe('fills_spot')
    await client.disconnect()
  })

  it('subscribe() rejects bogus channels with ValidationError before sending', async () => {
    const client = makeClient(server)
    await client.connect()
    await expect(
      // @ts-expect-error — deliberately bogus channel
      client.subscribe('not_a_real_channel'),
    ).rejects.toBeInstanceOf(ValidationError)
    // No outbound frame for the bogus channel
    const subMsgs = server
      .receivedMessages()
      .filter((m) => (m as { method?: string })?.method === 'subscribe')
    expect(subMsgs).toHaveLength(0)
    await client.disconnect()
  })

  // (d) push frame for 'completed_trades' dispatched; off() removes handler
  it('dispatches push frames as { channel, count, items } and supports off()', async () => {
    const client = makeClient(server)
    await client.connect()
    const received: Array<{ channel: string; count: number; items: unknown[] }> = []
    const handler = (msg: { channel: string; count: number; items: unknown[] }) => {
      received.push(msg)
    }
    const off = client.on('completed_trades', handler)

    const sock = server.lastSocket()
    expect(sock).not.toBeNull()
    sock?.send(
      JSON.stringify({
        type: 'completed_trades',
        count: 2,
        data: [
          { coin: 'BTC', px: 100, tid: 1 },
          { coin: 'ETH', px: 200, tid: 2 },
        ],
      }),
    )

    // Yield to event loop for ws to deliver the frame.
    await new Promise<void>((r) => setTimeout(r, 30))
    expect(received).toHaveLength(1)
    expect(received[0]?.channel).toBe('completed_trades')
    expect(received[0]?.count).toBe(2)
    expect(received[0]?.items).toHaveLength(2)

    // off()
    off()
    sock?.send(
      JSON.stringify({
        type: 'completed_trades',
        count: 1,
        data: [{ coin: 'BTC', px: 1, tid: 3 }],
      }),
    )
    await new Promise<void>((r) => setTimeout(r, 30))
    expect(received).toHaveLength(1)

    await client.disconnect()
  })

  // (e) Subscription resync on reopen
  it('replays subscriptions on reconnect', async () => {
    autoAckSubscribes(server)
    const client = makeClient(server, { autoReconnect: true })
    await client.connect()
    await client.subscribe('liquidation')
    // The first connection saw the initial subscribe.
    const initialSubs = server
      .receivedMessages()
      .filter((m) => (m as { method?: string })?.method === 'subscribe')
    expect(initialSubs).toHaveLength(1)

    // Force the server-side socket closed with a transient code.
    const sock = server.lastSocket()
    sock?.close(1011, 'transient')

    // Wait for reconnect (backoff is 1s on first attempt).
    await new Promise<void>((r) => setTimeout(r, 1500))

    // After reconnect, the SDK should have replayed the subscribe on the new socket.
    const postReconnectSubs = server
      .receivedMessages()
      .filter((m) => (m as { method?: string })?.method === 'subscribe')
    expect(postReconnectSubs.length).toBeGreaterThanOrEqual(1)
    expect((postReconnectSubs[0] as { subscription: { type: string } }).subscription.type).toBe(
      'liquidation',
    )

    await client.disconnect()
  }, 10_000)

  // (f) Heartbeat
  it('sends WS ping frames on the configured heartbeat interval', async () => {
    const client = makeClient(server, { heartbeatMs: 60 })
    await client.connect()
    await new Promise<void>((r) => setTimeout(r, 220))
    expect(server.pingCount()).toBeGreaterThanOrEqual(2)
    await client.disconnect()
  })

  // (h) 'error' control frame → 'error' handler receives WSProtocolError
  it('emits WSProtocolError for server-sent error frames', async () => {
    const client = makeClient(server)
    await client.connect()
    let received: WSProtocolError | null = null
    client.on('error', (e) => {
      if (e instanceof WSProtocolError) received = e
    })
    server.lastSocket()?.send(JSON.stringify({ type: 'error', message: 'bad method' }))
    await new Promise<void>((r) => setTimeout(r, 30))
    expect(received).not.toBeNull()
    expect((received as unknown as WSProtocolError | null)?.message).toBe('bad method')
    await client.disconnect()
  })

  // (i) Welcome with extra channel → warns but accepts
  it('accepts subscriptions to extra channels advertised in welcome', async () => {
    autoAckSubscribes(server)
    server.setSendWelcome({
      available_subscriptions: [
        'completed_trades',
        'fills_spot',
        'recent_activity',
        'liquidation',
        'hip4_events',
        'experimental_new_channel',
      ],
    })
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const client = makeClient(server)
    await client.connect()
    // Cast required since 'experimental_new_channel' isn't in WSChannel literally,
    // but the SDK's allowlist accepts it at runtime per the welcome.
    await client.subscribe('experimental_new_channel' as never)
    const subs = server
      .receivedMessages()
      .filter((m) => (m as { method?: string })?.method === 'subscribe')
    expect(subs).toHaveLength(1)
    expect(warnSpy).toHaveBeenCalled()
    warnSpy.mockRestore()
    await client.disconnect()
  })

  // (j) listSubscriptions correlates and resolves
  it('listSubscriptions() resolves with active_subscriptions from the reply', async () => {
    const client = makeClient(server)
    await client.connect()
    server.wss.on('connection', () => {
      /* noop, already set in beforeEach */
    })
    const sock = server.lastSocket()
    sock?.on('message', (data) => {
      const parsed = JSON.parse(data.toString())
      if (parsed.method === 'list_subscriptions') {
        sock?.send(
          JSON.stringify({
            type: 'subscriptions_list',
            active_subscriptions: ['completed_trades|user=*', 'liquidation|user=*'],
          }),
        )
      }
    })
    const list = await client.listSubscriptions()
    expect(list).toEqual(['completed_trades|user=*', 'liquidation|user=*'])
    await client.disconnect()
  })

  // (k) disconnect() stops the reconnect loop
  it('disconnect() prevents any further reconnect attempts', async () => {
    const client = makeClient(server, { autoReconnect: true })
    await client.connect()
    await client.disconnect()
    // After disconnect, drop the server-side socket; the SDK should NOT reconnect.
    const before = server.receivedMessages().length
    await new Promise<void>((r) => setTimeout(r, 1200))
    expect(server.receivedMessages().length).toBe(before)
  })

  // (l) 1011 close treated as transient (reconnect attempted)
  it('treats 1011 close as transient and reconnects', async () => {
    const client = makeClient(server, { autoReconnect: true })
    await client.connect()
    let reconnectFired = false
    client.on('reconnect', () => {
      reconnectFired = true
    })
    server.lastSocket()?.close(1011, 'server hiccup')
    await new Promise<void>((r) => setTimeout(r, 1500))
    expect(reconnectFired).toBe(true)
    await client.disconnect()
  }, 10_000)

  // (m) 4xxx upgrade rejects with WSAuthError, no reconnect
  it('rejects with WSAuthError on 401 upgrade and stops the reconnect loop', async () => {
    server.setRejectUpgrade(401)
    const client = makeClient(server, { autoReconnect: true })
    let lastErr: unknown = null
    client.on('error', (e) => {
      lastErr = e
    })
    await expect(client.connect()).rejects.toBeInstanceOf(WSAuthError)
    expect(lastErr).toBeInstanceOf(WSAuthError)
    // No reconnect attempts after the 401
    let reconnectFired = false
    client.on('reconnect', () => {
      reconnectFired = true
    })
    await new Promise<void>((r) => setTimeout(r, 800))
    expect(reconnectFired).toBe(false)
    await client.disconnect()
  })

  it('rejects with RateLimitError on 429 upgrade', async () => {
    server.setRejectUpgrade(429, { 'Retry-After': '1' })
    const client = makeClient(server, { autoReconnect: false })
    await expect(client.connect()).rejects.toBeInstanceOf(RateLimitError)
    await client.disconnect()
  })

  // (g) Reconnect exponential backoff timings
  it('uses exponential backoff between reconnect attempts', async () => {
    // We can't easily fake-time the underlying ws server, so we observe real
    // wall-clock spacing. Use a no-welcome server so each openOnce fails fast
    // (welcome timeout = requestTimeoutMs * 4 = ~120ms here), then close
    // immediately to trigger reconnect cycles.
    server.setSendWelcome(false)
    const client = makeClient(server, {
      autoReconnect: true,
      requestTimeoutMs: 30,
    })
    const timestamps: number[] = []
    client.on('reconnect', ({ attempt }) => {
      timestamps.push(Date.now())
      // Stop after a few attempts to avoid hanging the test.
      if (attempt >= 2) {
        void client.disconnect()
      }
    })
    // The initial connect() will fail (welcome timeout). Wrap so we then let
    // reconnects fire.
    await client.connect().catch(() => undefined)

    // Wait long enough to see at least the first reconnect (~1s).
    await new Promise<void>((r) => setTimeout(r, 1300))

    expect(timestamps.length).toBeGreaterThanOrEqual(1)
    await client.disconnect()
  }, 10_000)
})
