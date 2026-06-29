import { describe, expect, it, vi } from 'vitest'
import { NotFoundError, ValidationError } from '../../src/errors/index.js'
import { Hip3Resource } from '../../src/resources/hip3.js'
import { HttpClient } from '../../src/transport/HttpClient.js'
import type { Address } from '../../src/types/common.js'
import type {
  AssetConfig,
  Auction,
  AuctionHistory,
  DexRegistry,
  Hip3Fill,
  Hip3LeaderboardEntry,
  Hip3Overview,
  LiveSnapshot,
  OhlcvBar,
  OracleStats1m,
  TraderStats,
  UserCoinStats,
  UserHip3Overview,
} from '../../src/types/hip3.js'

const VALID_ADDRESS = '0xce975678a14f17a15c946b95704744cd7c677e78' as Address
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

function sampleOverview(): Hip3Overview {
  return {
    total_dexs: 8,
    total_assets: 168,
    total_volume_24h: 2_584_407_211.5,
    total_fees_24h: 280_541.83,
    total_trades_24h: 4_391_528,
    total_open_interest: 2_544_697_525.58,
    auction_active: true,
    auction_price_hype: 500.0,
    auction_end_at: '2026-05-12T07:00:00Z',
    next_auction_at: null,
  }
}

function sampleDex(overrides: Partial<DexRegistry> = {}): DexRegistry {
  return {
    dex_id: 'xyz',
    name: 'XYZ',
    deployer_address: '0x88806a71d74ad0a510b350545c9ae490912f0888',
    oracle_updater: '',
    collateral_asset: 'USDC',
    fee_share_pct: 1.0,
    is_growth_mode: false,
    active_since: '2026-05-11T16:45:11',
    total_staked_hype: 0.0,
    ...overrides,
  }
}

function sampleAsset(overrides: Partial<AssetConfig> = {}): AssetConfig {
  return {
    dex_id: 'xyz',
    asset_id: 0,
    ticker: 'xyz:CL',
    symbol: 'CL/USDC',
    max_leverage: 5,
    oi_cap_usd: 1_000_000_000.0,
    is_halted: false,
    oracle_source: 'hip3_node',
    update_timestamp: '2026-05-11T16:45:11',
    fee_share_pct: 1.0,
    ...overrides,
  }
}

function sampleAuction(overrides: Partial<Auction> = {}): Auction {
  return {
    auction_id: 1_778_457_600,
    start_time: '2026-05-11T00:00:00',
    end_time_scheduled: '2026-05-12T07:00:00',
    start_price_hype: 500.0,
    floor_price_hype: 0.0,
    current_gas: null,
    winner_address: '0x88806a71d74ad0a510b350545c9ae490912f0888',
    winning_bid_hype: 500.0,
    winning_ticker: 'xyz:ARM',
    status: 'closed',
    tx_hash: null,
    ...overrides,
  }
}

function sampleAuctionHistory(overrides: Partial<AuctionHistory> = {}): AuctionHistory {
  return {
    time: '2026-05-11T00:00:00',
    dex_id: '',
    coin: '',
    auction_id: '1778346000',
    start_px: 1000.0,
    end_px: 0.0,
    cleared_px: 0.0,
    winner: '',
    sz: 0.0,
    status: 'expired',
    duration_seconds: 111600,
    ...overrides,
  }
}

function sampleSnapshot(overrides: Partial<LiveSnapshot> = {}): LiveSnapshot {
  return {
    dex_id: 'xyz',
    coin: 'xyz:CL',
    current_mark_price: 97.618,
    current_oracle_price: 98.278,
    current_funding_rate: -0.00039,
    open_interest: 2_110_625.0,
    volume_24h: 595_949_165.0,
    fees_24h: 45_734.29,
    trades_24h: 536_168,
    total_volume_cumulative: 30_253_138_616.0,
    total_fees_cumulative: 1_699_383.0,
    is_halted: false,
    last_update: '2026-05-11T16:53:13.302000',
    ...overrides,
  }
}

