/**
 * 03 — HIP-3 markets discovery.
 *
 * Walks HypeDexer's HIP-3 surface: list every active dex, then drill into
 * one of them (`xyz`, the equities-flavoured sub-dex) and print its top
 * assets. This is the flow the SDK's `hip3` handle is designed for — dexs
 * are enumerable, assets are namespaced under `${dexId}:${ticker}`.
 *
 * Run: `HYPEDEXER_API_KEY=... pnpm --filter @hypedexer/examples hip3`
 */
import { createClient } from '@hypedexer/sdk'

const apiKey = process.env['HYPEDEXER_API_KEY']
if (!apiKey) {
  console.error('Set HYPEDEXER_API_KEY in the environment.')
  process.exit(1)
}

const client = createClient({ apiKey })

const dexs = await client.hip3.dexs.list({ limit: 50 })
console.log(`hip3 dexs (${dexs.data.length}):`)
for (const d of dexs.data) {
  const r = d as { dex_id: string; name: string; collateral_asset?: string }
  console.log(`  ${r.dex_id.padEnd(8)} ${r.name}  (collateral: ${r.collateral_asset ?? '?'})`)
}

const assets = await client.hip3.assets.list({ limit: 200 })
const xyzAssets = assets.data.filter((a) => (a as { dex_id: string }).dex_id === 'xyz').slice(0, 10)
console.log(`\nfirst ${xyzAssets.length} xyz:* assets:`)
for (const a of xyzAssets) {
  const r = a as { ticker: string; symbol: string; max_leverage: number; oi_cap_usd: number }
  console.log(
    `  ${r.ticker.padEnd(20)} ${r.symbol.padEnd(16)} maxLev=${r.max_leverage}x  oiCap=$${r.oi_cap_usd.toLocaleString()}`,
  )
}
