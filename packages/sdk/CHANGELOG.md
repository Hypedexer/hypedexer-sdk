# Changelog

All notable changes to `@hypedexer/sdk` are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0-beta.5] - 2026-11-02

### Added

- `client.elysium.mainnet`: the same 22 routes under `/elysium/mainnet` (chain 99901), same shapes as testnet (live-verified 2026-11-02). `ElysiumNetwork` is now `'mainnet' | 'testnet'`.
- WS channel `liquidations`, the one the server serves today; `subscribe('liquidations', { user })` follows one wallet. Its pushes, typed `liquidation` on the wire, reach both the `liquidations` and `liquidation` listeners.

### Fixed

- `WSClient` works against the current server again (it could not connect at all):
  - the default URL is now `wss://api.hypedexer.com/ws`; the bare host answered the upgrade with 200;
  - the `{type: "connected"}` greeting counts as the welcome, where `connect()` used to wait for a `welcome` frame the server no longer sends;
  - `{channel: "subscriptionResponse"}` acks settle `subscribe()` / `unsubscribe()`, which used to time out.
- A refused channel (`Unsupported subscription: …`) now rejects `subscribe()` at once with that message, and `listSubscriptions()` rejects when the server does not support it, instead of waiting for the timeout. `completed_trades`, `fills_spot`, `liquidation`, `hip4_events` and `recent_activity` remain in the types, but the server refuses them.

### Security

- Dev dependencies: `vite` 6.4.5, `vitest` 4.1.12, `ws` 8.22.1, `@types/ws` 8.18.2, `tsx` 4.23.15, and overrides for `fast-uri`, `esbuild` (0.28) and `source-map-js`. `pnpm audit` goes from 13 advisories (2 high) to 0. The published package still has no runtime dependencies.

## [0.1.0-beta.4] - 2026-09-30

### Added

- `client.elysium.testnet`: the 22 routes under `/elysium/testnet` (Kinetiq's L2 on Hyperliquid). `stats` (`get`, `daily`), `blocks` (`list`, `get`, `transactions`), `transactions` (`list`, `get` with logs and decoded token transfers), `logs`, `batches` (`list`, `get`), `bridge` (`transfers`, `track`, `retryables`, `tokens`, `reserves`), `tokens` (`list`, `get`, `holders`, `transfers`) and `user(address)` (`balances`, `activity`, `bridge`), with offset iterators on the paginated lists. Wire ints `success`, `is_system` and `is_spam` are coerced to booleans; addresses, hashes, enums, `limit` and `days` are validated before any request.

### Security

- Dev dependencies updated so `pnpm audit` goes from 32 advisories (2 critical, 18 high) to 1 low: `vitest` 4.1.11, `tsup` 8.5.1, `vite` 6.4.x, and pnpm overrides for `js-yaml`, `fast-uri`, `tmp`, `yaml`, `postcss`, `nanoid` and old `esbuild`. None of them ships in the published package, which has no runtime dependencies.
- CI runs with a read-only token and pins its actions to commit SHAs.

## [0.1.0-beta.3] - 2026-07-27

### Added

- `orderStatus` dispatch on `POST /info`: adds the `InfoOrderStatusBody` request type (`user` required, optional `oid`/`cloid`) and an `orderStatus` result-map entry, with client-side user-address validation. Restores forward coverage after the upstream variant was re-added (issue #9).

## [0.1.0-beta.2] - 2026-07-24

### Added

- `completedTrades.get(tradeId, { includeFills })` wrapping `GET /completed-trades/{trade_id}`, returning a single `TradeDetail`. Adds the `TradeDetail` and `CompletedTradeGetParams` exports.

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
