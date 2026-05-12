# Batch 5 — HIP-4

Base URL: `https://api.hypedexer.com` — auth via `X-API-Key` header. Raw samples in `samples/batch-5/`.

## Summary (key SDK takeaways)

- **Third envelope style, distinct from both prior batches**. HIP-4 wraps every endpoint in `{status, count, data[], (message?, testnet_docs?)}`. Not `APIResponse<T>` (no `success`, no `total_count`, no `next_cursor`), not bare (HIP-3). The `status` field is meaningful: `"live"` for mainnet-active endpoints, `"not_yet_live"` for endpoints whose feature isn't deployed yet (`/hip4/fee-scales`, `/hip4/user-actions` — both return 200 with empty `data` plus a guidance `message` and `testnet_docs` URL).
- **Pagination is offset-only** (no cursor). `offset` + `limit` both supported; limit caps differ per endpoint (`limit≤1000` on most, `limit≤2000` on `/hip4/analytics`), enforced via 422.
- **Coin format for HIP-4 outcomes = `#NNN`** (e.g. `#290`), matching the prediction-market token ticker. `outcome_id` (int) and `coin` (`#<outcome_id>` string) are essentially synonyms — `coin == "#" + str(outcome_id)` in every fill seen. Exception: special "fallback"/"recurring zero" outcomes can have `coin: ""` (empty string) — `outcome_id=0` is one such case.
- **There are no YES/NO twin coins** in the on-chain coin sense. Each `outcome_id` is its own token (one `#NNN` per outcome). Binary markets express YES/NO via `side_specs` (string-encoded JSON like `"[{\"name\":\"Yes\"},{\"name\":\"No\"}]"`). For multi-outcome questions, the parent `question` lists `named_outcomes: int[]` (one outcome_id per choice) plus a `fallback_outcome: int`. SDK should expose `question.named_outcomes` as the canonical YES/NO/... list.
- **Question vs Outcome model**: `question_id` aggregates multiple `outcome_id`s. `class`, `underlying`, `expiry`, `period`, `target_price`, `priceThresholds` live as **string-key-encoded fragments inside `description`** (`class:priceBinary|underlying:BTC|expiry:20260512-0600|targetPrice:80813|period:1d`). On outcomes, `class`/`underlying`/`expiry`/`period`/`target_price` are **also** broken out as proper top-level columns; on questions, they are only inside the `description` string. SDK should provide a parser for that pipe-delimited mini-format.
- **Prices are probabilities (0–1 floats)** as expected for prediction markets (`px: 0.5`, `0.83861`, `0.20109`). `sz` is plain float (no Pythonic decimal-string).
- **Multi-coin analytics**: `coin=290,291` is supported on `/hip4/analytics` and returns one row per `(bucket, coin)` — each row gets an extra `coin` field. Without `coin`, rows are aggregate across all outcomes and the `coin` field is absent. Also accepted as integer ids (sample used `290,291` not `#290,#291` — server normalizes).
- **Silent fallbacks still exist**: `/hip4/markets?coin=#290` is **silently ignored** (returns full unfiltered list with 200) because the swagger schema doesn't declare `coin` as a filter on markets. Same for `/hip4/markets?coin=bogus`. Conversely, `/hip4/fees?coin=#290` does work. SDK type signatures should only expose documented filters per endpoint to avoid silently-wrong queries.
- **Strict 422 enforcement on enums** (`interval=bogus` on `/analytics`) and limit bounds — good.
- **New numeric encoding**: `feeToken` field has two flavors: `"USDH"` (the USDH-denominated fee on settled trades) and `"+250"` (a per-outcome token-denominated fee using the same `#NNN` ticker with `+` prefix on intra-market exchanges). `fee_usdc` normalizes to USDC. SDK should treat `feeToken` as opaque string, surface `fee_usdc` as the canonical amount.
- **Block-level fields** appear on settlements (`block_height`, `nonce`, `broadcaster`) — useful for on-chain reconciliation. Not present on fills.
- Response times generally 0.85–1.5s; outliers up to ~3.5s on first call (cold cache).

## Cross-cutting observations

### Envelope — the big question, answered

All ten endpoints use the same envelope:

