import { describe, expect, it, vi } from 'vitest'
import { createClient } from '../../src/client.js'
import { NotFoundError, ValidationError } from '../../src/errors/index.js'
import { ElysiumResource } from '../../src/resources/elysium.js'
import { HttpClient } from '../../src/transport/HttpClient.js'
import * as fx from './elysium.fixtures.js'

const ADDRESS = '0x245bfe8c6c2429f6a7743d53377ae39b98500459'
const HASH = `0x${'ab'.repeat(32)}`

function apiResponse(data: unknown): unknown {
  return {
    success: true,
    data,
    message: 'ok',
    next_cursor: null,
    has_more: false,
    total_count: null,
    execution_time_ms: 3,
  }
}

function setup(body: unknown = [], status = 200) {
  const calls: URL[] = []
  const fetchMock = vi.fn(async (input: string | URL) => {
    calls.push(new URL(input.toString()))
    return new Response(JSON.stringify(status === 200 ? apiResponse(body) : body), {
      status,
      headers: { 'content-type': 'application/json' },
    })
  })
  const http = new HttpClient({ apiKey: 'test-key', fetch: fetchMock as unknown as typeof fetch })
  const ely = new ElysiumResource(http).testnet
  const last = () => {
    const url = calls.at(-1)
    if (!url) throw new Error('no request made')
    return url
  }
  return { ely, fetchMock, last }
}

describe('client wiring', () => {
  it('exposes client.elysium.testnet', () => {
    const client = createClient({ apiKey: 'k' })
    expect(client.elysium.testnet.stats).toBeDefined()
  })
})

