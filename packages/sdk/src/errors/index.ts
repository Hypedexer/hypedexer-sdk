/**
 * A single field-level validation problem, mirroring one entry of a FastAPI
 * `detail[]` array.
 *
 * @remarks
 * Shape matches the upstream `{type, loc, msg, input, ctx}` payload
 * (PLAN.md §C). `loc` is the path to the offending value (e.g.
 * `['query', 'limit']`); `msg` is always present.
 */
export interface ValidationDetail {
  type?: string
  loc?: (string | number)[]
  msg: string
  input?: unknown
  ctx?: unknown
}

/**
 * Optional context attached to any {@link HypedexerError}.
 *
 * @remarks
 * `status` is the HTTP status when the error originates from a response;
 * `rawBody` is the parsed JSON object/array or the original text; `cause`
 * carries an underlying error (e.g. a network failure).
 */
export interface HypedexerErrorOptions {
  status?: number
  rawBody?: string | object
  cause?: unknown
}

/**
 * Abstract base class for every error thrown by the SDK.
 *
 * @remarks
 * Never instantiated directly; use one of the concrete subclasses
 * ({@link AuthError}, {@link NotFoundError}, {@link ValidationError}, etc).
 * The `name` property is set to the concrete subclass name so
 * `instanceof` checks and log output stay accurate. Optional `status`,
 * `rawBody`, and `cause` come from {@link HypedexerErrorOptions}.
 */
export abstract class HypedexerError extends Error {
  readonly status?: number
  readonly rawBody?: string | object
  override readonly cause?: unknown

  constructor(message: string, opts: HypedexerErrorOptions = {}) {
    super(message)
    this.name = new.target.name
    if (opts.status !== undefined) this.status = opts.status
    if (opts.rawBody !== undefined) this.rawBody = opts.rawBody
    if (opts.cause !== undefined) this.cause = opts.cause
  }
}

/**
 * Authentication or authorization failure, mapped from an HTTP 401 response.
 */
export class AuthError extends HypedexerError {}

/**
 * The requested resource does not exist, mapped from an HTTP 404 response.
 */
export class NotFoundError extends HypedexerError {}

/**
 * The client has been rate limited, mapped from an HTTP 429 response.
 */
export class RateLimitError extends HypedexerError {}

/**
 * The server failed to handle the request, mapped from an HTTP 5xx response.
 */
export class ServerError extends HypedexerError {}

/**
 * A transport-level failure (connection error, timeout, or unparseable
 * response body) with no usable HTTP status.
 */
export class NetworkError extends HypedexerError {}

/**
 * Request validation failure, mapped from an HTTP 422 FastAPI `detail[]`
 * response or a 400 `/info` dispatcher `{error}` response.
 *
 * @remarks
 * Also thrown client-side when the SDK rejects invalid arguments before a
 * request is sent. Exposes the raw {@link ValidationDetail} entries via
 * {@link ValidationError.detail} and a {@link ValidationError.field} helper
 * to look one up by name.
 */
export class ValidationError extends HypedexerError {
  /** The field-level validation problems reported for this error. */
  readonly detail: ValidationDetail[]

  constructor(message: string, detail: ValidationDetail[], opts: HypedexerErrorOptions = {}) {
    super(message, opts)
    this.detail = detail
  }

  field(name: string): ValidationDetail | undefined {
    return this.detail.find((d) => d.loc?.some((part) => part === name))
  }
}

/**
 * A WebSocket-layer failure.
 *
 * @remarks
 * Base class for the WS-specific error types. Carries the optional
 * `closeCode` and `reason` from the socket close frame in addition to the
 * standard {@link HypedexerError} fields.
 */
export class WebSocketError extends HypedexerError {
  /** The WebSocket close code, when the error stems from a close frame. */
  readonly closeCode?: number
  /** The WebSocket close reason text, when provided by the peer. */
  readonly reason?: string

  constructor(
    message: string,
    opts: HypedexerErrorOptions & { closeCode?: number; reason?: string } = {},
  ) {
    super(message, opts)
    if (opts.closeCode !== undefined) this.closeCode = opts.closeCode
    if (opts.reason !== undefined) this.reason = opts.reason
  }
}

/**
 * WebSocket authentication or authorization failure. Raised on a 4xx upgrade
 * response or a 4xxx close code; stops the auto-reconnect loop.
 */
export class WSAuthError extends WebSocketError {}
/**
 * Signals a likely subprotocol-echo failure, surfaced when the socket closes
 * with code 1006 after the welcome frame (PLAN.md §I #19). Still transient:
 * the client reconnects.
 */
export class WSSubprotocolError extends WebSocketError {}
/**
 * An application-level error frame (`{type:'error', message}`) received over
 * the WebSocket connection.
 */
export class WSProtocolError extends WebSocketError {}

function tryParseJson(body: string): unknown {
  try {
    return JSON.parse(body)
  } catch {
    return undefined
  }
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

/**
 * Map an HTTP error response to the appropriate {@link HypedexerError}
 * subclass.
 *
 * @remarks
 * Dispatches over the six known upstream error shapes (PLAN.md §C): 401
 * plaintext, 422 FastAPI `detail[]`, 404 FastAPI `{detail: string}`, 400
 * `/info` `{error: string}`, 5xx server text, and any other status. The body
 * is parsed as JSON when possible and preserved on `rawBody`; otherwise the
 * raw text is used.
 *
 * @param status - HTTP status code of the response.
 * @param _contentType - Response `Content-Type`; currently unused, dispatch
 *   keys off `status` and the parsed body shape.
 * @param body - Raw response body text.
 * @returns The concrete error to throw. Never returns `HypedexerError`
 *   directly; falls back to {@link NetworkError} for unrecognized statuses.
 *
 * @example
 * ```ts
 * const err = parseError(422, 'application/json', '{"detail":[{"msg":"bad"}]}')
 * if (err instanceof ValidationError) console.log(err.detail[0].msg)
 * ```
 */
export function parseError(status: number, _contentType: string, body: string): HypedexerError {
  const parsed = tryParseJson(body)
  const rawBody: string | object = isRecord(parsed) || Array.isArray(parsed) ? parsed : body

  if (status === 401) {
    return new AuthError(typeof body === 'string' && body.length > 0 ? body : 'unauthorized', {
      status,
      rawBody,
    })
  }

  if (status === 422 && isRecord(parsed) && Array.isArray(parsed['detail'])) {
    const detail = parsed['detail'] as ValidationDetail[]
    const msg = detail[0]?.msg ?? 'validation failed'
    return new ValidationError(msg, detail, { status, rawBody })
  }

  if (status === 404 && isRecord(parsed) && typeof parsed['detail'] === 'string') {
    return new NotFoundError(parsed['detail'] as string, { status, rawBody })
  }

  if (status === 400 && isRecord(parsed) && typeof parsed['error'] === 'string') {
    const msg = parsed['error'] as string
    return new ValidationError(msg, [{ msg, loc: ['body'], type: 'info_dispatcher' }], {
      status,
      rawBody,
    })
  }

  if (status === 429) {
    return new RateLimitError(typeof body === 'string' && body.length > 0 ? body : 'rate limited', {
      status,
      rawBody,
    })
  }

  if (status >= 500) {
    return new ServerError(
      typeof body === 'string' && body.length > 0 ? body.slice(0, 200) : `server error ${status}`,
      { status, rawBody },
    )
  }

  if (status === 404) {
    return new NotFoundError(typeof body === 'string' && body.length > 0 ? body : 'not found', {
      status,
      rawBody,
    })
  }

  return new NetworkError(`unexpected status ${status}`, { status, rawBody })
}
