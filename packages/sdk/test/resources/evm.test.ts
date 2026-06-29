import { describe, expect, it, vi } from 'vitest'
import { NotFoundError, ValidationError } from '../../src/errors/index.js'
import { EvmResource } from '../../src/resources/evm.js'
import { HttpClient } from '../../src/transport/HttpClient.js'
import { toBigInt } from '../../src/transport/numbers.js'
import type { Address, Wei } from '../../src/types/common.js'
import type {
  EvmBackstopFill,
  EvmBackstopHealth,
  EvmBlock,
  EvmBridgeEvent,
  EvmDailyStat,
  EvmLedgerTransfer,
  EvmLog,
  EvmStats,
  EvmTransaction,
  EvmUserLedgerEvent,
  EvmUserLedgerSummaryRow,
} from '../../src/types/evm.js'

// -----------------------------------------------------------------------------
// Test harness — fetch stub + sample row factories.
// -----------------------------------------------------------------------------

const VALID_ADDRESS = '0xce975678a14f17a15c946b95704744cd7c677e78' as Address
const BAD_ADDRESS = '0xnot-an-address'
const TO_ADDR = '0x88806a71d74ad0a510b350545c9ae490912f0888' as Address

function mockResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

function apiResponse<T>(data: T, extras: Record<string, unknown> = {}): unknown {
  return {
    success: true,
    data,
    message: null,
    next_cursor: null,
    has_more: false,
    total_count: null,
    execution_time_ms: 12,
    ...extras,
  }
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

function sampleStats(): EvmStats {
  return {
    total_blocks: 34_849_600,
    total_transactions: 540_192_011,
    total_logs: 1_204_817_001,
    first_block: 1,
    last_block: 34_849_600,
    first_block_time: '2024-12-29T17:00:00',
    last_block_time: '2026-05-11T21:02:30',
  }
}

function sampleDailyStat(overrides: Partial<EvmDailyStat> = {}): EvmDailyStat {
  return {
    day: '2026-05-11',
    blocks: 86_400,
    transactions: 1_320_000,
    system_txs: 12,
    gas_used: 91_000_000_000,
    ...overrides,
  }
}

function sampleBlock(overrides: Partial<EvmBlock> = {}): EvmBlock {
  return {
    block_time: '2026-05-11T21:02:30',
    block_number: 34_849_600,
    block_hash: `0x${'ab'.repeat(32)}`,
    parent_hash: `0x${'cd'.repeat(32)}`,
    gas_limit: 30_000_000,
    gas_used: 21_000,
    base_fee_per_gas: 7,
    tx_count: 1,
    system_tx_count: 0,
    ...overrides,
  }
}

/** Raw wire shape — `success`/`is_system_tx` are wire ints `0|1`, no `tx_key`. */
interface RawWireTx {
  block_time: string
  block_number: number
  tx_index: number
  tx_hash: string
  tx_type: string
  from_addr: string
  to_addr: string
  value_wei: string
  gas_limit: number
  gas_used: number
  success: number
  input_len: number
  is_system_tx: number
}

function sampleWireTx(overrides: Partial<RawWireTx> = {}): RawWireTx {
  return {
    block_time: '2026-05-11T21:02:30',
    block_number: 34_849_600,
    tx_index: 0,
    tx_hash: '', // PLAN.md §I bug #10 — empty in every observed row
    tx_type: 'Eip1559',
    from_addr: '', // PLAN.md §I bug #10
    to_addr: TO_ADDR,
    value_wei: '1000000000000000000',
    gas_limit: 21_000,
    gas_used: 21_000,
    success: 1,
    input_len: 0,
    is_system_tx: 0,
    ...overrides,
  }
}

function sampleLog(overrides: Partial<EvmLog> = {}): EvmLog {
  return {
    block_time: '2026-05-11T21:02:30',
    block_number: 34_849_600,
    tx_index: 0,
    log_index: 0,
    address: TO_ADDR,
    topic0: `0x${'aa'.repeat(32)}`,
    topic1: '',
    topic2: '',
    topic3: '',
    data: '0xabcdef',
    ...overrides,
  }
}

function sampleLedgerTransfer(overrides: Partial<EvmLedgerTransfer> = {}): EvmLedgerTransfer {
  return {
    time: '2026-05-11T21:38:40.088000',
    block_height: 0,
    tx_hash: `0x${'11'.repeat(32)}`,
    action_type: 'usdSend',
    user_from: VALID_ADDRESS,
    user_to: TO_ADDR,
    token: 'USDC',
    amount_raw: '12345678' as Wei,
    amount: 12.345678,
    source_dex: null,
    destination_dex: null,
    ...overrides,
  }
}

function sampleBridgeEvent(overrides: Partial<EvmBridgeEvent> = {}): EvmBridgeEvent {
  return {
    time: '2026-05-11T21:38:40.088000',
    block_height: 0,
    event_type: 'withdrawal_finalized',
    user_addr: VALID_ADDRESS,
    validator: TO_ADDR,
    amount: 100.5,
    destination: '0xabcdef',
    nonce: 1_778_535_277_015_000,
    raw: '{"type":"withdrawal_finalized"}',
    ...overrides,
  }
}

function sampleUserLedgerEvent(overrides: Partial<EvmUserLedgerEvent> = {}): EvmUserLedgerEvent {
  return {
    time: '2026-05-11T21:38:40.088000',
    event_type: 'deposit',
    counterparty: TO_ADDR,
    token: 'USDC',
    amount: 100.0,
    amount_raw: '100000000' as Wei,
    tx_hash: `0x${'22'.repeat(32)}`,
    source_dex: null,
    destination_dex: null,
    ...overrides,
  }
}

function sampleSummaryRow(
  overrides: Partial<EvmUserLedgerSummaryRow> = {},
): EvmUserLedgerSummaryRow {
  return {
    action_type: 'deposit',
    count: 5,
    total_amount: 500,
    tokens: ['USDC', 'HYPE'],
    ...overrides,
  }
}

function sampleBackstopHealth(overrides: Partial<EvmBackstopHealth> = {}): EvmBackstopHealth {
  return {
    dex_id: 'km',
    backstop_address: '0x4000000000000000000000000000000000000001' as Address,
    dex_index: 1,
    principal_deposited_usdc: 0,
    principal_withdrawn_usdc: 0,
    net_principal_usdc: 0,
    fill_count: 100,
    notional_traded: 1_000_000,
    fees_paid: 100.0,
    fills_last_24h: 5,
    last_fill_time: '2026-05-11T21:38:40.088000',
    coins_active: 3,
    first_fill_time: '2026-05-01T10:00:00.000000',
    ...overrides,
  }
}

/** Raw wire shape — `is_liquidation` is wire int `0|1`. */
interface RawWireBackstopFill {
  time: string
  dex_id: string
  coin: string
  side: 'A' | 'B'
  px: number
  sz: number
  notional: number
  fee: number
  is_liquidation: number
  hash: string
}

function sampleWireBackstopFill(overrides: Partial<RawWireBackstopFill> = {}): RawWireBackstopFill {
  return {
    time: '2026-05-11T21:38:40.088000',
    dex_id: 'km',
    coin: 'km:SMALL2000',
    side: 'B',
    px: 100.0,
    sz: 1.0,
    notional: 100.0,
    fee: 0.05,
    is_liquidation: 0,
    hash: `0x${'33'.repeat(32)}`,
    ...overrides,
  }
}

// -----------------------------------------------------------------------------
// stats — get + daily
// -----------------------------------------------------------------------------

describe('EvmResource.stats', () => {
  it('get GETs /evm/stats and unwraps Single<EvmStats>', async () => {
    const stats = sampleStats()
    const { http, fetchMock } = buildClient((url) => {
      expect(url.pathname).toBe('/evm/stats')
      return mockResponse(apiResponse(stats))
    })
    const evm = new EvmResource(http)
    const res = await evm.stats.get()
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(res.data).toEqual(stats)
    expect(res.meta.family).toBe('apiResponse')
  })

  it('daily GETs /evm/stats/daily with days param', async () => {
    const row = sampleDailyStat()
    const { http, fetchMock } = buildClient((url) => {
      expect(url.pathname).toBe('/evm/stats/daily')
      expect(url.searchParams.get('days')).toBe('30')
      return mockResponse(apiResponse([row]))
    })
    const evm = new EvmResource(http)
    const page = await evm.stats.daily({ days: 30 })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(page.data).toEqual([row])
  })

  it('daily throws ValidationError when days exceeds the 365 cap', async () => {
    const { http, fetchMock } = buildClient(() => mockResponse(apiResponse([])))
    const evm = new EvmResource(http)
    await expect(evm.stats.daily({ days: 366 })).rejects.toBeInstanceOf(ValidationError)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

// -----------------------------------------------------------------------------
// blocks — list, iterate, get, transactions
// -----------------------------------------------------------------------------

describe('EvmResource.blocks', () => {
  it('list GETs /evm/blocks with start_block/end_block/ISO time params', async () => {
    const block = sampleBlock()
    const { http, fetchMock } = buildClient((url) => {
      expect(url.pathname).toBe('/evm/blocks')
      expect(url.searchParams.get('start_block')).toBe('34849600')
      expect(url.searchParams.get('end_block')).toBe('34849610')
      expect(url.searchParams.get('limit')).toBe('100')
      // PLAN.md §I bug #21 defense: epoch ms input is encoded as ISO `Z`.
      expect(url.searchParams.get('start_time')).toBe('2026-05-01T00:00:00.000Z')
      expect(url.searchParams.get('end_time')).toBe('2026-05-11T00:00:00.000Z')
      return mockResponse(apiResponse([block]))
    })
    const evm = new EvmResource(http)
    const page = await evm.blocks.list({
      startBlock: 34_849_600,
      endBlock: 34_849_610,
      startTime: '2026-05-01T00:00:00Z',
      endTime: new Date('2026-05-11T00:00:00Z'),
      limit: 100,
    })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(page.data).toEqual([block])
  })

  it('list throws ValidationError when limit exceeds the 1000 cap', async () => {
    const { http, fetchMock } = buildClient(() => mockResponse(apiResponse([])))
    const evm = new EvmResource(http)
    await expect(evm.blocks.list({ limit: 1001 })).rejects.toBeInstanceOf(ValidationError)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('iterate walks offset pages until a short page is returned', async () => {
    const { http, fetchMock } = buildClient((url) => {
      const offset = Number(url.searchParams.get('offset') ?? '0')
      if (offset === 0) {
        return mockResponse(
          apiResponse([sampleBlock({ block_number: 1 }), sampleBlock({ block_number: 2 })]),
        )
      }
      expect(offset).toBe(2)
      return mockResponse(apiResponse([sampleBlock({ block_number: 3 })]))
    })
    const evm = new EvmResource(http)
    const nums: number[] = []
    for await (const b of evm.blocks.iterate({ limit: 2 })) nums.push(b.block_number)
    expect(nums).toEqual([1, 2, 3])
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('get GETs /evm/blocks/{block_number} and unwraps Single<EvmBlock>', async () => {
    const block = sampleBlock({ block_number: 34_849_600 })
    const { http, fetchMock } = buildClient((url) => {
      expect(url.pathname).toBe('/evm/blocks/34849600')
      return mockResponse(apiResponse(block))
    })
    const evm = new EvmResource(http)
    const res = await evm.blocks.get(34_849_600)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(res.data).toEqual(block)
  })

  it('get surfaces a 404 {detail: string} as NotFoundError', async () => {
    const { http } = buildClient(
      () =>
        new Response(JSON.stringify({ detail: 'Block 999 not found' }), {
          status: 404,
          headers: { 'content-type': 'application/json' },
        }),
    )
    const evm = new EvmResource(http)
    await expect(evm.blocks.get(999)).rejects.toBeInstanceOf(NotFoundError)
  })

  it('transactions GETs the per-block transactions list with synthesized tx_key', async () => {
    const wire = sampleWireTx({ block_number: 34_849_600, tx_index: 7 })
    const { http, fetchMock } = buildClient((url) => {
      expect(url.pathname).toBe('/evm/blocks/34849600/transactions')
      expect(url.searchParams.get('limit')).toBe('50')
      return mockResponse(apiResponse([wire]))
    })
    const evm = new EvmResource(http)
    const page = await evm.blocks.transactions(34_849_600, { limit: 50 })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    // PLAN.md §I bug #10 — tx_key is synthesized from block_number:tx_index.
    expect(page.data[0]?.tx_key).toBe('34849600:7')
    expect(page.data[0]?.tx_hash).toBe('')
    expect(page.data[0]?.from_addr).toBe('')
    // PLAN.md §F.4 — booleans coerced from wire 0/1.
    expect(page.data[0]?.success).toBe(true)
    expect(page.data[0]?.is_system_tx).toBe(false)
  })
})

// -----------------------------------------------------------------------------
// transactions — list/iterate (epoch-ms → ISO encoding, tx_key, F.4 booleans)
// -----------------------------------------------------------------------------

describe('EvmResource.transactions', () => {
  it('list GETs /evm/transactions and synthesizes tx_key + coerces booleans', async () => {
    const wire = sampleWireTx({
      block_number: 100,
      tx_index: 42,
      success: 0,
      is_system_tx: 1,
    })
    const { http, fetchMock } = buildClient((url) => {
      expect(url.pathname).toBe('/evm/transactions')
      expect(url.searchParams.get('to_addr')).toBe(TO_ADDR)
      expect(url.searchParams.get('block_number')).toBe('100')
      expect(url.searchParams.get('include_system')).toBe('false')
      expect(url.searchParams.get('limit')).toBe('25')
      return mockResponse(apiResponse([wire]))
    })
    const evm = new EvmResource(http)
    const page = await evm.transactions.list({
      toAddr: TO_ADDR,
      blockNumber: 100,
      includeSystem: false,
      limit: 25,
    })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(page.data).toHaveLength(1)
    const row = page.data[0] as EvmTransaction
    expect(row.tx_key).toBe('100:42')
    expect(row.success).toBe(false)
    expect(row.is_system_tx).toBe(true)
    // PLAN.md §F.2 — value_wei is a Wei string; round-trip via toBigInt.
    expect(typeof row.value_wei).toBe('string')
    expect(toBigInt(row.value_wei)).toBe(1_000_000_000_000_000_000n)
  })

  it('list encodes epoch_ms inputs as ISO Z (PLAN.md §I bug #21 defense)', async () => {
    const { http, fetchMock } = buildClient((url) => {
      expect(url.searchParams.get('start_time')).toBe('2026-05-01T00:00:00.000Z')
      expect(url.searchParams.get('end_time')).toBe('2026-05-11T00:00:00.000Z')
      // epoch_ms must not leak to the wire.
      expect(url.searchParams.has('epoch_ms')).toBe(false)
      return mockResponse(apiResponse([]))
    })
    const evm = new EvmResource(http)
    await evm.transactions.list({
      startTime: Date.parse('2026-05-01T00:00:00Z'),
      endTime: Date.parse('2026-05-11T00:00:00Z'),
    })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('list throws ValidationError when limit exceeds the 1000 cap', async () => {
    const { http, fetchMock } = buildClient(() => mockResponse(apiResponse([])))
    const evm = new EvmResource(http)
    await expect(evm.transactions.list({ limit: 1001 })).rejects.toBeInstanceOf(ValidationError)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('iterate walks offset pages and yields normalized rows', async () => {
    const { http, fetchMock } = buildClient((url) => {
      const offset = Number(url.searchParams.get('offset') ?? '0')
      if (offset === 0) {
        return mockResponse(
          apiResponse([
            sampleWireTx({ block_number: 1, tx_index: 0 }),
            sampleWireTx({ block_number: 1, tx_index: 1 }),
          ]),
        )
      }
      expect(offset).toBe(2)
      return mockResponse(apiResponse([sampleWireTx({ block_number: 2, tx_index: 0 })]))
    })
    const evm = new EvmResource(http)
    const keys: string[] = []
    for await (const t of evm.transactions.iterate({ limit: 2 })) keys.push(t.tx_key)
    expect(keys).toEqual(['1:0', '1:1', '2:0'])
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })
})

// -----------------------------------------------------------------------------
// logs — list/iterate
// -----------------------------------------------------------------------------

describe('EvmResource.logs', () => {
  it('list GETs /evm/logs with address/topic0/block_number filters', async () => {
    const log = sampleLog()
    const { http, fetchMock } = buildClient((url) => {
      expect(url.pathname).toBe('/evm/logs')
      expect(url.searchParams.get('address')).toBe(TO_ADDR)
      expect(url.searchParams.get('topic0')).toBe(log.topic0)
      expect(url.searchParams.get('block_number')).toBe('100')
      return mockResponse(apiResponse([log]))
    })
    const evm = new EvmResource(http)
    const page = await evm.logs.list({ address: TO_ADDR, topic0: log.topic0, blockNumber: 100 })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(page.data[0]?.topic1).toBe('')
  })

  it('list throws ValidationError when limit exceeds the 1000 cap', async () => {
    const { http, fetchMock } = buildClient(() => mockResponse(apiResponse([])))
    const evm = new EvmResource(http)
    await expect(evm.logs.list({ limit: 1001 })).rejects.toBeInstanceOf(ValidationError)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

// -----------------------------------------------------------------------------
// transfers — list/iterate (action_type silent-fallback defense, Wei field)
// -----------------------------------------------------------------------------

describe('EvmResource.transfers', () => {
  it('list GETs /evm/ledger/transfers with action_type/token/user filters', async () => {
    const row = sampleLedgerTransfer()
    const { http, fetchMock } = buildClient((url) => {
      expect(url.pathname).toBe('/evm/ledger/transfers')
      expect(url.searchParams.get('action_type')).toBe('usdSend')
      expect(url.searchParams.get('token')).toBe('USDC')
      expect(url.searchParams.get('user')).toBe(VALID_ADDRESS)
      return mockResponse(apiResponse([row]))
    })
    const evm = new EvmResource(http)
    const page = await evm.transfers.list({
      actionType: 'usdSend',
      token: 'USDC',
      user: VALID_ADDRESS,
    })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    // PLAN.md §F.2 — amount_raw is a Wei string; survives round-trip via toBigInt.
    expect(page.data).toHaveLength(1)
    const out = page.data[0] as EvmLedgerTransfer
    expect(typeof out.amount_raw).toBe('string')
    expect(toBigInt(out.amount_raw)).toBe(12_345_678n)
  })

  it('list throws ValidationError on bogus action_type without making a fetch (bug #5)', async () => {
    const { http, fetchMock } = buildClient(() => mockResponse(apiResponse([])))
    const evm = new EvmResource(http)
    await expect(
      evm.transfers.list({ actionType: 'bogus' as unknown as 'usdSend' }),
    ).rejects.toBeInstanceOf(ValidationError)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('list throws ValidationError on a bad user address without fetching', async () => {
    const { http, fetchMock } = buildClient(() => mockResponse(apiResponse([])))
    const evm = new EvmResource(http)
    await expect(evm.transfers.list({ user: BAD_ADDRESS })).rejects.toBeInstanceOf(ValidationError)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

// -----------------------------------------------------------------------------
// bridge.events — list/iterate (event_type silent-fallback defense)
// -----------------------------------------------------------------------------

describe('EvmResource.bridge.events', () => {
  it('list GETs /evm/bridge/events with event_type filter', async () => {
    const row = sampleBridgeEvent()
    const { http, fetchMock } = buildClient((url) => {
      expect(url.pathname).toBe('/evm/bridge/events')
      expect(url.searchParams.get('event_type')).toBe('withdrawal_finalized')
      return mockResponse(apiResponse([row]))
    })
    const evm = new EvmResource(http)
    const page = await evm.bridge.events.list({ eventType: 'withdrawal_finalized' })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(page.data).toEqual([row])
  })

  it('list throws ValidationError on bogus event_type without making a fetch (bug #5)', async () => {
    const { http, fetchMock } = buildClient(() => mockResponse(apiResponse([])))
    const evm = new EvmResource(http)
    await expect(
      evm.bridge.events.list({
        eventType: 'bogus' as unknown as 'withdrawal_finalized',
      }),
    ).rejects.toBeInstanceOf(ValidationError)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

// -----------------------------------------------------------------------------
// user(address) — address validation, ledger.events, overview (ledger-summary)
// -----------------------------------------------------------------------------

describe('EvmResource.user', () => {
  it('user(address) throws ValidationError synchronously on a bad address', async () => {
    const { http, fetchMock } = buildClient(() => mockResponse(apiResponse([])))
    const evm = new EvmResource(http)
    expect(() => evm.user(BAD_ADDRESS)).toThrow(ValidationError)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('user(addr).overview GETs /evm/user/{address}/ledger-summary', async () => {
    const row = sampleSummaryRow()
    const { http, fetchMock } = buildClient((url) => {
      expect(url.pathname).toBe(`/evm/user/${VALID_ADDRESS}/ledger-summary`)
      return mockResponse(apiResponse([row]))
    })
    const evm = new EvmResource(http)
    const page = await evm.user(VALID_ADDRESS).overview()
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(page.data).toEqual([row])
  })

  it('user(addr).ledger.events.list GETs /evm/user/{address}/ledger-events with event_type', async () => {
    const row = sampleUserLedgerEvent()
    const { http, fetchMock } = buildClient((url) => {
      expect(url.pathname).toBe(`/evm/user/${VALID_ADDRESS}/ledger-events`)
      expect(url.searchParams.get('event_type')).toBe('deposit')
      return mockResponse(apiResponse([row]))
    })
    const evm = new EvmResource(http)
    const page = await evm.user(VALID_ADDRESS).ledger.events.list({ eventType: 'deposit' })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    // PLAN.md §F.2 — amount_raw is Wei string.
    expect(page.data).toHaveLength(1)
    const out = page.data[0] as EvmUserLedgerEvent
    expect(typeof out.amount_raw).toBe('string')
    expect(toBigInt(out.amount_raw)).toBe(100_000_000n)
  })

  it('user(addr).ledger.events.list throws ValidationError on bogus event_type', async () => {
    const { http, fetchMock } = buildClient(() => mockResponse(apiResponse([])))
    const evm = new EvmResource(http)
    await expect(
      evm.user(VALID_ADDRESS).ledger.events.list({ eventType: 'bogus' as unknown as 'deposit' }),
    ).rejects.toBeInstanceOf(ValidationError)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

// -----------------------------------------------------------------------------
// hip3.backstop — health.list/get, transfers.list/summary, fills(dex).list
// -----------------------------------------------------------------------------

describe('EvmResource.hip3.backstop', () => {
  it('health.list GETs /evm/hip3/backstop/health', async () => {
    const row = sampleBackstopHealth()
    const { http, fetchMock } = buildClient((url) => {
      expect(url.pathname).toBe('/evm/hip3/backstop/health')
      return mockResponse(apiResponse([row]))
    })
    const evm = new EvmResource(http)
    const page = await evm.hip3.backstop.health.list()
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(page.data).toEqual([row])
  })

  it('health.get GETs /evm/hip3/backstop/{dex}/health', async () => {
    const row = sampleBackstopHealth({ dex_id: 'km' })
    const { http, fetchMock } = buildClient((url) => {
      expect(url.pathname).toBe('/evm/hip3/backstop/km/health')
      return mockResponse(apiResponse(row))
    })
    const evm = new EvmResource(http)
    const res = await evm.hip3.backstop.health.get('km')
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(res.data).toEqual(row)
  })

  it('health.get surfaces a 404 {detail: string} as NotFoundError', async () => {
    const { http } = buildClient(
      () =>
        new Response(JSON.stringify({ detail: "No backstop activity for dex 'X'" }), {
          status: 404,
          headers: { 'content-type': 'application/json' },
        }),
    )
    const evm = new EvmResource(http)
    await expect(evm.hip3.backstop.health.get('NOTREAL')).rejects.toBeInstanceOf(NotFoundError)
  })

  it('transfers.list GETs /evm/hip3/backstop/transfers with offset filter', async () => {
    const { http, fetchMock } = buildClient((url) => {
      expect(url.pathname).toBe('/evm/hip3/backstop/transfers')
      expect(url.searchParams.get('dex')).toBe('km')
      expect(url.searchParams.get('is_deposit')).toBe('true')
      return mockResponse(apiResponse([]))
    })
    const evm = new EvmResource(http)
    const page = await evm.hip3.backstop.transfers.list({ dex: 'km', isDeposit: true })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(page.data).toEqual([])
  })

  it('transfers.summary GETs /evm/hip3/backstop/transfers-summary', async () => {
    const { http, fetchMock } = buildClient((url) => {
      expect(url.pathname).toBe('/evm/hip3/backstop/transfers-summary')
      return mockResponse(apiResponse([]))
    })
    const evm = new EvmResource(http)
    const page = await evm.hip3.backstop.transfers.summary()
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(page.data).toEqual([])
  })

  it('fills(dex).list GETs /evm/hip3/backstop/{dex}/fills and coerces is_liquidation', async () => {
    const wire = sampleWireBackstopFill({ is_liquidation: 1 })
    const { http, fetchMock } = buildClient((url) => {
      expect(url.pathname).toBe('/evm/hip3/backstop/km/fills')
      expect(url.searchParams.get('coin')).toBe('km:SMALL2000')
      return mockResponse(apiResponse([wire]))
    })
    const evm = new EvmResource(http)
    const page = await evm.hip3.backstop.fills('km').list({ coin: 'km:SMALL2000' })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(page.data).toHaveLength(1)
    const row = page.data[0] as EvmBackstopFill
    // PLAN.md §F.4 — is_liquidation coerced from wire int 0/1 to boolean.
    expect(row.is_liquidation).toBe(true)
  })

  it('fills(dex).list throws ValidationError when limit exceeds the 1000 cap', async () => {
    const { http, fetchMock } = buildClient(() => mockResponse(apiResponse([])))
    const evm = new EvmResource(http)
    await expect(evm.hip3.backstop.fills('km').list({ limit: 1001 })).rejects.toBeInstanceOf(
      ValidationError,
    )
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
