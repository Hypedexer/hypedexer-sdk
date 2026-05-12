import { describe, expect, it } from 'vitest'
import {
  AuthError,
  NetworkError,
  NotFoundError,
  RateLimitError,
  ServerError,
  ValidationError,
  parseError,
} from '../src/errors/index.js'

describe('parseError', () => {
  it('401 plaintext → AuthError with raw body', () => {
    const e = parseError(401, 'text/plain', 'missing api key')
    expect(e).toBeInstanceOf(AuthError)
    expect(e.status).toBe(401)
    expect(e.message).toBe('missing api key')
  })

  it('422 with array detail → ValidationError exposing detail', () => {
    const body = JSON.stringify({
      detail: [{ type: 'int_parsing', loc: ['query', 'limit'], msg: 'invalid int', input: 'abc' }],
    })
    const e = parseError(422, 'application/json', body)
    expect(e).toBeInstanceOf(ValidationError)
    const v = e as ValidationError
    expect(v.detail).toHaveLength(1)
    expect(v.field('limit')?.msg).toBe('invalid int')
    expect(v.field('not-there')).toBeUndefined()
  })

  it('404 with string detail → NotFoundError', () => {
    const e = parseError(404, 'application/json', JSON.stringify({ detail: "Block 'x' not found" }))
    expect(e).toBeInstanceOf(NotFoundError)
    expect(e.message).toBe("Block 'x' not found")
  })

  it('400 with {error} string → ValidationError (info dispatcher)', () => {
    const e = parseError(400, 'application/json', JSON.stringify({ error: 'Unknown type: foo' }))
    expect(e).toBeInstanceOf(ValidationError)
    expect((e as ValidationError).detail[0]?.loc).toEqual(['body'])
  })

  it('429 → RateLimitError', () => {
    const e = parseError(429, 'text/plain', 'too many')
    expect(e).toBeInstanceOf(RateLimitError)
  })

  it('500 plaintext ClickHouse leak → ServerError (truncated raw)', () => {
    const long = 'Internal Server Error'.repeat(50)
    const e = parseError(500, 'text/plain', long)
    expect(e).toBeInstanceOf(ServerError)
    expect(e.message.length).toBeLessThanOrEqual(200)
    expect(e.rawBody).toBe(long)
  })

  it('524 HTML → ServerError', () => {
    const e = parseError(524, 'text/html', '<html>timeout</html>')
    expect(e).toBeInstanceOf(ServerError)
    expect(e.status).toBe(524)
  })

  it('404 plaintext (no JSON) → NotFoundError', () => {
    const e = parseError(404, 'text/plain', 'nope')
    expect(e).toBeInstanceOf(NotFoundError)
    expect(e.message).toBe('nope')
  })

  it('unknown status → NetworkError fallback', () => {
    const e = parseError(418, 'text/plain', '')
    expect(e).toBeInstanceOf(NetworkError)
  })
})
