import type { Coin } from '../types/common.js'

/**
 * Discriminated union over the six observed coin namespaces plus a fall-through
 * `unknown` case for forward-compat. See PLAN.md §G.1 / §G.2.
 */
export type ParsedCoin =
  | { kind: 'perp'; ticker: string }
  | { kind: 'spot'; index: number }
  | { kind: 'hip3'; dex: string; ticker: string }
  | { kind: 'hip4-outcome'; outcomeId: number }
  | { kind: 'hip4-outcome-fee'; outcomeId: number }
  | { kind: 'hip4-fallback' }
  | { kind: 'unknown'; raw: string }

const DIGITS_RE = /^\d+$/
const PERP_RE = /^[A-Z0-9]+$/

/**
 * Dispatches a raw API coin string to its semantic namespace. Pure / total —
 * never throws; anything that doesn't match a known shape falls into
 * `{ kind: 'unknown', raw }` so callers can detect drift.
 */
export function parseCoin(coin: Coin): ParsedCoin {
  if (coin === '') return { kind: 'hip4-fallback' }

  const first = coin.charAt(0)

  if (first === '@') {
    const rest = coin.slice(1)
    if (DIGITS_RE.test(rest)) return { kind: 'spot', index: Number(rest) }
    return { kind: 'unknown', raw: coin }
  }

  if (first === '#') {
    const rest = coin.slice(1)
    if (DIGITS_RE.test(rest)) return { kind: 'hip4-outcome', outcomeId: Number(rest) }
    return { kind: 'unknown', raw: coin }
  }

  if (first === '+') {
    const rest = coin.slice(1)
    if (DIGITS_RE.test(rest)) return { kind: 'hip4-outcome-fee', outcomeId: Number(rest) }
    return { kind: 'unknown', raw: coin }
  }

  const colonIdx = coin.indexOf(':')
  if (colonIdx !== -1) {
    const dex = coin.slice(0, colonIdx)
    const ticker = coin.slice(colonIdx + 1)
    if (dex.length === 0 || ticker.length === 0) return { kind: 'unknown', raw: coin }
    return { kind: 'hip3', dex, ticker }
  }

  if (PERP_RE.test(coin)) return { kind: 'perp', ticker: coin }

  return { kind: 'unknown', raw: coin }
}

/**
 * Inverse of {@link parseCoin}. Lossless on every valid kind — feeding a
 * `parseCoin(x)` result back through `formatCoin` returns `x` (modulo the
 * `unknown` case which round-trips by definition).
 */
export function formatCoin(parsed: ParsedCoin): Coin {
  switch (parsed.kind) {
    case 'perp':
      return parsed.ticker
    case 'spot':
      return `@${parsed.index}`
    case 'hip3':
      return `${parsed.dex}:${parsed.ticker}`
    case 'hip4-outcome':
      return `#${parsed.outcomeId}`
    case 'hip4-outcome-fee':
      return `+${parsed.outcomeId}`
    case 'hip4-fallback':
      return ''
    case 'unknown':
      return parsed.raw
  }
}
