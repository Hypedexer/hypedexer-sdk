/**
 * 04 — Liquidations across HIP-3 markets.
 *
 * Shows two flows: the fresh-tail (`recent`) for a live feed use-case, and
 * a filtered walk over a specific coin. HIP-3 tickers (`xyz:AAPL`, …) are
 * first-class and pass through as-is.
 *
 * Run: `HYPEDEXER_API_KEY=... pnpm --filter @hypedexer/examples liquidations`
 */
import { createClient } from '@hypedexer/sdk'

const apiKey = process.env['HYPEDEXER_API_KEY']
if (!apiKey) {
  console.error('Set HYPEDEXER_API_KEY in the environment.')
  process.exit(1)
}

const client = createClient({ apiKey })

const tail = await client.liquidations.recent({ limit: 5 })
console.log('most recent 5 liquidations (all markets):')
for (const l of tail.data) {
  const r = l as {
    time: string
    coin: string
    liq_dir: string | null
    notional_total: number
  }
  console.log(
    `  ${r.time}  ${r.coin.padEnd(14)} ${(r.liq_dir ?? '—').padEnd(6)}  $${r.notional_total.toFixed(2)}`,
  )
}

const target = 'xyz:AAPL'
const filtered = await client.liquidations.list({ coin: target, limit: 5 })
console.log(`\nlast ${filtered.data.length} ${target} liquidations:`)
for (const l of filtered.data) {
  const r = l as { time: string; liq_dir: string | null; notional_total: number }
  console.log(`  ${r.time}  ${(r.liq_dir ?? '—').padEnd(6)}  $${r.notional_total.toFixed(2)}`)
}
