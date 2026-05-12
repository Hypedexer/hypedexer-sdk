import { describe, expect, it, vi } from 'vitest'
import { AuthError, NetworkError, ValidationError } from '../src/errors/index.js'
import { HttpClient } from '../src/transport/HttpClient.js'

function mockResponse(status: number, body: string, contentType = 'application/json'): Response {
  return new Response(body, {
    status,
    headers: { 'content-type': contentType },
  })
}

describe('HttpClient', () => {
  it('throws if apiKey is missing', () => {
    expect(() => new HttpClient({ apiKey: '' })).toThrow(TypeError)
  })

  it('attaches X-API-Key header and parses JSON body on 200', async () => {
    const fetchMock = vi.fn(async (input: string | URL) => {
      const url = new URL(input.toString())
      expect(url.pathname).toBe('/fills/count')
      return mockResponse(200, JSON.stringify({ success: true, data: { count: 42 } }))
    })
    const client = new HttpClient({ apiKey: 'k', fetch: fetchMock as unknown as typeof fetch })
    const res = await client.request<{ success: boolean; data: { count: number } }>({
      path: '/fills/count',
    })
    expect(res.data.count).toBe(42)
    const headers = fetchMock.mock.calls[0]?.[1]?.headers as Record<string, string>
    expect(headers['X-API-Key']).toBe('k')
  })

  it('serializes query params and skips null/undefined', async () => {
    const fetchMock = vi.fn(async (input: string | URL) => {
      const url = new URL(input.toString())
      expect(url.searchParams.get('coin')).toBe('BTC')
      expect(url.searchParams.get('limit')).toBe('100')
      expect(url.searchParams.has('cursor')).toBe(false)
      return mockResponse(200, '{"data":[]}')
    })
    const client = new HttpClient({ apiKey: 'k', fetch: fetchMock as unknown as typeof fetch })
    await client.request({ path: '/fills', query: { coin: 'BTC', limit: 100, cursor: null } })
  })

  it('maps 401 plaintext to AuthError', async () => {
    const fetchMock = vi.fn(async () => mockResponse(401, 'missing api key', 'text/plain'))
    const client = new HttpClient({ apiKey: 'k', fetch: fetchMock as unknown as typeof fetch })
    await expect(client.request({ path: '/fills' })).rejects.toBeInstanceOf(AuthError)
  })

  it('maps 422 to ValidationError with detail', async () => {
    const body = JSON.stringify({
      detail: [{ type: 'int_parsing', loc: ['query', 'limit'], msg: 'invalid int' }],
    })
    const fetchMock = vi.fn(async () => mockResponse(422, body))
    const client = new HttpClient({ apiKey: 'k', fetch: fetchMock as unknown as typeof fetch })
    await expect(client.request({ path: '/fills' })).rejects.toBeInstanceOf(ValidationError)
  })

  it('wraps fetch failures in NetworkError', async () => {
    const fetchMock = vi.fn(async () => {
      throw new TypeError('fetch failed')
    })
    const client = new HttpClient({ apiKey: 'k', fetch: fetchMock as unknown as typeof fetch })
    await expect(client.request({ path: '/fills' })).rejects.toBeInstanceOf(NetworkError)
  })

  it('aborts on timeout', async () => {
    const fetchMock = vi.fn((_url: string | URL, init?: RequestInit) => {
      return new Promise<Response>((_, reject) => {
        init?.signal?.addEventListener('abort', () => {
          reject(new DOMException('aborted', 'AbortError'))
        })
      })
    })
    const client = new HttpClient({
      apiKey: 'k',
      fetch: fetchMock as unknown as typeof fetch,
      timeoutMs: 10,
    })
    await expect(client.request({ path: '/fills' })).rejects.toBeInstanceOf(NetworkError)
  })
})