function sampleOhlcv(overrides: Partial<OhlcvBar> = {}): OhlcvBar {
  return {
    time: '2026-05-04T17:00:00',
    dex_id: 'xyz',
    coin: 'xyz:CL',
    open: 3080.0,
    high: 59476.0,
    low: 1.1698,
    close: 384.86,
    volume: 0.0,
    fees: 0.0,
    trades: 840,
    ...overrides,
  }
}

function sampleOracle(overrides: Partial<OracleStats1m> = {}): OracleStats1m {
  return {
    bucket: '2026-05-10T16:54:00',
    dex_id: 'xyz',
    asset_id: 0,
    mark_open: 31.0,
    mark_high: 31.0,
    mark_low: 31.0,
    mark_close: 31.0,
    oracle_open: 31.0,
    oracle_high: 31.0,
    oracle_low: 31.0,
    oracle_close: 31.0,
    max_deviation_pct: 0.0,
    avg_funding_rate: 0.0,
    total_oi: 0.0,
    trade_count: 0,
    ...overrides,
  }
}

function sampleHip3Fill(overrides: Partial<Hip3Fill> = {}): Hip3Fill {
  return {
    time: '2026-05-11T16:53:20.000999',
    dex_id: 'xyz',
    coin: 'xyz:XYZ100',
    user: '0x7bca5090f4f7fac412ba6e4b4f92335d1022be2b' as Address,
    side: 'A',
    px: 29297.0,
    sz: 0.0147,
    notional: 430.6659,
    fee: 0.011162,
    builder_fee_usd: 0.011162,
    is_liquidation: 0,
    hash: '0x0000000000000000000000000000000000000000000000000000000000000000',
    tid: 225_494_484_474_858,
    ...overrides,
  }
}

function sampleTrader(overrides: Partial<TraderStats> = {}): TraderStats {
  return {
    dex_id: 'xyz',
    trader: '0xce975678a14f17a15c946b95704744cd7c677e78' as Address,
    coin: 'xyz:CL',
    total_volume: 1_585_751_941.0,
    total_fees: 48_129.22,
    total_trades: 594_928,
    pnl_realized: 7_938_172.37,
    last_update: '2026-05-11T16:50:17.260000',
    ...overrides,
  }
}

function sampleLeaderboard(overrides: Partial<Hip3LeaderboardEntry> = {}): Hip3LeaderboardEntry {
  return {
    trader: '0xce975678a14f17a15c946b95704744cd7c677e78' as Address,
    total_volume: 2_235_550_395.0,
    total_fees: 61_592.07,
    total_trades: 800_215,
    pnl_realized: 8_203_702.47,
    ...overrides,
  }
}

function sampleUserOverview(): UserHip3Overview {
  return {
    trader: VALID_ADDRESS,
    total_volume: 2_232_767_801.6,
    total_fees: 61_510.91,
    total_trades: 799_887,
    pnl_realized: 7_405_486.34,
    coins_traded: 10,
    dexs_traded: 1,
  }
}

function sampleUserCoin(overrides: Partial<UserCoinStats> = {}): UserCoinStats {
  return {
    dex_id: 'xyz',
    coin: 'xyz:CL',
    total_volume: 1_585_751_941.0,
    total_fees: 48_129.22,
    total_trades: 594_928,
    pnl_realized: 7_938_172.37,
    ...overrides,
  }
}

// -----------------------------------------------------------------------------
// overview — bare single
// -----------------------------------------------------------------------------

describe('Hip3Resource.overview', () => {
  it('GETs /hip3/overview and unwraps Single<Hip3Overview> as a bare object', async () => {
    const body = sampleOverview()
    const { http, fetchMock } = buildClient((url) => {
      expect(url.pathname).toBe('/hip3/overview')
      return mockResponse(body)
    })
    const hip3 = new Hip3Resource(http)
    const res = await hip3.overview()
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(res.data).toEqual(body)
    expect(res.meta.family).toBe('bare')
  })
})