```json
{
  "status": "live" | "not_yet_live",
  "count": <int, == data.length>,
  "data": [ ... ],
  "message"?: "HIP-4 is not yet live on mainnet. ...",
  "testnet_docs"?: "https://docs.hypedexer.com/testnet/overview"
}
```

- `count` is **the page size, not the total**. There is no `total_count` field, so total-known pagination is impossible without scanning.
- `status == "not_yet_live"` always coincides with `count: 0`, `data: []`. SDK should expose this as a typed `NotYetLive` discriminator (or surface `status` to the caller) so users don't mistake "empty list" for "no rows match my filter".
- No `next_cursor`, no headers like `x-next-cursor`. Pagination = `offset += limit` only.

This is **a third envelope family** for the SDK:
| Family | Endpoints | Shape |
|---|---|---|
| `APIResponse<T>` | perp, spot, analytics, users | `{success, data, total_count?, next_cursor?, ...}` |
| Bare | HIP-3 | direct Pydantic model / list |
| `Hip4Envelope<T>` | HIP-4 | `{status, count, data[], message?, testnet_docs?}` |

SDK suggestion: a `ResponseShape` per endpoint, with a generic `unwrap()` that dispatches.

### Date formats observed in HIP-4 responses

| Field (where) | Format | Example |
|---|---|---|
| `Fill.time_ms` | epoch ms | `1778521680500` |
| `Market.block_time`, `Outcome.block_time` | naive ISO (µs) | `2026-05-11T06:00:09.378958` |
| `OutcomeToken.updated_at`, `Question.updated_at` | naive ISO (ms) | `2026-05-08T06:00:06.301000` |
| `Settlement.block_time` | naive ISO (µs) | `2026-05-11T06:00:06.936898` |
| `Fee.date` | bare `YYYY-MM-DD` | `2026-05-11` |
| `Analytics.bucket` | naive ISO (sec) | `2026-05-11T18:00:00` |
| `Market.expiry` (inside columns) | compact `YYYYMMDD-HHMM` | `20260512-0600` ⚠ new format |
| `Settlement.nonce` | epoch ms-ish int (1778478975974) | likely a logical clock, not a real ts — treat as opaque int |

**New variants vs prior batches**: `YYYYMMDD-HHMM` for `expiry` (not ISO at all) and bare `YYYY-MM-DD` for `Fee.date`. SDK date parser must handle them. No timezone offsets seen anywhere in HIP-4 outputs.

### Pagination

`limit`+`offset` only. Verified:
- `fills?limit=3&offset=0` vs `offset=3` returns different rows (sample `fills_limit_3_offset_0.json` / `..._offset_3.json`).
- `limit=1001` on `/hip4/fills` → 422 (`less_than_equal`, le=1000).
- `limit=2001` on `/hip4/analytics` → 422 (le=2000).
- No `next_cursor` / `has_more` / response headers indicating end-of-stream. Caller must page until `count < limit`.

### HIP-4 concept map (outcome / question / class / underlying)

```
Question (question_id: int)
 ├── named_outcomes: int[]           # the meaningful choices, e.g. [7, 8, 9]
 ├── fallback_outcome: int            # catch-all if none of the above settle
 ├── settled_named_outcomes: int[]   # subset that have settled
 └── description: "class:priceBucket|underlying:BTC|expiry:...|priceThresholds:79303,82540|period:1d"

Outcome / Market (outcome_id: int)   # same record, two endpoints alias each other
 ├── coin: "#<outcome_id>" | ""      # tradeable token ticker
 ├── class: "priceBinary" | "priceBucket" | ""
 ├── underlying: "BTC" | ""           # spot/perp the prediction references
 ├── expiry: "YYYYMMDD-HHMM"
 ├── target_price: float | null       # for priceBinary
 ├── period: "1d" | ""
 ├── side_specs: stringified JSON     # e.g. "[{\"name\":\"Yes\"},{\"name\":\"No\"}]"
 ├── question_id: int | null          # link back to parent question
 ├── quote_token: int                 # outcome_id of paired quote token
 ├── settled: 0 | 1                   # int boolean
 └── total_fills / total_volume / unique_users: aggregate stats

OutcomeToken (outcome_id: int)        # spot-token metadata, NOT same as outcome
 ├── coin: "@<spot_index>"            # spot-namespace coin (e.g. "@1")
 ├── spot_index, spot_name
 ├── deployer_fee_share, sz_decimals, wei_decimals
```

