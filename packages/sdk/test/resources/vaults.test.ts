import { describe, expect, it, vi } from 'vitest'
import { ValidationError } from '../../src/errors/index.js'
import { VaultsResource } from '../../src/resources/vaults.js'
import { HttpClient } from '../../src/transport/HttpClient.js'
import type { Address } from '../../src/types/common.js'
import type {
  VaultDailySnapshot,
  VaultEquitySnapshot,
  VaultLedgerTx,
  VaultSummary,
} from '../../src/types/vault.js'

const VAULT_ADDRESS = '0xdfc24b077bc1425ad1dea75bcb6f8158e10df303' as Address
const VAULT_ADDRESS_MIXED = '0xDFC24B077Bc1425AD1Dea75bcb6f8158E10Df303' as Address
const USER_ADDRESS = '0x13ab1fa35000f7332c601b17dd1ea796a85fe803' as Address
const OTHER_ADDRESS = '0x1111111111111111111111111111111111111111' as Address
const BAD_ADDRESS = '0xnot-an-address'

function mockResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

function buildClient(handler: (url: URL, init: RequestInit | undefined) => Response) {
  const fetchMock = vi.fn(async (input: string | URL, init?: RequestInit) => {
    const url = new URL(input.toString())
    return handler(url, init)
  })
  const http = new HttpClient({
    apiKey: 'test-key',
    fetch: fetchMock as unknown as typeof fetch,
  })
  return { http, fetchMock }
}

function sampleSummary(overrides: Partial<VaultSummary> = {}): VaultSummary {
  return {
    vaultAddress: VAULT_ADDRESS,
    name: 'Hyperliquidity Provider',
    leader: '0xaaa0000000000000000000000000000000000000' as Address,
    leaderCommission: 0,
    isClosed: false,
    followerCount: 30000,
    snapshotTime: 1778521680500,
    createTime: 1700000000000,
    ...overrides,
  }
}

function sampleDailySnapshot(overrides: Partial<VaultDailySnapshot> = {}): VaultDailySnapshot {
  return {
    time: 1778521680500,
    day: '2026-05-11',
    totalDeposits: 271_000_000,
    accountValue: 280_000_000,
    totalNotional: 500_000_000,
    totalRawPnl: 9_000_000,
    nPositions: 42,
    followerCount: 30000,
    ...overrides,
  }
}

function sampleEquitySnapshot(overrides: Partial<VaultEquitySnapshot> = {}): VaultEquitySnapshot {
  return {
    time: 1778521680500,
    totalDeposits: 271_000_000,
    accountValue: 280_000_000,
    totalNotional: 500_000_000,
    totalRawPnl: 9_000_000,
    nPositions: 42,
    followerCount: 30000,
    ...overrides,
  }
}

// -----------------------------------------------------------------------------
// list — GET /vaults/vaultSummaries
// -----------------------------------------------------------------------------

