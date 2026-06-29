import { describe, expect, it, vi } from 'vitest'
import { createClient } from '../src/index.js'

function makeFetch(): typeof fetch {
  // Tier-2 smoke is purely a shape check; tests should never reach the wire.
  return vi.fn(async () => {
    throw new Error('Tier-2 smoke test should not call fetch')
  }) as unknown as typeof fetch
}

describe('createClient — Tier-2 resources', () => {
  const client = createClient({ apiKey: 'test-key', fetch: makeFetch() })

  it('exposes the HIP-3 resource with nested sub-resources', () => {
    expect(typeof client.hip3.overview).toBe('function')
    expect(typeof client.hip3.snapshots).toBe('function')
    expect(typeof client.hip3.topMovers).toBe('function')
    expect(typeof client.hip3.ohlcv).toBe('function')
    expect(typeof client.hip3.oracleStats).toBe('function')
    expect(typeof client.hip3.leaderboard).toBe('function')
    expect(typeof client.hip3.user).toBe('function')
    expect(typeof client.hip3.dexs.list).toBe('function')
    expect(typeof client.hip3.dexs.iterate).toBe('function')
    expect(typeof client.hip3.dexs.get).toBe('function')
    expect(typeof client.hip3.assets.list).toBe('function')
    expect(typeof client.hip3.assets.iterate).toBe('function')
    expect(typeof client.hip3.assets.get).toBe('function')
    expect(typeof client.hip3.auctions.list).toBe('function')
    expect(typeof client.hip3.auctions.current).toBe('function')
    expect(typeof client.hip3.auctions.history.list).toBe('function')
    expect(typeof client.hip3.fills.list).toBe('function')
    expect(typeof client.hip3.fills.iterate).toBe('function')
    expect(typeof client.hip3.stats.traders).toBe('function')
  })

  it('exposes the HIP-4 resource with all sub-resources', () => {
    expect(typeof client.hip4.markets.list).toBe('function')
    expect(typeof client.hip4.markets.iterate).toBe('function')
    expect(typeof client.hip4.outcomes.list).toBe('function')
    expect(typeof client.hip4.outcomes.iterate).toBe('function')
    expect(typeof client.hip4.questions.list).toBe('function')
    expect(typeof client.hip4.questions.iterate).toBe('function')
    expect(typeof client.hip4.outcomeTokens.list).toBe('function')
    expect(typeof client.hip4.outcomeTokens.iterate).toBe('function')
    expect(typeof client.hip4.fills.list).toBe('function')
    expect(typeof client.hip4.fills.iterate).toBe('function')
    expect(typeof client.hip4.fees.list).toBe('function')
    expect(typeof client.hip4.fees.iterate).toBe('function')
    expect(typeof client.hip4.settlements.list).toBe('function')
    expect(typeof client.hip4.settlements.iterate).toBe('function')
    expect(typeof client.hip4.feeScales.list).toBe('function')
    expect(typeof client.hip4.analytics.list).toBe('function')
    expect(typeof client.hip4.analytics.iterate).toBe('function')
    expect(typeof client.hip4.userActions.list).toBe('function')
    expect(typeof client.hip4.userActions.iterate).toBe('function')
  })

  it('exposes the Builders resource', () => {
    expect(typeof client.builders.top).toBe('function')
    expect(typeof client.builders.iterateTop).toBe('function')
    expect(typeof client.builders.stats).toBe('function')
    expect(typeof client.builders.statsAllTimeframes).toBe('function')
    expect(typeof client.builders.addrStats).toBe('function')
    expect(typeof client.builders.users).toBe('function')
    expect(typeof client.builders.iterateUsers).toBe('function')
    expect(typeof client.builders.list).toBe('function')
  })

  it('exposes the TWAPs resource', () => {
    expect(typeof client.twaps.list).toBe('function')
    expect(typeof client.twaps.iterate).toBe('function')
    expect(typeof client.twaps.stats).toBe('function')
    expect(typeof client.twaps.user).toBe('function')
    expect(typeof client.twaps.iterateUser).toBe('function')
    expect(typeof client.twaps.get).toBe('function')
    expect(typeof client.twaps.fills).toBe('function')
    expect(typeof client.twaps.iterateFills).toBe('function')
  })

  it('exposes the Funding resource', () => {
    expect(typeof client.funding.predicted).toBe('function')
    expect(typeof client.funding.history).toBe('function')
    expect(typeof client.funding.iterateHistory).toBe('function')
    expect(typeof client.funding.userFunding).toBe('function')
    expect(typeof client.funding.iterateUserFunding).toBe('function')
  })

  it('exposes the Vaults resource', () => {
    expect(typeof client.vaults.list).toBe('function')
    expect(typeof client.vaults.iterate).toBe('function')
    expect(typeof client.vaults.details).toBe('function')
    expect(typeof client.vaults.dailySnapshots).toBe('function')
    expect(typeof client.vaults.iterateDailySnapshots).toBe('function')
    expect(typeof client.vaults.equitySnapshots).toBe('function')
    expect(typeof client.vaults.iterateEquitySnapshots).toBe('function')
    expect(typeof client.vaults.ledger).toBe('function')
    expect(typeof client.vaults.iterateLedger).toBe('function')
    expect(typeof client.vaults.userVaultEquities).toBe('function')
  })

  it('exposes the Priority Fees (gossip) resource', () => {
    expect(typeof client.priorityFees.status).toBe('function')
    expect(typeof client.priorityFees.history).toBe('function')
    expect(typeof client.priorityFees.iterate).toBe('function')
    expect(typeof client.priorityFees.dedupedHistory).toBe('function')
  })

  it('exposes the /info dispatcher resource', () => {
    expect(typeof client.info.info).toBe('function')
  })

  it('exposes the EVM resource with nested sub-resources', () => {
    expect(typeof client.evm.blocks.list).toBe('function')
    expect(typeof client.evm.blocks.iterate).toBe('function')
    expect(typeof client.evm.blocks.get).toBe('function')
    expect(typeof client.evm.blocks.transactions).toBe('function')
    expect(typeof client.evm.blocks.iterateTransactions).toBe('function')
    expect(typeof client.evm.transactions.list).toBe('function')
    expect(typeof client.evm.transactions.iterate).toBe('function')
    expect(typeof client.evm.logs.list).toBe('function')
    expect(typeof client.evm.logs.iterate).toBe('function')
    expect(typeof client.evm.transfers.list).toBe('function')
    expect(typeof client.evm.transfers.iterate).toBe('function')
    expect(typeof client.evm.bridge.events.list).toBe('function')
    expect(typeof client.evm.bridge.events.iterate).toBe('function')
    expect(typeof client.evm.stats.get).toBe('function')
    expect(typeof client.evm.stats.daily).toBe('function')
    expect(typeof client.evm.user).toBe('function')
    expect(typeof client.evm.hip3.backstop.health.list).toBe('function')
    expect(typeof client.evm.hip3.backstop.health.get).toBe('function')
    expect(typeof client.evm.hip3.backstop.transfers.list).toBe('function')
    expect(typeof client.evm.hip3.backstop.transfers.iterate).toBe('function')
    expect(typeof client.evm.hip3.backstop.transfers.summary).toBe('function')
    expect(typeof client.evm.hip3.backstop.fills).toBe('function')
  })
})