Note the **collision**: `Outcome.coin == "#NNN"` while `OutcomeToken.coin == "@NNN"` — both indexed by `outcome_id` but they're different tokens. `outcome-tokens` looks like the spot-side wrapper token; `outcomes/markets` is the prediction outcome itself. SDK should treat them as separate types (`Hip4Outcome` vs `Hip4OutcomeToken`).

`class` enum observed: `priceBinary`, `priceBucket`, and `""` (empty for "fallback" / non-parametric outcomes).

### Coin format & filter quirks

- Use `coin=#290` (URL-encoded `%23290`) where filter is supported.
- Markets / outcomes filtering is by `outcome_id`, NOT by `coin` (the latter is silently ignored — see `markets_coin__290.json` vs `markets_coin_bogus.json` — both return the same unfiltered first page). SDK should not expose `coin` on those endpoints.
- `fills`, `fees`, `analytics`, `outcome-tokens` accept `coin` correctly.
- On `analytics`, `coin=290,291` (no `#`) is accepted — server normalizes ints to `#NNN` in output. SDK can accept either `string[]` or `number[]`.

## Per-endpoint

### Market-meta family

#### GET `/hip4/markets` (and alias `/hip4/outcomes`)

Identical responses — verified by diffing baseline samples (`markets_limit_5.json` vs `outcomes_limit_5.json`). Pick one in the SDK and have the other be an alias.

- Params: `outcome_id` (int), `class` (str), `underlying` (str), `question_id` (int), `limit`, `offset`. `coin` is **silently accepted but ignored**.
- Each row: `outcome_id, coin, name, description, class, underlying, expiry, target_price, period, side_specs, question_id, quote_token, block_time, settled, question_name, question_description, total_fills, total_volume, unique_users` — 19 fields.
- Filters confirmed working: `outcome_id=290` → 1 row; `class=priceBinary` → matches; `underlying=BTC` → matches; `question_id=0` → 4 rows (the parent + named outcomes).
- Edge: `outcome_id=99999999` → `count:0, data:[]` (no 404).

#### GET `/hip4/questions`

- Params: `question_id`, `limit`, `offset`.
- Fields: `question_id, name, description, fallback_outcome, named_outcomes[], settled_named_outcomes[], updated_at`.
- `name` is often the literal `"Recurring"` — it's a series name, not unique. Use `question_id` as PK.
- All meaningful classification (`class`, `underlying`, `priceThresholds`) is embedded in `description` (pipe-delimited). SDK should ship a `parseQuestionDescription(s) -> {class, underlying, expiry, priceThresholds: number[], period}`.

#### GET `/hip4/outcome-tokens`

- Params: `outcome_id`, `coin`, `limit`, `offset`. Both filters honored (sample `outcome-tokens_outcome_id_1.json` and `outcome-tokens_coin__1.json` return the same single record).
- Fields: `outcome_id, coin (@<n>), spot_index, spot_name, deployer_fee_share, sz_decimals, wei_decimals, updated_at`.
- Spot-side mirror of an outcome (USDC=@0, PURR=@1, ...). Used to figure out on-chain spot routing per outcome.

### Trading family

#### GET `/hip4/fills`

- Params: `user`, `coin`, `outcome_id`, `start`, `end`, `limit≤1000`, `offset`.
- Fields: `user, coin, outcome_id, px, sz, side ("A"|"B"), time_ms, dir, closedPnl, hash, oid, tid, fee, feeToken, fee_usdc, typeTrade, market_name, market_description` — 17 fields.
- `dir` examples: `"Buy"`, `"Merge Outcome"` (so prediction-market combinatoric actions surface here too, despite the dedicated `/user-actions` endpoint being not_yet_live).
- `feeToken` is `"USDH"` for settled-fees or `"+<NNN>"` for outcome-token-denominated fees; `fee_usdc` always present.
- `typeTrade: "perp"` on every row — single value seen. Likely placeholder; check again when HIP-4 spot side launches.
- Time-window filter works: `start=...Z&end=...Z` (ISO-Z accepted as input).

#### GET `/hip4/fees`

