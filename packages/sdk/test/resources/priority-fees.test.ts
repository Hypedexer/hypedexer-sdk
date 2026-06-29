import { describe, expect, it, vi } from 'vitest'
import { ValidationError } from '../../src/errors/index.js'
import { PriorityFeesResource } from '../../src/resources/priority-fees.js'
import { HttpClient } from '../../src/transport/HttpClient.js'
import type { GossipHistoryEntry, GossipLiveStatus } from '../../src/types/priority-fees.js'

function jsonResponse(body: unknown, status = 200): Response {
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

function sampleStatus(): GossipLiveStatus {
  return {
    previousWinners: ['18.180.228.50', '54.64.2.87', null, null, null],
    currentAuctions: [
      {
        slotId: 0,
        startTime: '2026-05-02T05:42:00',
        durationSeconds: 180,
        startGas: 2.0505605,
        currentGas: 1.91066196,
        endGas: null,
        winner: '18.180.228.50',
        lastUpdate: '2026-05-02T05:42:13',
      },
      {
        slotId: 1,
        startTime: '2026-05-02T05:42:00',
        durationSeconds: 180,
        startGas: 1.0,
        currentGas: 0.93545,
        endGas: null,
        winner: '54.64.2.87',
        lastUpdate: '2026-05-02T05:42:13',
      },
      {
        slotId: 2,
        startTime: '2026-05-02T05:42:00',
        durationSeconds: 180,
        startGas: 0.1,
        currentGas: 0.1,
        endGas: null,
        winner: null,
        lastUpdate: '2026-05-02T05:42:13',
      },
      {
        slotId: 3,
        startTime: '2026-05-02T05:42:00',
        durationSeconds: 180,
        startGas: 0.1,
        currentGas: 0.1,
        endGas: null,
        winner: null,
        lastUpdate: '2026-05-02T05:42:13',
      },
      {
        slotId: 4,
        startTime: '2026-05-02T05:42:00',
        durationSeconds: 180,
        startGas: 0.1,
        currentGas: 0.1,
        endGas: null,
        winner: null,
        lastUpdate: '2026-05-02T05:42:13',
      },
    ],
  }
}

function historyRow(overrides: Partial<GossipHistoryEntry> = {}): GossipHistoryEntry {
  return {
    slotId: 0,
    startTime: '2026-05-02T05:42:00',
    durationSeconds: 180,
    startGas: 2.0505605,
    endGas: null,
    winner: '18.180.228.50',
    snapshotTs: '2026-05-02T05:42:13',
    ...overrides,
  }
}

// -----------------------------------------------------------------------------
// status — GET /hip3/priority-fees/gossip/status
// -----------------------------------------------------------------------------

describe('PriorityFeesResource.status', () => {
  it('GETs /hip3/priority-fees/gossip/status and unwraps Single<GossipLiveStatus>', async () => {
    const status = sampleStatus()
    const { http, fetchMock } = buildClient((url, init) => {
      expect(url.pathname).toBe('/hip3/priority-fees/gossip/status')
      expect(url.search).toBe('')
      const headers = init?.headers as Record<string, string>
      expect(headers['X-API-Key']).toBe('test-key')
      return jsonResponse({
        success: true,
        message: 'Gossip auction status (5 slots)',
        data: status,
        total_count: null,
        execution_time_ms: 3.42,
        next_cursor: null,
        has_more: null,
      })
    })
    const resource = new PriorityFeesResource(http)

    const res = await resource.status()

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(res.meta.family).toBe('apiResponse')
    expect(res.meta.message).toBe('Gossip auction status (5 slots)')
    expect(res.meta.executionMs).toBe(3.42)
    expect(res.data?.previousWinners).toHaveLength(5)
    // Bug #9 defense: winner is an IPv4 string, not a wallet.
    expect(res.data?.previousWinners[0]).toBe('18.180.228.50')
    expect(res.data?.previousWinners[2]).toBeNull()
    expect(res.data?.currentAuctions).toHaveLength(5)
    expect(res.data?.currentAuctions[0]?.winner).toBe('18.180.228.50')
    expect(res.data?.currentAuctions[2]?.winner).toBeNull()
    expect(res.data?.currentAuctions[0]?.endGas).toBeNull()
  })
})

// -----------------------------------------------------------------------------
// history — GET /hip3/priority-fees/gossip/history
// -----------------------------------------------------------------------------

describe('PriorityFeesResource.history', () => {
  it('GETs /hip3/priority-fees/gossip/history with typed query params', async () => {
    const row = historyRow()
    const { http, fetchMock } = buildClient((url) => {
      expect(url.pathname).toBe('/hip3/priority-fees/gossip/history')
      expect(url.searchParams.get('slot_id')).toBe('0')
      expect(url.searchParams.get('winner')).toBe('18.180.228.50')
      expect(url.searchParams.get('limit')).toBe('50')
      expect(url.searchParams.get('offset')).toBe('100')
      expect(url.searchParams.get('start_time')).toBe('2026-05-01T00:00:00.000Z')
      expect(url.searchParams.get('end_time')).toBe('2026-05-11T00:00:00.000Z')
      return jsonResponse({
        success: true,
        message: 'Fetched 1 auction history entries',
        data: [row],
        total_count: 49785,
        execution_time_ms: 4.81,
        next_cursor: null,
        has_more: null,
      })
    })
    const resource = new PriorityFeesResource(http)

    const page = await resource.history({
      slotId: 0,
      winner: '18.180.228.50',
      limit: 50,
      offset: 100,
      startTime: '2026-05-01T00:00:00Z',
      endTime: new Date('2026-05-11T00:00:00Z'),
    })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(page.data).toEqual([row])
    expect(page.meta.family).toBe('apiResponse')
    expect(page.meta.totalCount).toBe(49785)
    expect(page.meta.executionMs).toBe(4.81)
    // Bug #9 defense: winner is IPv4 in every history row.
    expect(page.data[0]?.winner).toBe('18.180.228.50')
  })

  it('omits unset params from the query string', async () => {
    const { http, fetchMock } = buildClient((url) => {
      expect(url.pathname).toBe('/hip3/priority-fees/gossip/history')
      expect(url.searchParams.has('slot_id')).toBe(false)
      expect(url.searchParams.has('winner')).toBe(false)
      expect(url.searchParams.has('limit')).toBe(false)
      expect(url.searchParams.has('offset')).toBe(false)
      expect(url.searchParams.has('start_time')).toBe(false)
      expect(url.searchParams.has('end_time')).toBe(false)
      return jsonResponse({ success: true, data: [] })
    })
    const resource = new PriorityFeesResource(http)
    const page = await resource.history()
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(page.data).toEqual([])
  })

  it('throws ValidationError when slotId > 4 (bug defense — server 422s at 5)', async () => {
    const { http, fetchMock } = buildClient(() => jsonResponse({ success: true, data: [] }))
    const resource = new PriorityFeesResource(http)
    await expect(resource.history({ slotId: 5 })).rejects.toBeInstanceOf(ValidationError)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('throws ValidationError when slotId < 0', async () => {
    const { http, fetchMock } = buildClient(() => jsonResponse({ success: true, data: [] }))
    const resource = new PriorityFeesResource(http)
    await expect(resource.history({ slotId: -1 })).rejects.toBeInstanceOf(ValidationError)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('throws ValidationError when slotId is non-integer', async () => {
    const { http, fetchMock } = buildClient(() => jsonResponse({ success: true, data: [] }))
    const resource = new PriorityFeesResource(http)
    await expect(resource.history({ slotId: 1.5 })).rejects.toBeInstanceOf(ValidationError)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('accepts slotId boundary values 0 and 4', async () => {
    const { http, fetchMock } = buildClient((url) => {
      const slot = url.searchParams.get('slot_id')
      expect(slot === '0' || slot === '4').toBe(true)
      return jsonResponse({ success: true, data: [] })
    })
    const resource = new PriorityFeesResource(http)
    await resource.history({ slotId: 0 })
    await resource.history({ slotId: 4 })
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })
})

// -----------------------------------------------------------------------------
// iterate — offset pagination
// -----------------------------------------------------------------------------

describe('PriorityFeesResource.iterate', () => {
  it('walks two offset pages and stops on a short page', async () => {
    const { http, fetchMock } = buildClient((url) => {
      expect(url.pathname).toBe('/hip3/priority-fees/gossip/history')
      const offset = url.searchParams.get('offset')
      expect(url.searchParams.get('limit')).toBe('2')
      if (offset === '0') {
        return jsonResponse({
          success: true,
          data: [
            historyRow({ snapshotTs: '2026-05-02T05:42:13' }),
            historyRow({ snapshotTs: '2026-05-02T05:41:41' }),
          ],
        })
      }
      expect(offset).toBe('2')
      return jsonResponse({
        success: true,
        // Short page → iterator stops after yielding it.
        data: [historyRow({ snapshotTs: '2026-05-02T05:41:09' })],
      })
    })
    const resource = new PriorityFeesResource(http)
    const out: GossipHistoryEntry[] = []
    for await (const row of resource.iterate({ limit: 2 })) {
      out.push(row)
    }
    expect(out).toHaveLength(3)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('refuses a bad slotId synchronously', async () => {
    const { http, fetchMock } = buildClient(() => jsonResponse({ success: true, data: [] }))
    const resource = new PriorityFeesResource(http)
    expect(() => resource.iterate({ slotId: 5 })).toThrow(ValidationError)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

// -----------------------------------------------------------------------------
// dedupedHistory — client-side dedupe of (slotId, startTime)
// -----------------------------------------------------------------------------

describe('PriorityFeesResource.dedupedHistory', () => {
  it('collapses duplicate (slotId, startTime) rows keeping the newest snapshotTs', async () => {
    // Matches the batch-9 history.json sample: slot 0 appears 3x for the
    // same startTime with different snapshotTs values; slot 1 appears once.
    const rows: GossipHistoryEntry[] = [
      historyRow({
        slotId: 0,
        startTime: '2026-05-02T05:42:00',
        snapshotTs: '2026-05-02T05:42:13',
      }),
      historyRow({
        slotId: 1,
        startTime: '2026-05-02T05:42:00',
        startGas: 1.0,
        winner: '54.64.2.87',
        snapshotTs: '2026-05-02T05:42:13',
      }),
      historyRow({
        slotId: 0,
        startTime: '2026-05-02T05:39:00',
        startGas: 1.9959385,
        winner: '54.64.2.87',
        snapshotTs: '2026-05-02T05:41:41',
      }),
      historyRow({
        slotId: 0,
        startTime: '2026-05-02T05:39:00',
        startGas: 1.9959385,
        winner: '54.64.2.87',
        snapshotTs: '2026-05-02T05:41:09',
      }),
      historyRow({
        slotId: 0,
        startTime: '2026-05-02T05:39:00',
        startGas: 1.9959385,
        winner: '54.64.2.87',
        snapshotTs: '2026-05-02T05:40:37',
      }),
    ]

    const { http, fetchMock } = buildClient((url) => {
      expect(url.pathname).toBe('/hip3/priority-fees/gossip/history')
      return jsonResponse({
        success: true,
        message: 'Fetched 5 auction history entries',
        data: rows,
        total_count: 49785,
        execution_time_ms: 4.81,
      })
    })
    const resource = new PriorityFeesResource(http)

    const page = await resource.dedupedHistory()

    // 5 raw rows → 3 unique (slotId, startTime) auctions.
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(page.data).toHaveLength(3)

    // For slot 0 @ 05:39:00, the latest snapshotTs (05:41:41) wins.
    const slot0Old = page.data.find((r) => r.slotId === 0 && r.startTime === '2026-05-02T05:39:00')
    expect(slot0Old?.snapshotTs).toBe('2026-05-02T05:41:41')

    // Sorted newest-first by snapshotTs (descending).
    const snapshots = page.data.map((r) => r.snapshotTs)
    expect(snapshots).toEqual([...snapshots].sort((a, b) => (a < b ? 1 : -1)))

    // Envelope meta is preserved through the client-side post-processing.
    expect(page.meta.totalCount).toBe(49785)
    expect(page.meta.executionMs).toBe(4.81)
  })

  it('forwards query params and validation through to history()', async () => {
    const { http, fetchMock } = buildClient((url) => {
      expect(url.searchParams.get('slot_id')).toBe('1')
      expect(url.searchParams.get('winner')).toBe('54.64.2.87')
      return jsonResponse({ success: true, data: [] })
    })
    const resource = new PriorityFeesResource(http)
    const page = await resource.dedupedHistory({ slotId: 1, winner: '54.64.2.87' })
    expect(page.data).toEqual([])
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('rejects bad slotId without making a network call', async () => {
    const { http, fetchMock } = buildClient(() => jsonResponse({ success: true, data: [] }))
    const resource = new PriorityFeesResource(http)
    await expect(resource.dedupedHistory({ slotId: 5 })).rejects.toBeInstanceOf(ValidationError)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
