/**
 * 01 — Paginating recent fills.
 *
 * Uses the async-iterable helper `iterate()` to walk cursor-paginated pages
 * of `/fills/` until we've collected N rows, then prints a compact summary.
 * The iterator handles cursor threading and stops on the last page.
 *
 * Note: `iterateRecent()` also exists for the 24h hot cache, but upstream
 * `/fills/recent` has been intermittently 502-ing (~30 s hangs) — the full
 * `/fills/` endpoint is the reliable path for now.
 *
 * Run: `HYPEDEXER_API_KEY=... pnpm --filter @hypedexer/examples fills`
 */
import { createClient } from '@hypedexer/sdk'

const apiKey = process.env['HYPEDEXER_API_KEY']
if (!apiKey) {
  console.error('Set HYPEDEXER_API_KEY in the environment.')
  process.exit(1)
}

// The full /fills/ endpoint scans a large history-of-trades table upstream
// and can be slow (double-digit seconds). Raise the client-wide timeout so
// the example doesn't spuriously fail on cold cache.
const client = createClient({ apiKey, timeoutMs: 120_000 })

const target = 25
const rows: unknown[] = []

for await (const fill of client.fills.iterate({ limit: 10 })) {
  rows.push(fill)
  if (rows.length >= target) break
}

console.log(`fetched ${rows.length} recent fills`)
for (const f of rows.slice(0, 5)) {
  const r = f as { time: string; coin: string; side: string; px: string; sz: string }
  console.log(`  ${r.time}  ${r.coin.padEnd(10)}  ${r.side}  px=${r.px}  sz=${r.sz}`)
}
console.log(`  ... (${rows.length - 5} more)`)