- Daily aggregate per `(user, coin, date)`. Params: `user, coin, start, end, limit, offset`.
- Fields: `user, coin, feeToken, date (YYYY-MM-DD), fills, total_fee_raw, total_fee_usdc, total_notional, effective_rate`.
- `effective_rate` ≈ 0.0015 universally — looks like a flat 15 bps fee tier.

### Governance / lifecycle

#### GET `/hip4/settlements`

- Params: `outcome_id, start, end, limit, offset`.
- Fields: `outcome_id, settle_fraction (0..1 float), details, broadcaster (addr), block_time (ISO µs), block_height (int), nonce (int)`.
- `details` is a free-form string, e.g. `"price:80812.7"` — needs case-by-case parsing per `class`.
- Same outcome can appear multiple times (duplicates by nonce / block_height — outcome `20` shows up twice in the same block). Caller dedup may be required for "did this outcome settle?" — use `(outcome_id, nonce)` as PK.

#### GET `/hip4/fee-scales`

- Returns `status: "not_yet_live"` + `count:0, data:[]` + `message` + `testnet_docs`. No schema observable from mainnet today.

### Analytics

#### GET `/hip4/analytics`

- Params: `interval ∈ {1h,4h,1d}` (422 on bogus), `coin` (single or comma-sep int/`#NNN`), `outcome_id` (int), `start`, `end`, `limit≤2000`.
- Without `coin`/`outcome_id`: aggregate, fields = `bucket, fills, volume, buy_volume, sell_volume, fees_usdc, unique_users` (7).
- With `coin=290,291`: rows per `(bucket, coin)`, extra `coin` field, 8 fields total.
- With `outcome_id=290`: same as `coin=#290`, 8 fields.
- Time buckets are naive-ISO at second precision aligned to interval (`T00:00:00`, `T16:00:00`, etc).

### User actions

#### GET `/hip4/user-actions`

- Returns `status: "not_yet_live"`. Even invalid `action_type=bogus` returns 200 with the same not_yet_live payload — i.e. **validation is bypassed when the endpoint short-circuits**. SDK should still document the enum (`Split | Merge | Negate`) for future readiness.

## Validation matrix

| Test | Endpoint | Result |
|---|---|---|
| `limit=1001` | `/hip4/fills` | 422 `less_than_equal` le=1000 ✅ |
| `limit=2001` | `/hip4/analytics` | 422 le=2000 ✅ |
| `interval=bogus` | `/hip4/analytics` | 422 `literal_error` ✅ |
| `action_type=bogus` | `/hip4/user-actions` | 200 not_yet_live (validation bypassed) ⚠ |
| `coin=#290` | `/hip4/markets` | 200 unfiltered (silently ignored) ⚠ |
| `coin=bogus` | `/hip4/markets` | 200 unfiltered ⚠ |
| `outcome_id=99999999` | `/hip4/markets` | 200 empty ✅ |
| `coin=290,291` (int) | `/hip4/analytics` | 200 normalized to `#290`/`#291` ✅ |

## Open questions

- **Settlement duplicates**: outcome 20 settles twice in adjacent blocks. Is this a re-settlement / cross-validator broadcast, or a data quirk? Affects whether SDK should dedup by `outcome_id` or by `(outcome_id, nonce)`.
- **`settle_fraction != 1.0`**: all samples = 1.0. What does fractional settlement look like? Likely for `priceBucket` partial allocation — needs a sample when one fires.
- **`fee-scales` / `user-actions` schema**: blocked until mainnet launch. Should the SDK ship optimistic types from swagger comments, or wait? Recommend optimistic with `@experimental` markers.
- **`Outcome.coin == ""` rows**: how does the user trade an outcome with an empty coin ticker? Possibly meta/aggregate rows. The `outcome_id=0` row has `total_fills: 41163` so it does see volume — confirm whether trading uses a different identifier in that case.
- **`Outcome.quote_token`**: integer (e.g. `360`, `0`). Is it an `outcome_id` referencing the paired quote, or a `spot_index`? Affects how the SDK joins outcome ↔ outcome-token.
- **`typeTrade: "perp"`**: only value seen. Will spot HIP-4 fills appear here too, or on `/spot/fills`?
- **No cursor**: confirmed via inspection. Question for SDK: do we want a unified `paginate()` helper that lazily yields pages across both offset and cursor families? Probably yes — abstract `Paginator<T>` with two impls.
