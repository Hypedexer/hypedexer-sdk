/**
 * 06 — Typed error handling.
 *
 * Exercises the SDK's error hierarchy so consumers see how each failure
 * mode surfaces. Every SDK error extends `HypedexerError`, so a single
 * `catch (err) { if (err instanceof HypedexerError) … }` covers the tree.
 *
 *   HypedexerError
 *   ├── AuthError          (401)
 *   ├── NotFoundError      (404)
 *   ├── RateLimitError     (429, honours Retry-After)
 *   ├── ServerError        (5xx, message trimmed to 200 chars)
 *   ├── NetworkError       (fetch failure / JSON parse failure)
 *   ├── ValidationError    (422 with detail[], or SDK-side arg validation)
 *   └── WebSocketError
 *       ├── WSAuthError    (4xx upgrade or 4xxx close)
 *       ├── WSSubprotocolError  (1006 after welcome — PLAN §I #19)
 *       └── WSProtocolError     (server-sent `type: "error"` frame)
 *
 * Run: `HYPEDEXER_API_KEY=... pnpm --filter @hypedexer/examples errors`
 */
import { AuthError, HypedexerError, ValidationError, createClient } from '@hypedexer/sdk'

const apiKey = process.env['HYPEDEXER_API_KEY']
if (!apiKey) {
  console.error('Set HYPEDEXER_API_KEY in the environment.')
  process.exit(1)
}

async function tryIt(label: string, fn: () => Promise<unknown>): Promise<void> {
  try {
    await fn()
    console.log(`${label}: unexpected success`)
  } catch (err) {
    if (err instanceof HypedexerError) {
      console.log(
        `${label}: ${err.name} (status=${err.status ?? '—'})  ${err.message.slice(0, 80)}`,
      )
    } else if (err instanceof Error) {
      console.log(`${label}: unexpected ${err.name}: ${err.message}`)
    } else {
      console.log(`${label}: unexpected throw`, err)
    }
  }
}

// 1) SDK-side validation — bogus limit rejected before any request.
await tryIt('bogus limit (SDK)', async () => {
  const client = createClient({ apiKey })
  await client.fills.list({ limit: 999_999 })
})

// 2) SDK-side validation — bogus address.
await tryIt('bogus address (SDK)', async () => {
  const client = createClient({ apiKey })
  // deliberate cast — the branded Address type would normally block this.
  await client.users.overview('not-an-address' as `0x${string}`)
})

// 3) HTTP 401 — pass an obviously bad key.
await tryIt('bad api key (HTTP 401)', async () => {
  const client = createClient({ apiKey: 'hl_live_bogus_key_that_wont_auth' })
  await client.overview.totalFees24h()
})

// 4) ValidationError from the SDK constructor.
await tryIt('empty api key (constructor)', async () => {
  createClient({ apiKey: '' })
  return undefined
})

// Bonus — cast so the reader sees explicit narrowing.
try {
  createClient({ apiKey: '' })
} catch (err) {
  if (err instanceof ValidationError) {
    console.log(`  ↳ ValidationError detail[0].loc = ${JSON.stringify(err.detail[0]?.loc)}`)
  }
  if (err instanceof AuthError) {
    // unreachable, kept to show class-narrowing usage
    console.log(`  auth: ${err.status}`)
  }
}
