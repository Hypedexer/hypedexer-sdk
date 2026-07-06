/**
 * 02 — User profile.
 *
 * Fetches a user's overview (equity, PnL, volume) and top coins by turnover.
 * Demonstrates the `Single<T>` return shape (unwrapped envelope) and how the
 * SDK strongly-types HL addresses via the `Address` brand.
 *
 * Run: `HYPEDEXER_API_KEY=... pnpm --filter @hypedexer/examples profile`
 */
import { createClient } from '@hypedexer/sdk'

const apiKey = process.env['HYPEDEXER_API_KEY']
if (!apiKey) {
  console.error('Set HYPEDEXER_API_KEY in the environment.')
  process.exit(1)
}

const client = createClient({ apiKey })

const user = (process.env['HL_USER'] ??
  '0x3f6940CbddF3BCfe1B1B6290dcbbeBF7d9b55943') as `0x${string}`

const [overview, coins] = await Promise.all([
  client.users.overview(user),
  client.users.coins(user, { limit: 5 }),
])

console.log(`user: ${user}`)
console.log('overview:')
console.log(`  ${JSON.stringify(overview.data, null, 2).split('\n').join('\n  ')}`)
console.log(`top ${coins.data.length} coins by turnover:`)
for (const c of coins.data) {
  console.log(`  ${JSON.stringify(c)}`)
}
