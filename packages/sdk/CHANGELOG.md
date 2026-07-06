# Changelog

All notable changes to `@hypedexer/sdk` are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0-beta.1] - 2026-07-06

### Changed

- `Fills.spotList()` and `Fills.spotUser()` now issue real HTTP requests to
  `/fills/spot/` and `/fills/spot/user/{address}` instead of throwing
  `ServerError`. The upstream ClickHouse bug documented in PLAN §I #1 was
  fixed since the SDK was cut and both endpoints now return spot fills over
  the standard APIResponse envelope with offset pagination.
- Updated the README error-handling example that previously used `spotList`
  as the "server 500" exemplar and dropped bug #1 from the "Broken
  endpoints" table.

## [0.1.0-beta.0] - 2026-07-06

Initial public beta.

### Added

- `createClient({ apiKey })` factory returning a typed client with 16 resource handles:
  `fills`, `analytics`, `overview`, `users`, `completedTrades`, `liquidations`,
  `hip3`, `hip4`, `builders`, `twaps`, `funding`, `vaults`, `evm`, `priorityFees`,
  `info`, plus low-level `http`.
- Full REST coverage of the HypeDexer indexer API (~95 endpoints).
- WebSocket transport (Node only, `ws` peer dependency) covering the 5 public
  channels: `all_mids`, `l2_book`, `trades`, `bbo`, `all_fills`.
- Universal `iterate()` helper for cursor / offset / timeWindow / single-page
  pagination shapes.
- Typed error hierarchy: `HypedexerError` → `AuthError`, `NotFoundError`,
  `RateLimitError`, `ServerError`, `NetworkError`, `ValidationError`,
  `WebSocketError` (+ `WSAuthError`, `WSSubprotocolError`, `WSProtocolError`).
- `Wei` branded string type and `parseCoin` / `formatCoin` helpers for
  Hyperliquid-specific value conversions.
- Public-surface type regression tests using `expectTypeOf`.
- Full JSDoc with citations of the 25 upstream quirks documented in `PLAN.md`.

### Known limitations

- WebSocket is Node only; browsers throw `WebSocketError` on construction (see
  upstream bug #19).
- Order signing / exchange endpoints are not covered by this SDK; use
  `@hypedexer/exchange` (not yet published) or a Hyperliquid signing library.