describe('VaultsResource.list', () => {
  it('GETs /vaults/vaultSummaries and unwraps bare Page<VaultSummary>', async () => {
    const rows = [sampleSummary(), sampleSummary({ name: 'Other vault' })]
    const { http, fetchMock } = buildClient((url) => {
      expect(url.pathname).toBe('/vaults/vaultSummaries')
      expect(url.searchParams.get('limit')).toBe('100')
      expect(url.searchParams.get('offset')).toBe('0')
      expect(url.searchParams.get('includeClosed')).toBe('true')
      return mockResponse(rows)
    })
    const vaults = new VaultsResource(http)

    const page = await vaults.list({ limit: 100, offset: 0, includeClosed: true })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(page.data).toEqual(rows)
    expect(page.meta.family).toBe('bare')
  })

  it('omits unset params from the query string', async () => {
    const { http } = buildClient((url) => {
      expect(url.pathname).toBe('/vaults/vaultSummaries')
      expect(url.searchParams.has('limit')).toBe(false)
      expect(url.searchParams.has('offset')).toBe(false)
      expect(url.searchParams.has('includeClosed')).toBe(false)
      return mockResponse([])
    })
    const vaults = new VaultsResource(http)
    const page = await vaults.list()
    expect(page.data).toEqual([])
  })

  it('throws ValidationError when limit exceeds the 5000 cap', async () => {
    const { http, fetchMock } = buildClient(() => mockResponse([]))
    const vaults = new VaultsResource(http)
    await expect(vaults.list({ limit: 99_999 })).rejects.toBeInstanceOf(ValidationError)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

// -----------------------------------------------------------------------------
// iterate — offset pagination over /vaults/vaultSummaries
// -----------------------------------------------------------------------------

describe('VaultsResource.iterate', () => {
  it('walks two pages by incrementing offset and stops on a short page', async () => {
    const page1 = [
      sampleSummary({ vaultAddress: VAULT_ADDRESS, name: 'v1' }),
      sampleSummary({ vaultAddress: VAULT_ADDRESS, name: 'v2' }),
    ]
    const page2 = [sampleSummary({ vaultAddress: VAULT_ADDRESS, name: 'v3' })]

    const { http, fetchMock } = buildClient((url) => {
      expect(url.pathname).toBe('/vaults/vaultSummaries')
      const offset = url.searchParams.get('offset')
      expect(url.searchParams.get('limit')).toBe('2')
      if (offset === '0') return mockResponse(page1)
      expect(offset).toBe('2')
      return mockResponse(page2)
    })
    const vaults = new VaultsResource(http)

    const names: string[] = []
    for await (const v of vaults.iterate({ limit: 2 })) names.push(v.name)

    expect(names).toEqual(['v1', 'v2', 'v3'])
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })
})

// -----------------------------------------------------------------------------
// details — GET /vaults/vaultDetails
// -----------------------------------------------------------------------------

describe('VaultsResource.details', () => {
  it('GETs /vaults/vaultDetails and renames portfolio → leaderCommissionHistory (bug #24)', async () => {
    const portfolio = [
      { time: 1778500000000, followerCount: 29000, leaderCommission: 0 },
      { time: 1778600000000, followerCount: 30000, leaderCommission: 0 },
    ]
    const wirePayload = {
      vaultAddress: VAULT_ADDRESS,
      name: 'HLP',
      leader: '0xaaa0000000000000000000000000000000000000',
      leaderCommission: 0,
      isClosed: false,
      followerCount: 30000,
      snapshotTime: 1778521680500,
      createTime: 1700000000000,
      lockupDurationSeconds: 86400,
      allowDeposits: true,
      portfolio,
    }

    const { http, fetchMock } = buildClient((url) => {
      expect(url.pathname).toBe('/vaults/vaultDetails')
      expect(url.searchParams.get('vaultAddress')).toBe(VAULT_ADDRESS)
      expect(url.searchParams.get('startTime')).toBe('1778500000000')
      expect(url.searchParams.get('endTime')).toBe('1778600000000')
      return mockResponse(wirePayload)
    })
    const vaults = new VaultsResource(http)

    const res = await vaults.details({
      vaultAddress: VAULT_ADDRESS,
      startTime: 1778500000000,
      endTime: 1778600000000,
    })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(res.data.vaultAddress).toBe(VAULT_ADDRESS)
    expect(res.data.lockupDurationSeconds).toBe(86400)
    expect(res.data.allowDeposits).toBe(true)
    expect(res.data.leaderCommissionHistory).toEqual(portfolio)
    // The raw "portfolio" property should not be present on the typed model.
    expect((res.data as Record<string, unknown>)['portfolio']).toBeUndefined()
    expect(res.meta.family).toBe('bare')
  })

  it('defaults leaderCommissionHistory to [] when upstream omits portfolio', async () => {
    const wirePayload = {
      vaultAddress: VAULT_ADDRESS,
      name: 'HLP',
      leader: '0xaaa0000000000000000000000000000000000000',
      leaderCommission: 0,
      isClosed: false,
      followerCount: 30000,
      snapshotTime: 1778521680500,
      createTime: 1700000000000,
      lockupDurationSeconds: 0,
      allowDeposits: false,
    }
    const { http } = buildClient(() => mockResponse(wirePayload))
    const vaults = new VaultsResource(http)
    const res = await vaults.details({ vaultAddress: VAULT_ADDRESS })
    expect(res.data.leaderCommissionHistory).toEqual([])
  })

  it('throws ValidationError on a bad vaultAddress without making a fetch call', async () => {
    const { http, fetchMock } = buildClient(() => mockResponse({}))
    const vaults = new VaultsResource(http)
    await expect(vaults.details({ vaultAddress: BAD_ADDRESS as Address })).rejects.toBeInstanceOf(
      ValidationError,
    )
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

// -----------------------------------------------------------------------------
// dailySnapshots — GET /vaults/dailySnapshots
// -----------------------------------------------------------------------------

describe('VaultsResource.dailySnapshots', () => {
  it('GETs /vaults/dailySnapshots with epoch-camel time params', async () => {
    const rows = [sampleDailySnapshot(), sampleDailySnapshot({ day: '2026-05-10' })]
    const { http, fetchMock } = buildClient((url) => {
      expect(url.pathname).toBe('/vaults/dailySnapshots')
      expect(url.searchParams.get('vaultAddress')).toBe(VAULT_ADDRESS)
      expect(url.searchParams.get('startTime')).toBe('1700000000000')
      expect(url.searchParams.get('endTime')).toBe('1800000000000')
      expect(url.searchParams.get('limit')).toBe('500')
      return mockResponse(rows)
    })
    const vaults = new VaultsResource(http)

    const page = await vaults.dailySnapshots({
      vaultAddress: VAULT_ADDRESS,
      startTime: 1700000000000,
      endTime: 1800000000000,
      limit: 500,
    })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(page.data).toEqual(rows)
    expect(page.meta.family).toBe('bare')
  })

  it('throws ValidationError when limit exceeds the 5000 cap', async () => {
    const { http, fetchMock } = buildClient(() => mockResponse([]))
    const vaults = new VaultsResource(http)
    await expect(
      vaults.dailySnapshots({ vaultAddress: VAULT_ADDRESS, limit: 99_999 }),
    ).rejects.toBeInstanceOf(ValidationError)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('iterateDailySnapshots pages backwards using `time` as the time key', async () => {
    const { http, fetchMock } = buildClient((url) => {
      expect(url.pathname).toBe('/vaults/dailySnapshots')
      const endTime = url.searchParams.get('endTime')
      if (endTime === null) {
        return mockResponse([
          sampleDailySnapshot({ time: 1000, day: '2026-05-11' }),
          sampleDailySnapshot({ time: 900, day: '2026-05-10' }),
        ])
      }
      if (endTime === '899') {
        return mockResponse([sampleDailySnapshot({ time: 800, day: '2026-05-09' })])
      }
      return mockResponse([])
    })
    const vaults = new VaultsResource(http)

    const times: number[] = []
    for await (const row of vaults.iterateDailySnapshots({ vaultAddress: VAULT_ADDRESS })) {
      times.push(row.time)
    }
    expect(times).toEqual([1000, 900, 800])
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })
})

// -----------------------------------------------------------------------------
// equitySnapshots — GET /vaults/equitySnapshots
// -----------------------------------------------------------------------------

describe('VaultsResource.equitySnapshots', () => {
  it('GETs /vaults/equitySnapshots with epoch-camel time params', async () => {
    const rows = [sampleEquitySnapshot(), sampleEquitySnapshot({ time: 1778521680400 })]
    const { http, fetchMock } = buildClient((url) => {
      expect(url.pathname).toBe('/vaults/equitySnapshots')
      expect(url.searchParams.get('vaultAddress')).toBe(VAULT_ADDRESS)
      expect(url.searchParams.has('limit')).toBe(false)
      return mockResponse(rows)
    })
    const vaults = new VaultsResource(http)

    const page = await vaults.equitySnapshots({ vaultAddress: VAULT_ADDRESS })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(page.data).toEqual(rows)
    expect(page.data[0]).not.toHaveProperty('day')
  })

  it('iterateEquitySnapshots stops when a page returns []', async () => {
    const { http, fetchMock } = buildClient((url) => {
      const endTime = url.searchParams.get('endTime')
      if (endTime === null) return mockResponse([sampleEquitySnapshot({ time: 500 })])
      if (endTime === '499') return mockResponse([])
      throw new Error(`unexpected endTime: ${endTime}`)
    })
    const vaults = new VaultsResource(http)
    const out: VaultEquitySnapshot[] = []
    for await (const r of vaults.iterateEquitySnapshots({ vaultAddress: VAULT_ADDRESS })) {
      out.push(r)
    }
    expect(out).toHaveLength(1)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('throws ValidationError on a bad vaultAddress', async () => {
    const { http, fetchMock } = buildClient(() => mockResponse([]))
    const vaults = new VaultsResource(http)
    await expect(
      vaults.equitySnapshots({ vaultAddress: BAD_ADDRESS as Address }),
    ).rejects.toBeInstanceOf(ValidationError)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

// -----------------------------------------------------------------------------
// userVaultEquities — GET /vaults/userVaultEquities
// -----------------------------------------------------------------------------

describe('VaultsResource.userVaultEquities', () => {
  it('GETs /vaults/userVaultEquities with the user query param', async () => {
    const { http, fetchMock } = buildClient((url) => {
      expect(url.pathname).toBe('/vaults/userVaultEquities')
      expect(url.searchParams.get('user')).toBe(USER_ADDRESS)
      return mockResponse([])
    })
    const vaults = new VaultsResource(http)
    const page = await vaults.userVaultEquities({ user: USER_ADDRESS })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(page.data).toEqual([])
    expect(page.meta.family).toBe('bare')
  })

  it('throws ValidationError on a bad user address', async () => {
    const { http, fetchMock } = buildClient(() => mockResponse([]))
    const vaults = new VaultsResource(http)
    await expect(vaults.userVaultEquities({ user: BAD_ADDRESS as Address })).rejects.toBeInstanceOf(
      ValidationError,
    )
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

// -----------------------------------------------------------------------------
// ledger — GET /vaults/vaultLedger (synthesizes kind per bug #25)
// -----------------------------------------------------------------------------

describe('VaultsResource.ledger', () => {
  it('GETs /vaults/vaultLedger and synthesizes kind=deposit/withdraw (bug #25)', async () => {
    const rows = [
      // userTo === vaultAddress → deposit
      {
        time: 1778521680500,
        txHash: '0xabc1',
        userFrom: USER_ADDRESS,
        userTo: VAULT_ADDRESS,
        amount: 1000,
        token: 'USDC',
      },
      // userTo !== vaultAddress → withdraw
      {
        time: 1778521680400,
        txHash: '0xabc2',
        userFrom: VAULT_ADDRESS,
        userTo: USER_ADDRESS,
        amount: 500,
        token: 'USDC',
      },
    ]
    const { http, fetchMock } = buildClient((url) => {
      expect(url.pathname).toBe('/vaults/vaultLedger')
      expect(url.searchParams.get('vaultAddress')).toBe(VAULT_ADDRESS)
      expect(url.searchParams.get('user')).toBe(USER_ADDRESS)
      expect(url.searchParams.get('startTime')).toBe('1700000000000')
      expect(url.searchParams.get('endTime')).toBe('1800000000000')
      expect(url.searchParams.get('limit')).toBe('100')
      return mockResponse(rows)
    })
    const vaults = new VaultsResource(http)

    const page = await vaults.ledger({
      vaultAddress: VAULT_ADDRESS,
      user: USER_ADDRESS,
      startTime: 1700000000000,
      endTime: 1800000000000,
      limit: 100,
    })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(page.data.map((t: VaultLedgerTx) => t.kind)).toEqual(['deposit', 'withdraw'])
    expect(page.data[0]?.txHash).toBe('0xabc1')
    expect(page.meta.family).toBe('bare')
  })

  it('does case-insensitive vaultAddress comparison when synthesizing kind', async () => {
    const rows = [
      // wire userTo is mixed-case version of the requested vaultAddress
      {
        time: 1,
        txHash: '0xabc',
        userFrom: USER_ADDRESS,
        userTo: VAULT_ADDRESS_MIXED,
        amount: 1,
        token: 'USDC',
      },
      {
        time: 2,
        txHash: '0xdef',
        userFrom: VAULT_ADDRESS_MIXED,
        userTo: OTHER_ADDRESS,
        amount: 2,
        token: 'USDC',
      },
    ]
    const { http } = buildClient(() => mockResponse(rows))
    const vaults = new VaultsResource(http)
    const page = await vaults.ledger({ vaultAddress: VAULT_ADDRESS })
    expect(page.data.map((t) => t.kind)).toEqual(['deposit', 'withdraw'])
  })

  it('throws ValidationError on a bad vaultAddress without making a fetch call', async () => {
    const { http, fetchMock } = buildClient(() => mockResponse([]))
    const vaults = new VaultsResource(http)
    await expect(vaults.ledger({ vaultAddress: BAD_ADDRESS as Address })).rejects.toBeInstanceOf(
      ValidationError,
    )
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('throws ValidationError on a bad user filter without making a fetch call', async () => {
    const { http, fetchMock } = buildClient(() => mockResponse([]))
    const vaults = new VaultsResource(http)
    await expect(
      vaults.ledger({ vaultAddress: VAULT_ADDRESS, user: BAD_ADDRESS as Address }),
    ).rejects.toBeInstanceOf(ValidationError)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('iterateLedger walks two time-window pages by decrementing endTime', async () => {
    const { http, fetchMock } = buildClient((url) => {
      expect(url.pathname).toBe('/vaults/vaultLedger')
      expect(url.searchParams.get('vaultAddress')).toBe(VAULT_ADDRESS)
      const endTime = url.searchParams.get('endTime')
      if (endTime === null) {
        return mockResponse([
          {
            time: 1000,
            txHash: '0x1',
            userFrom: USER_ADDRESS,
            userTo: VAULT_ADDRESS,
            amount: 1,
            token: 'USDC',
          },
          {
            time: 900,
            txHash: '0x2',
            userFrom: VAULT_ADDRESS,
            userTo: USER_ADDRESS,
            amount: 2,
            token: 'USDC',
          },
        ])
      }
      if (endTime === '899') {
        return mockResponse([
          {
            time: 800,
            txHash: '0x3',
            userFrom: USER_ADDRESS,
            userTo: VAULT_ADDRESS,
            amount: 3,
            token: 'USDC',
          },
        ])
      }
      return mockResponse([])
    })
    const vaults = new VaultsResource(http)

    const collected: VaultLedgerTx[] = []
    for await (const tx of vaults.iterateLedger({ vaultAddress: VAULT_ADDRESS })) {
      collected.push(tx)
    }
    expect(collected.map((t) => t.txHash)).toEqual(['0x1', '0x2', '0x3'])
    expect(collected.map((t) => t.kind)).toEqual(['deposit', 'withdraw', 'deposit'])
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })
})