// -----------------------------------------------------------------------------
// dexs — list/iterate/get
// -----------------------------------------------------------------------------

describe('Hip3Resource.dexs', () => {
  it('list GETs /hip3/dexs with limit/offset and unwraps bare array', async () => {
    const rows = [sampleDex({ dex_id: 'xyz' }), sampleDex({ dex_id: 'cash' })]
    const { http, fetchMock } = buildClient((url) => {
      expect(url.pathname).toBe('/hip3/dexs')
      expect(url.searchParams.get('limit')).toBe('10')
      expect(url.searchParams.get('offset')).toBe('5')
      return mockResponse(rows)
    })
    const hip3 = new Hip3Resource(http)
    const page = await hip3.dexs.list({ limit: 10, offset: 5 })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(page.data).toEqual(rows)
    expect(page.meta.family).toBe('bare')
  })

  it('list omits unset params from the query string', async () => {
    const { http } = buildClient((url) => {
      expect(url.searchParams.has('limit')).toBe(false)
      expect(url.searchParams.has('offset')).toBe(false)
      return mockResponse([])
    })
    const hip3 = new Hip3Resource(http)
    const page = await hip3.dexs.list()
    expect(page.data).toEqual([])
  })

  it('list throws ValidationError when limit exceeds the 500 cap', async () => {
    const { http, fetchMock } = buildClient(() => mockResponse([]))
    const hip3 = new Hip3Resource(http)
    await expect(hip3.dexs.list({ limit: 501 })).rejects.toBeInstanceOf(ValidationError)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('iterate walks offset pages until a short page is returned', async () => {
    const { http, fetchMock } = buildClient((url) => {
      const offset = Number(url.searchParams.get('offset') ?? '0')
      if (offset === 0) {
        return mockResponse([sampleDex({ dex_id: 'a' }), sampleDex({ dex_id: 'b' })])
      }
      expect(offset).toBe(2)
      // short page (length 1 < limit 2) → iterator stops
      return mockResponse([sampleDex({ dex_id: 'c' })])
    })
    const hip3 = new Hip3Resource(http)
    const ids: string[] = []
    for await (const dex of hip3.dexs.iterate({ limit: 2 })) ids.push(dex.dex_id)
    expect(ids).toEqual(['a', 'b', 'c'])
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('get GETs /hip3/dexs/{dex_id} and unwraps Single<DexRegistry>', async () => {
    const dex = sampleDex({ dex_id: 'xyz' })
    const { http, fetchMock } = buildClient((url) => {
      expect(url.pathname).toBe('/hip3/dexs/xyz')
      return mockResponse(dex)
    })
    const hip3 = new Hip3Resource(http)
    const res = await hip3.dexs.get('xyz')
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(res.data).toEqual(dex)
    expect(res.meta.family).toBe('bare')
  })

  it('get surfaces a 404 {detail: string} as NotFoundError', async () => {
    const { http } = buildClient(
      () =>
        new Response(JSON.stringify({ detail: "DEX 'NOTREAL' not found" }), {
          status: 404,
          headers: { 'content-type': 'application/json' },
        }),
    )
    const hip3 = new Hip3Resource(http)
    await expect(hip3.dexs.get('NOTREAL')).rejects.toBeInstanceOf(NotFoundError)
  })
})

// -----------------------------------------------------------------------------
// assets — list/iterate/get (ticker URL-encoded)
// -----------------------------------------------------------------------------

describe('Hip3Resource.assets', () => {
  it('list GETs /hip3/assets with dex_id/search/limit/offset', async () => {
    const rows = [sampleAsset()]
    const { http, fetchMock } = buildClient((url) => {
      expect(url.pathname).toBe('/hip3/assets')
      expect(url.searchParams.get('dex_id')).toBe('xyz')
      expect(url.searchParams.get('search')).toBe('CL')
      expect(url.searchParams.get('limit')).toBe('50')
      expect(url.searchParams.get('offset')).toBe('100')
      return mockResponse(rows)
    })
    const hip3 = new Hip3Resource(http)
    const page = await hip3.assets.list({ dexId: 'xyz', search: 'CL', limit: 50, offset: 100 })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(page.data).toEqual(rows)
    // bug #6 surfaced in the typed model
    expect(page.data[0]?.asset_id).toBe(0)
  })

  it('list throws ValidationError when limit exceeds the 1000 cap', async () => {
    const { http, fetchMock } = buildClient(() => mockResponse([]))
    const hip3 = new Hip3Resource(http)
    await expect(hip3.assets.list({ limit: 1001 })).rejects.toBeInstanceOf(ValidationError)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('get URL-encodes the ":" in the prefixed ticker', async () => {
    const asset = sampleAsset({ ticker: 'xyz:CL' })
    const { http, fetchMock } = buildClient((url) => {
      // joinPath %3A-encodes ':' so the router does not parse it as scheme
      expect(url.pathname).toBe('/hip3/assets/xyz%3ACL')
      return mockResponse(asset)
    })
    const hip3 = new Hip3Resource(http)
    const res = await hip3.assets.get('xyz:CL')
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(res.data.ticker).toBe('xyz:CL')
  })

  it('get surfaces a 404 {detail: string} as NotFoundError', async () => {
    const { http } = buildClient(
      () =>
        new Response(JSON.stringify({ detail: "Asset 'xyz:NOPE' not found" }), {
          status: 404,
          headers: { 'content-type': 'application/json' },
        }),
    )
    const hip3 = new Hip3Resource(http)
    await expect(hip3.assets.get('xyz:NOPE')).rejects.toBeInstanceOf(NotFoundError)
  })

  it('iterate walks pages until a short one', async () => {
    const { http, fetchMock } = buildClient((url) => {
      const offset = Number(url.searchParams.get('offset') ?? '0')
      if (offset === 0) {
        return mockResponse([sampleAsset({ ticker: 'xyz:A' }), sampleAsset({ ticker: 'xyz:B' })])
      }
      return mockResponse([sampleAsset({ ticker: 'xyz:C' })])
    })
    const hip3 = new Hip3Resource(http)
    const tickers: string[] = []
    for await (const a of hip3.assets.iterate({ limit: 2 })) tickers.push(a.ticker)
    expect(tickers).toEqual(['xyz:A', 'xyz:B', 'xyz:C'])
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })
})

// -----------------------------------------------------------------------------
// auctions — list/iterate/current/history
// -----------------------------------------------------------------------------

describe('Hip3Resource.auctions', () => {
  it('list GETs /hip3/auctions with status/limit/offset', async () => {
    const rows = [sampleAuction()]
    const { http, fetchMock } = buildClient((url) => {
      expect(url.pathname).toBe('/hip3/auctions')
      expect(url.searchParams.get('status')).toBe('open')
      expect(url.searchParams.get('limit')).toBe('20')
      expect(url.searchParams.get('offset')).toBe('0')
      return mockResponse(rows)
    })
    const hip3 = new Hip3Resource(http)
    const page = await hip3.auctions.list({ status: 'open', limit: 20, offset: 0 })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(page.data).toEqual(rows)
  })

  it('list throws ValidationError on a bogus status', async () => {
    const { http, fetchMock } = buildClient(() => mockResponse([]))
    const hip3 = new Hip3Resource(http)
    await expect(
      hip3.auctions.list({ status: 'bogus' as unknown as 'open' }),
    ).rejects.toBeInstanceOf(ValidationError)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('list throws ValidationError when limit exceeds the 200 cap', async () => {
    const { http, fetchMock } = buildClient(() => mockResponse([]))
    const hip3 = new Hip3Resource(http)
    await expect(hip3.auctions.list({ limit: 201 })).rejects.toBeInstanceOf(ValidationError)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('current GETs /hip3/auctions/current and unwraps Single<Auction>', async () => {
    const cur = sampleAuction()
    const { http } = buildClient((url) => {
      expect(url.pathname).toBe('/hip3/auctions/current')
      return mockResponse(cur)
    })
    const hip3 = new Hip3Resource(http)
    const res = await hip3.auctions.current()
    expect(res.data).toEqual(cur)
    expect(res.meta.family).toBe('bare')
  })

  it('history.list GETs /hip3/auctions/history and preserves string auction_id', async () => {
    const rows = [sampleAuctionHistory()]
    const { http, fetchMock } = buildClient((url) => {
      expect(url.pathname).toBe('/hip3/auctions/history')
      expect(url.searchParams.get('dex_id')).toBe('xyz')
      expect(url.searchParams.get('limit')).toBe('100')
      return mockResponse(rows)
    })
    const hip3 = new Hip3Resource(http)
    const page = await hip3.auctions.history.list({ dexId: 'xyz', limit: 100 })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    // schema-divergence: auction_id is a STRING on /history (vs int on /auctions)
    expect(typeof page.data[0]?.auction_id).toBe('string')
  })

  it('history.list throws ValidationError when limit exceeds the 500 cap', async () => {
    const { http, fetchMock } = buildClient(() => mockResponse([]))
    const hip3 = new Hip3Resource(http)
    await expect(hip3.auctions.history.list({ limit: 501 })).rejects.toBeInstanceOf(ValidationError)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('history.iterate walks pages until a short one', async () => {
    const { http, fetchMock } = buildClient((url) => {
      const offset = Number(url.searchParams.get('offset') ?? '0')
      if (offset === 0) {
        return mockResponse([
          sampleAuctionHistory({ auction_id: '1' }),
          sampleAuctionHistory({ auction_id: '2' }),
        ])
      }
      return mockResponse([sampleAuctionHistory({ auction_id: '3' })])
    })
    const hip3 = new Hip3Resource(http)
    const ids: string[] = []
    for await (const a of hip3.auctions.history.iterate({ limit: 2 })) ids.push(a.auction_id)
    expect(ids).toEqual(['1', '2', '3'])
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })
})

// -----------------------------------------------------------------------------
// snapshots / topMovers (none-list, same row shape)
// -----------------------------------------------------------------------------

describe('Hip3Resource.snapshots', () => {
  it('GETs /hip3/snapshots without params', async () => {
    const rows = [sampleSnapshot()]
    const { http, fetchMock } = buildClient((url) => {
      expect(url.pathname).toBe('/hip3/snapshots')
      expect(url.searchParams.has('dex_id')).toBe(false)
      expect(url.searchParams.has('coin')).toBe(false)
      return mockResponse(rows)
    })
    const hip3 = new Hip3Resource(http)
    const page = await hip3.snapshots()
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(page.data).toEqual(rows)
    expect(page.meta.family).toBe('bare')
  })

  it('forwards dex_id and coin filters', async () => {
    const { http } = buildClient((url) => {
      expect(url.searchParams.get('dex_id')).toBe('xyz')
      expect(url.searchParams.get('coin')).toBe('xyz:CL')
      return mockResponse([])
    })
    const hip3 = new Hip3Resource(http)
    await hip3.snapshots({ dexId: 'xyz', coin: 'xyz:CL' })
  })
})

describe('Hip3Resource.topMovers', () => {
  it('GETs /hip3/top-movers with limit and unwraps bare array', async () => {
    const rows = [sampleSnapshot()]
    const { http, fetchMock } = buildClient((url) => {
      expect(url.pathname).toBe('/hip3/top-movers')
      expect(url.searchParams.get('limit')).toBe('10')
      return mockResponse(rows)
    })
    const hip3 = new Hip3Resource(http)
    const page = await hip3.topMovers({ limit: 10 })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(page.data).toEqual(rows)
  })

  it('throws ValidationError when limit exceeds the 100 cap', async () => {
    const { http, fetchMock } = buildClient(() => mockResponse([]))
    const hip3 = new Hip3Resource(http)
    await expect(hip3.topMovers({ limit: 101 })).rejects.toBeInstanceOf(ValidationError)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

// -----------------------------------------------------------------------------
// ohlcv (required coin, iso-bare time, bug #7 doc)
// -----------------------------------------------------------------------------

describe('Hip3Resource.ohlcv', () => {
  it('GETs /hip3/ohlcv with required coin and iso-bare start/end window', async () => {
    const rows = [sampleOhlcv()]
    const { http, fetchMock } = buildClient((url) => {
      expect(url.pathname).toBe('/hip3/ohlcv')
      expect(url.searchParams.get('coin')).toBe('xyz:CL')
      expect(url.searchParams.get('dex_id')).toBe('xyz')
      expect(url.searchParams.get('limit')).toBe('168')
      // iso-bare encodes Date|number|string as YYYY-MM-DD on the wire
      expect(url.searchParams.get('start')).toBe('2026-05-04')
      expect(url.searchParams.get('end')).toBe('2026-05-11')
      return mockResponse(rows)
    })
    const hip3 = new Hip3Resource(http)
    const page = await hip3.ohlcv({
      coin: 'xyz:CL',
      dexId: 'xyz',
      startTime: '2026-05-04T17:00:00Z',
      endTime: new Date('2026-05-11T00:00:00Z'),
      limit: 168,
    })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(page.data).toEqual(rows)
    // bug #7 surfaces as 0 in the typed model — documented in JSDoc
    expect(page.data[0]?.volume).toBe(0)
    expect(page.data[0]?.fees).toBe(0)
  })

  it('throws ValidationError when limit exceeds the 2000 cap', async () => {
    const { http, fetchMock } = buildClient(() => mockResponse([]))
    const hip3 = new Hip3Resource(http)
    await expect(hip3.ohlcv({ coin: 'xyz:CL', limit: 2001 })).rejects.toBeInstanceOf(
      ValidationError,
    )
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

// -----------------------------------------------------------------------------
// oracleStats (required dex_id, asset_id filter useless per bug #6)
// -----------------------------------------------------------------------------

describe('Hip3Resource.oracleStats', () => {
  it('GETs /hip3/oracle/stats with required dex_id and optional filters', async () => {
    const rows = [sampleOracle()]
    const { http, fetchMock } = buildClient((url) => {
      expect(url.pathname).toBe('/hip3/oracle/stats')
      expect(url.searchParams.get('dex_id')).toBe('xyz')
      expect(url.searchParams.get('asset_id')).toBe('0')
      expect(url.searchParams.get('limit')).toBe('100')
      return mockResponse(rows)
    })
    const hip3 = new Hip3Resource(http)
    const page = await hip3.oracleStats({ dexId: 'xyz', assetId: 0, limit: 100 })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(page.data).toEqual(rows)
  })

  it('throws ValidationError when limit exceeds the 10000 cap', async () => {
    const { http, fetchMock } = buildClient(() => mockResponse([]))
    const hip3 = new Hip3Resource(http)
    await expect(hip3.oracleStats({ dexId: 'xyz', limit: 10_001 })).rejects.toBeInstanceOf(
      ValidationError,
    )
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

// -----------------------------------------------------------------------------
// fills — list/iterate, offset pagination, side enum, address validation
// -----------------------------------------------------------------------------

describe('Hip3Resource.fills', () => {
  it('list GETs /hip3/fills with typed filters', async () => {
    const rows = [sampleHip3Fill()]
    const { http, fetchMock } = buildClient((url) => {
      expect(url.pathname).toBe('/hip3/fills')
      expect(url.searchParams.get('dex_id')).toBe('xyz')
      expect(url.searchParams.get('coin')).toBe('xyz:XYZ100')
      expect(url.searchParams.get('user')).toBe(VALID_ADDRESS)
      expect(url.searchParams.get('side')).toBe('A')
      expect(url.searchParams.get('min_notional')).toBe('100')
      expect(url.searchParams.get('limit')).toBe('50')
      expect(url.searchParams.get('offset')).toBe('0')
      expect(url.searchParams.get('start')).toBe('2026-05-11')
      expect(url.searchParams.get('end')).toBe('2026-05-12')
      return mockResponse(rows)
    })
    const hip3 = new Hip3Resource(http)
    const page = await hip3.fills.list({
      dexId: 'xyz',
      coin: 'xyz:XYZ100',
      user: VALID_ADDRESS,
      side: 'A',
      minNotional: 100,
      startTime: '2026-05-11T00:00:00Z',
      endTime: '2026-05-12T00:00:00Z',
      limit: 50,
      offset: 0,
    })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(page.data).toEqual(rows)
  })

  it('list throws ValidationError on a bogus side value', async () => {
    const { http, fetchMock } = buildClient(() => mockResponse([]))
    const hip3 = new Hip3Resource(http)
    await expect(hip3.fills.list({ side: 'X' as unknown as 'A' })).rejects.toBeInstanceOf(
      ValidationError,
    )
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('list throws ValidationError on a malformed user address', async () => {
    const { http, fetchMock } = buildClient(() => mockResponse([]))
    const hip3 = new Hip3Resource(http)
    await expect(
      hip3.fills.list({ user: BAD_ADDRESS as unknown as Address }),
    ).rejects.toBeInstanceOf(ValidationError)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('iterate walks offset pages until a short page', async () => {
    const { http, fetchMock } = buildClient((url) => {
      const offset = Number(url.searchParams.get('offset') ?? '0')
      if (offset === 0) {
        return mockResponse([sampleHip3Fill({ tid: 1 }), sampleHip3Fill({ tid: 2 })])
      }
      expect(offset).toBe(2)
      return mockResponse([sampleHip3Fill({ tid: 3 })])
    })
    const hip3 = new Hip3Resource(http)
    const tids: number[] = []
    for await (const f of hip3.fills.iterate({ limit: 2 })) tids.push(f.tid)
    expect(tids).toEqual([1, 2, 3])
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('iterate refuses a malformed user address synchronously', async () => {
    const { http, fetchMock } = buildClient(() => mockResponse([]))
    const hip3 = new Hip3Resource(http)
    expect(() => hip3.fills.iterate({ user: BAD_ADDRESS as unknown as Address })).toThrow(
      ValidationError,
    )
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

// -----------------------------------------------------------------------------
// stats.traders
// -----------------------------------------------------------------------------

describe('Hip3Resource.stats.traders', () => {
  it('GETs /hip3/stats/traders with filters', async () => {
    const rows = [sampleTrader()]
    const { http, fetchMock } = buildClient((url) => {
      expect(url.pathname).toBe('/hip3/stats/traders')
      expect(url.searchParams.get('dex_id')).toBe('xyz')
      expect(url.searchParams.get('coin')).toBe('xyz:CL')
      expect(url.searchParams.get('limit')).toBe('50')
      expect(url.searchParams.get('offset')).toBe('100')
      return mockResponse(rows)
    })
    const hip3 = new Hip3Resource(http)
    const page = await hip3.stats.traders({
      dexId: 'xyz',
      coin: 'xyz:CL',
      limit: 50,
      offset: 100,
    })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(page.data).toEqual(rows)
  })

  it('throws ValidationError when limit exceeds the 500 cap', async () => {
    const { http, fetchMock } = buildClient(() => mockResponse([]))
    const hip3 = new Hip3Resource(http)
    await expect(hip3.stats.traders({ limit: 501 })).rejects.toBeInstanceOf(ValidationError)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

// -----------------------------------------------------------------------------
// leaderboard — required `by`, enum validation (bug #5)
// -----------------------------------------------------------------------------

describe('Hip3Resource.leaderboard', () => {
  it('GETs /hip3/leaderboard with required by and optional dex_id/limit', async () => {
    const rows = [sampleLeaderboard()]
    const { http, fetchMock } = buildClient((url) => {
      expect(url.pathname).toBe('/hip3/leaderboard')
      expect(url.searchParams.get('by')).toBe('volume')
      expect(url.searchParams.get('dex_id')).toBe('xyz')
      expect(url.searchParams.get('limit')).toBe('25')
      return mockResponse(rows)
    })
    const hip3 = new Hip3Resource(http)
    const page = await hip3.leaderboard({ by: 'volume', dexId: 'xyz', limit: 25 })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(page.data).toEqual(rows)
  })

  it('throws ValidationError on a bogus `by` (bug #5) without making a request', async () => {
    const { http, fetchMock } = buildClient(() => mockResponse([]))
    const hip3 = new Hip3Resource(http)
    await expect(hip3.leaderboard({ by: 'bogus' as unknown as 'volume' })).rejects.toBeInstanceOf(
      ValidationError,
    )
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('throws ValidationError when limit exceeds the 200 cap', async () => {
    const { http, fetchMock } = buildClient(() => mockResponse([]))
    const hip3 = new Hip3Resource(http)
    await expect(hip3.leaderboard({ by: 'volume', limit: 201 })).rejects.toBeInstanceOf(
      ValidationError,
    )
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

// -----------------------------------------------------------------------------
// user(address).{overview,fills,coins}
// -----------------------------------------------------------------------------

describe('Hip3Resource.user', () => {
  it('rejects a malformed address before constructing the sub-resource', () => {
    const { http, fetchMock } = buildClient(() => mockResponse({}))
    const hip3 = new Hip3Resource(http)
    expect(() => hip3.user(BAD_ADDRESS)).toThrow(ValidationError)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('overview GETs /hip3/users/{address}/overview', async () => {
    const body = sampleUserOverview()
    const { http, fetchMock } = buildClient((url) => {
      expect(url.pathname).toBe(`/hip3/users/${VALID_ADDRESS}/overview`)
      return mockResponse(body)
    })
    const hip3 = new Hip3Resource(http)
    const res = await hip3.user(VALID_ADDRESS).overview()
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(res.data).toEqual(body)
    expect(res.meta.family).toBe('bare')
  })

  it('fills GETs /hip3/users/{address}/fills with offset + iso-bare time window', async () => {
    const rows = [sampleHip3Fill({ user: VALID_ADDRESS })]
    const { http, fetchMock } = buildClient((url) => {
      expect(url.pathname).toBe(`/hip3/users/${VALID_ADDRESS}/fills`)
      expect(url.searchParams.get('coin')).toBe('xyz:CL')
      expect(url.searchParams.get('dex_id')).toBe('xyz')
      expect(url.searchParams.get('limit')).toBe('10')
      expect(url.searchParams.get('offset')).toBe('0')
      expect(url.searchParams.get('start')).toBe('2026-05-11')
      expect(url.searchParams.get('end')).toBe('2026-05-12')
      return mockResponse(rows)
    })
    const hip3 = new Hip3Resource(http)
    const page = await hip3.user(VALID_ADDRESS).fills({
      coin: 'xyz:CL',
      dexId: 'xyz',
      startTime: '2026-05-11T00:00:00Z',
      endTime: '2026-05-12T00:00:00Z',
      limit: 10,
      offset: 0,
    })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(page.data).toEqual(rows)
  })

  it('coins GETs /hip3/users/{address}/coins with limit cap 100', async () => {
    const rows = [sampleUserCoin()]
    const { http, fetchMock } = buildClient((url) => {
      expect(url.pathname).toBe(`/hip3/users/${VALID_ADDRESS}/coins`)
      expect(url.searchParams.get('limit')).toBe('50')
      return mockResponse(rows)
    })
    const hip3 = new Hip3Resource(http)
    const page = await hip3.user(VALID_ADDRESS).coins({ limit: 50 })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(page.data).toEqual(rows)
  })

  it('coins throws ValidationError when limit exceeds the 100 cap', async () => {
    const { http, fetchMock } = buildClient(() => mockResponse([]))
    const hip3 = new Hip3Resource(http)
    await expect(hip3.user(VALID_ADDRESS).coins({ limit: 101 })).rejects.toBeInstanceOf(
      ValidationError,
    )
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
