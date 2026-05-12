import { describe, expect, it, vi } from 'vitest'
import { iterate } from '../src/pagination/iterator.js'
import type { Page } from '../src/types/common.js'

function page<T>(data: T[], opts: Partial<Page<T>['meta']> = {}): Page<T> {
  return {
    data,
    meta: { family: 'apiResponse', ...opts },
  }
}

async function collect<T>(it: AsyncIterable<T>): Promise<T[]> {
  const out: T[] = []
  for await (const x of it) out.push(x)
  return out
}

describe('iterate', () => {
  it('cursor: follows nextCursor until hasMore=false', async () => {
    const fetcher = vi.fn(async (p: { cursor?: string }) => {
      if (!p.cursor) return page([1, 2], { nextCursor: 'c1', hasMore: true })
      if (p.cursor === 'c1') return page([3, 4], { nextCursor: 'c2', hasMore: true })
      return page([5], { nextCursor: null, hasMore: false })
    })
    const out = await collect(iterate(fetcher, {}, { kind: 'cursor' }))
    expect(out).toEqual([1, 2, 3, 4, 5])
    expect(fetcher).toHaveBeenCalledTimes(3)
  })

  it('cursor: stops when nextCursor is null even if hasMore is undefined', async () => {
    const fetcher = vi.fn(async () => page([1, 2], { nextCursor: null }))
    const out = await collect(iterate(fetcher, {}, { kind: 'cursor' }))
    expect(out).toEqual([1, 2])
    expect(fetcher).toHaveBeenCalledTimes(1)
  })

  it('offset: stops when page.length < limit', async () => {
    const fetcher = vi.fn(async (p: { offset: number; limit: number }) => {
      if (p.offset === 0) return page([1, 2, 3])
      if (p.offset === 3) return page([4, 5])
      return page<number>([])
    })
    const out = await collect(iterate(fetcher, { limit: 3 }, { kind: 'offset' }))
    expect(out).toEqual([1, 2, 3, 4, 5])
    expect(fetcher).toHaveBeenCalledTimes(2)
  })

  it('offset: handles default limit when not specified', async () => {
    const fetcher = vi.fn(async () => page([1]))
    const out = await collect(iterate(fetcher, {}, { kind: 'offset', limit: 5 }))
    expect(out).toEqual([1])
  })

  it('timeWindow: pages by decrementing endTime to oldest row time', async () => {
    const fetcher = vi.fn(async (p: { endTime?: number }) => {
      if (p.endTime === undefined) return page([{ time: 1000 }, { time: 900 }])
      if (p.endTime === 899) return page([{ time: 800 }])
      return page<{ time: number }>([])
    })
    const out = await collect(iterate(fetcher, {}, { kind: 'timeWindow', timeKey: 'time' }))
    expect(out.map((r) => r.time)).toEqual([1000, 900, 800])
  })

  it('none: yields one page then stops', async () => {
    const fetcher = vi.fn(async () => page([1, 2]))
    const out = await collect(iterate(fetcher, {}, { kind: 'none' }))
    expect(out).toEqual([1, 2])
    expect(fetcher).toHaveBeenCalledTimes(1)
  })
})
