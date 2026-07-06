# AGENTS.md

Guidance for AI coding agents working on `Hypedexer/hypedexer-sdk`. This file is scoped to **repository contribution** — for agents *using* `@hypedexer/sdk` from another codebase, read [`packages/sdk/AGENTS.md`](./packages/sdk/AGENTS.md) instead.

## Repository shape

pnpm workspace monorepo. Single published package + runnable examples.

```
packages/sdk/    # @hypedexer/sdk — the published package (see packages/sdk/AGENTS.md for usage)
examples/        # runnable scripts; workspace:* dep on the sdk
PLAN.md          # design doc — envelope strategy + upstream quirks audit
ENDPOINTS.md     # endpoint inventory
TYPES.md         # type-shape reference
```

## Setup

Requires **Node ≥ 20.18** and **pnpm ≥ 10** (pinned via `packageManager` in `package.json`). Do NOT `npm install` or `yarn install` — the lockfile is pnpm.

```bash
pnpm install --frozen-lockfile
```

## Verification loop

Run **all four** before proposing any change. `pnpm check` runs them in sequence:

```bash
pnpm --filter @hypedexer/sdk typecheck    # tsc --noEmit, strict + exactOptionalPropertyTypes
pnpm --filter @hypedexer/sdk test         # vitest, 501+ tests, expects zero failures
pnpm --filter @hypedexer/sdk build        # tsup, produces dist/index.{js,cjs,d.ts,d.cts}
pnpm lint                                 # biome check .
```

Do NOT skip tests. If a test file needs updating, update it in the same commit as the source change.

## Commit conventions (enforced by hooks)

Commit-msg hook rejects anything that doesn't match. There is no grace period.

| Rule | Details |
|---|---|
| **Conventional Commits** | `type(scope): subject` — types: `feat`, `fix`, `refactor`, `perf`, `docs`, `test`, `chore`, `build`, `ci`, `revert`. Scopes: `sdk`, `docs`, `ci`, `repo`, `deps`, `release`. Subject lowercase. Body wrapped at 100 chars. |
| **No AI co-author trailer** | Husky rejects any `Co-Authored-By:` matching `claude`, `copilot`, `gpt`, `cursor.sh`, `aider`, `cline`, `devin`, `codeium`, `noreply@anthropic.com`, `noreply@openai.com`. Do not add one. |
| **No em-dash in messages** | Use `-` or `—` sparingly; the maintainer bans `—` project-wide. Use hyphens or restructure the sentence. |
| **Direct push to `main`** | This repo does not use feature branches or PRs. Commit + push straight to `main`. Do NOT create a branch or open a PR. |

## Codebase rules

- **Comments in English only**, regardless of the chat language. This includes JSDoc.
- **Do not write new comments unless the *why* is non-obvious.** Well-named identifiers explain the *what*. Explanations of task context ("added for the X flow") do not belong in code — put them in the commit body.
- **ESM imports must include the `.js` extension** — TypeScript is `--moduleResolution NodeNext`. `import { x } from './foo.js'`, never `./foo`.
- **`biome` handles formatting.** `lint-staged` runs on commit. If Biome auto-fixes something in your commit, the fix stays.
- **`console` is banned in `packages/sdk/src/`** (`noConsole` biome rule). `console.warn` / `console.error` are allowed. Consumers should not see stdout noise from importing the SDK. `examples/` has an override that permits `console`.
- **`any` is banned.** Use `unknown` and narrow. A local `// biome-ignore lint/suspicious/noExplicitAny: <reason>` is acceptable only at boundaries with untyped peer deps (`ws`).

## Release process

Only apply this section when the user explicitly asks to publish.

1. Bump `packages/sdk/package.json:version` and `packages/sdk/CHANGELOG.md`. Commit as `chore(release): sdk vX.Y.Z-…`.
2. Tag: `git tag vX.Y.Z-…`.
3. Push: `git push origin main && git push origin vX.Y.Z-…`.
4. The `release.yml` workflow runs lint → typecheck → test → build → verifies tag matches version → publishes with `--provenance`. Prereleases (contain `-`) land under `beta` dist-tag; stable versions on `latest`.
5. Never skip provenance (`NPM_CONFIG_PROVENANCE=true`) — the repo is public and the trust chain depends on it.

## Design references

- [`PLAN.md`](./PLAN.md) — canonical design doc. **Read it before adding a resource or changing envelope handling.** §B covers the three response families; §I catalogs the 25 upstream quirks the SDK defends against with rationale for each defense.
- [`ENDPOINTS.md`](./ENDPOINTS.md) — endpoint inventory.
- [`TYPES.md`](./TYPES.md) — canonical type-shape reference.

## Boundaries — do not touch without approval

- `.github/workflows/release.yml` — publishes to npm. Do NOT modify unless asked. If a release-related fix is needed, propose the diff and ask.
- `packages/sdk/dist/` — build output, git-ignored. Never commit.
- `.husky/*` — commit-msg + pre-commit hooks. Do not disable or `--no-verify` a commit; if a hook fails, fix the underlying issue.
- `PLAN.md` — design doc. Update it if you're changing a design decision, but do not silently rewrite it.

## Common pitfalls

- **Adding a new endpoint** — check `PLAN.md §I` first: the endpoint may be broken upstream and require a specific defensive posture, not a naive `unwrap()`. Reference `packages/sdk/AGENTS.md` for the resource pattern to follow.
- **Envelope family confusion** — three families exist (`apiResponse`, `bare`, `hip4`). Pass the correct one to `unwrap(raw, family)` — the wrong family silently produces `data: []`.
- **Pagination kind confusion** — resources use one of `cursor` / `offset` / `timeWindow` / `none`. The upstream endpoint dictates which; check the sibling resource before adding an iterator.
- **String-encoded numerics** — `fundingRate`, `premium`, `value_wei`, `amount_raw` come as strings for precision. Use `parseFundingRate`, `toBigInt`, `toNumber` (see `transport/numbers.ts`). Do not cast to `number` directly.
- **Address handling** — never accept `string`; use the `Address` branded type. `assertAddress(value, paramName)` throws `ValidationError` with a populated `detail[]` — reuse it.

## When in doubt

Read the sibling resource. Every existing resource in `packages/sdk/src/resources/` follows the same pattern (params → query builder → `http.request` → `unwrap` or `unwrapSingle` → typed row). Match it.