describe('stats', () => {
  it('get hits /elysium/testnet/stats', async () => {
    const { ely, last } = setup(fx.stats)
    const res = await ely.stats.get()
    expect(last().pathname).toBe('/elysium/testnet/stats')
    expect(res.data.user_transactions).toBe(fx.stats.user_transactions)
  })

  it('daily sends days and rejects values outside 1..365', async () => {
    const { ely, last, fetchMock } = setup([fx.daily])
    await ely.stats.daily({ days: 7 })
    expect(last().pathname).toBe('/elysium/testnet/stats/daily')
    expect(last().searchParams.get('days')).toBe('7')
    await expect(ely.stats.daily({ days: 366 })).rejects.toBeInstanceOf(ValidationError)
    await expect(ely.stats.daily({ days: 0 })).rejects.toBeInstanceOf(ValidationError)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})

describe('blocks', () => {
  it('list maps camelCase params and emits ISO time', async () => {
    const { ely, last } = setup([fx.block])
    await ely.blocks.list({ startBlock: 10, endBlock: 20, startTime: 0, limit: 5, offset: 5 })
    const q = last().searchParams
    expect(last().pathname).toBe('/elysium/testnet/blocks')
    expect(q.get('start_block')).toBe('10')
    expect(q.get('end_block')).toBe('20')
    expect(q.get('start_time')).toBe('1970-01-01T00:00:00.000Z')
    expect(q.get('limit')).toBe('5')
    expect(q.get('offset')).toBe('5')
  })

  it('rejects limit above 1000 without a request', async () => {
    const { ely, fetchMock } = setup()
    await expect(ely.blocks.list({ limit: 1001 })).rejects.toBeInstanceOf(ValidationError)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('get and transactions hit the block routes, transactions are coerced', async () => {
    const { ely, last } = setup([fx.tx])
    const page = await ely.blocks.transactions(42)
    expect(last().pathname).toBe('/elysium/testnet/blocks/42/transactions')
    expect(page.data[0]?.success).toBe(true)
    expect(page.data[0]?.is_spam).toBe(false)
    const one = setup(fx.block)
    await one.ely.blocks.get(42)
    expect(one.last().pathname).toBe('/elysium/testnet/blocks/42')
  })

  it('maps a 404 to NotFoundError', async () => {
    const { ely } = setup({ detail: 'Block 999999999 not found' }, 404)
    await expect(ely.blocks.get(999_999_999)).rejects.toBeInstanceOf(NotFoundError)
  })
})

describe('transactions', () => {
  it('list sends every filter and coerces 0 | 1 to booleans', async () => {
    const { ely, last } = setup([{ ...fx.tx, success: 0, is_system: 1, is_spam: 1 }])
    const page = await ely.transactions.list({
      blockNumber: 7,
      fromAddr: ADDRESS,
      toAddr: ADDRESS,
      methodId: '0x4e71d92d',
      txType: '0x2',
      includeSystem: false,
      includeSpam: false,
    })
    const q = last().searchParams
    expect(q.get('block_number')).toBe('7')
    expect(q.get('from_addr')).toBe(ADDRESS)
    expect(q.get('to_addr')).toBe(ADDRESS)
    expect(q.get('method_id')).toBe('0x4e71d92d')
    expect(q.get('tx_type')).toBe('0x2')
    expect(q.get('include_system')).toBe('false')
    expect(q.get('include_spam')).toBe('false')
    expect(page.data[0]).toMatchObject({ success: false, is_system: true, is_spam: true })
  })

  it('get validates the hash and keeps logs and token transfers', async () => {
    const { ely, last, fetchMock } = setup(fx.txDetail)
    await expect(ely.transactions.get('0x1234')).rejects.toBeInstanceOf(ValidationError)
    expect(fetchMock).not.toHaveBeenCalled()
    const res = await ely.transactions.get(fx.txDetail.tx_hash)
    expect(last().pathname).toBe(`/elysium/testnet/transactions/${fx.txDetail.tx_hash}`)
    expect(res.data.success).toBe(true)
    expect(Array.isArray(res.data.logs)).toBe(true)
    expect(Array.isArray(res.data.token_transfers)).toBe(true)
  })

  it('rejects a malformed address filter', async () => {
    const { ely } = setup()
    await expect(ely.transactions.list({ fromAddr: '0xnope' })).rejects.toBeInstanceOf(
      ValidationError,
    )
  })
})

describe('logs and batches', () => {
  it('logs maps address, topic0 and tx hash', async () => {
    const { ely, last } = setup([fx.log])
    await ely.logs.list({ address: ADDRESS, topic0: fx.log.topic0, txHash: HASH, blockNumber: 3 })
    const q = last().searchParams
    expect(last().pathname).toBe('/elysium/testnet/logs')
    expect(q.get('address')).toBe(ADDRESS)
    expect(q.get('topic0')).toBe(fx.log.topic0)
    expect(q.get('tx_hash')).toBe(HASH)
    expect(q.get('block_number')).toBe('3')
  })

  it('batches list and get', async () => {
    const { ely, last } = setup([fx.batch])
    await ely.batches.list({ limit: 2 })
    expect(last().pathname).toBe('/elysium/testnet/batches')
    const one = setup(fx.batch)
    const res = await one.ely.batches.get(fx.batch.batch_number)
    expect(one.last().pathname).toBe(`/elysium/testnet/batches/${fx.batch.batch_number}`)
    expect(res.data.posting_delay_s).toBe(fx.batch.posting_delay_s)
  })
})

describe('bridge', () => {
  it('transfers validates enums before sending', async () => {
    const { ely, fetchMock } = setup()
    await expect(ely.bridge.transfers({ direction: 'sideways' as never })).rejects.toBeInstanceOf(
      ValidationError,
    )
    await expect(ely.bridge.transfers({ status: 'lost' as never })).rejects.toBeInstanceOf(
      ValidationError,
    )
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('transfers maps every filter', async () => {
    const { ely, last } = setup([fx.transfer])
    await ely.bridge.transfers({
      address: ADDRESS,
      direction: 'withdrawal',
      status: 'initiated',
      asset: 'native',
      route: 'native',
      includeMessages: true,
    })
    const q = last().searchParams
    expect(last().pathname).toBe('/elysium/testnet/bridge/transfers')
    expect(q.get('address')).toBe(ADDRESS)
    expect(q.get('direction')).toBe('withdrawal')
    expect(q.get('status')).toBe('initiated')
    expect(q.get('asset')).toBe('native')
    expect(q.get('route')).toBe('native')
    expect(q.get('include_messages')).toBe('true')
  })

  it('track returns every transfer of a hash, as a list', async () => {
    const { ely, last } = setup([fx.transfer])
    const page = await ely.bridge.track(HASH)
    expect(last().pathname).toBe(`/elysium/testnet/bridge/transfers/${HASH}`)
    expect(page.data).toHaveLength(1)
    expect(page.data[0]?.transfer_id).toBe(fx.transfer.transfer_id)
  })

  it('retryables, tokens and reserves hit their routes', async () => {
    const r = setup([fx.retryable])
    await r.ely.bridge.retryables({ status: 'failed' })
    expect(r.last().pathname).toBe('/elysium/testnet/bridge/retryables')
    expect(r.last().searchParams.get('status')).toBe('failed')

    const t = setup([fx.bridgeToken])
    await t.ely.bridge.tokens({ route: 'canonical' })
    expect(t.last().pathname).toBe('/elysium/testnet/bridge/tokens')
    await expect(t.ely.bridge.tokens({ route: 'native' as never })).rejects.toBeInstanceOf(
      ValidationError,
    )

    const s = setup([fx.reserve])
    const page = await s.ely.bridge.reserves({ route: 'canonical', onlyUnbacked: true })
    expect(s.last().pathname).toBe('/elysium/testnet/bridge/reserves')
    expect(s.last().searchParams.get('only_unbacked')).toBe('true')
    expect(page.data[0]?.backed).toBe(true)
  })
})

describe('tokens', () => {
  it('list, get, holders and transfers', async () => {
    const l = setup([fx.token])
    await l.ely.tokens.list({ standard: 'erc20', origin: 'native', search: 'HYPE' })
    expect(l.last().pathname).toBe('/elysium/testnet/tokens')
    expect(l.last().searchParams.get('search')).toBe('HYPE')

    const g = setup(fx.token)
    await g.ely.tokens.get(ADDRESS)
    expect(g.last().pathname).toBe(`/elysium/testnet/tokens/${ADDRESS}`)

    const h = setup([fx.holder])
    await h.ely.tokens.holders(ADDRESS, { limit: 10 })
    expect(h.last().pathname).toBe(`/elysium/testnet/tokens/${ADDRESS}/holders`)

    const t = setup([fx.tokenTransfer])
    await t.ely.tokens.transfers(ADDRESS, { holder: ADDRESS })
    expect(t.last().pathname).toBe(`/elysium/testnet/tokens/${ADDRESS}/transfers`)
    expect(t.last().searchParams.get('holder')).toBe(ADDRESS)
  })

  it('rejects a malformed token address without a request', async () => {
    const { ely, fetchMock } = setup()
    await expect(ely.tokens.get('0x12')).rejects.toBeInstanceOf(ValidationError)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('user', () => {
  it('validates the address once, at the factory', () => {
    const { ely } = setup()
    expect(() => ely.user('0xnope')).toThrow(ValidationError)
  })

  it('balances, activity and bridge hit the per-address routes', async () => {
    const b = setup(fx.balances)
    const res = await b.ely.user(ADDRESS).balances({ block: 100 })
    expect(b.last().pathname).toBe(`/elysium/testnet/user/${ADDRESS}/balances`)
    expect(b.last().searchParams.get('block')).toBe('100')
    expect(res.data.tokens.length).toBe(fx.balances.tokens.length)

    const a = setup([fx.activity])
    await a.ely.user(ADDRESS).activity({ limit: 2 })
    expect(a.last().pathname).toBe(`/elysium/testnet/user/${ADDRESS}/activity`)

    const br = setup([])
    await br.ely.user(ADDRESS).bridge({ direction: 'deposit' })
    expect(br.last().pathname).toBe(`/elysium/testnet/user/${ADDRESS}/bridge`)
    expect(br.last().searchParams.get('direction')).toBe('deposit')
  })
})

describe('iterate', () => {
  it('walks offset pages until a short page', async () => {
    let call = 0
    const fetchMock = vi.fn(async (input: string | URL) => {
      const url = new URL(input.toString())
      call++
      const offset = Number(url.searchParams.get('offset') ?? 0)
      const rows = offset === 0 ? [fx.block, fx.block] : [fx.block]
      return new Response(JSON.stringify(apiResponse(rows)), { status: 200 })
    })
    const http = new HttpClient({ apiKey: 'k', fetch: fetchMock as unknown as typeof fetch })
    const ely = new ElysiumResource(http).testnet
    const seen = []
    for await (const b of ely.blocks.iterate({ limit: 2 })) seen.push(b)
    expect(seen).toHaveLength(3)
    expect(call).toBe(2)
  })
})
