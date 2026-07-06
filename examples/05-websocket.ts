/**
 * 05 — WebSocket subscription.
 *
 * Opens the realtime WS, subscribes to the `completed_trades` channel, prints
 * every push for 15 s, then cleanly disconnects. Demonstrates:
 *
 * - lazy `ws` peer dep — construction is cheap, `connect()` opens the socket
 * - typed listener overloads — `msg.channel`, `msg.count`, `msg.items` are
 *   narrowed to the channel you subscribed to
 * - graceful teardown via `disconnect()` (returns after the socket flushes)
 *
 * Node-only per PLAN §I #19; browsers throw on construction.
 *
 * Run: `HYPEDEXER_API_KEY=... pnpm --filter @hypedexer/examples websocket`
 */
import { createClient } from '@hypedexer/sdk'

const apiKey = process.env['HYPEDEXER_API_KEY']
if (!apiKey) {
  console.error('Set HYPEDEXER_API_KEY in the environment.')
  process.exit(1)
}

const client = createClient({ apiKey })

client.ws.on('open', () => console.log('[ws] open'))
client.ws.on('close', ({ code, reason }) => console.log(`[ws] close ${code} ${reason ?? ''}`))
client.ws.on('reconnect', ({ attempt }) => console.log(`[ws] reconnect attempt ${attempt}`))
client.ws.on('error', (err) => console.error(`[ws] error: ${err.name}: ${err.message}`))

let received = 0
const stopAt = Date.now() + 15_000
client.ws.on('completed_trades', (msg) => {
  received += msg.count
  const preview = msg.items.slice(0, 3)
  console.log(`[completed_trades] +${msg.count} (total=${received})`, preview)
})

await client.ws.connect()
await client.ws.subscribe('completed_trades')

await new Promise<void>((r) => setTimeout(r, Math.max(0, stopAt - Date.now())))

console.log(`\nreceived ${received} completed trades in 15 s`)
await client.ws.unsubscribe('completed_trades')
await client.ws.disconnect()
