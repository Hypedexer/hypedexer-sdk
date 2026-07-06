# @hypedexer/sdk examples

Runnable snippets that exercise the main flows of `@hypedexer/sdk`. Everything
here uses the workspace copy of the SDK, so any local edit to
`packages/sdk/src` is picked up without a publish.

## Prerequisites

```bash
pnpm install                       # installs the workspace, wires @hypedexer/sdk in
export HYPEDEXER_API_KEY=hl_live_… # your key from https://app.hypedexer.com
```

## Available scripts

| Script                         | What it does                                                          |
| ------------------------------ | --------------------------------------------------------------------- |
| `pnpm --filter @hypedexer/examples run example:fills`        | Paginates `/fills/` with `iterate()`.                |
| `pnpm --filter @hypedexer/examples run example:profile`      | Fetches a user's overview + top coins (parallel).    |
| `pnpm --filter @hypedexer/examples run example:hip3`         | Lists HIP-3 dexs and dives into `xyz:*` assets.      |
| `pnpm --filter @hypedexer/examples run example:liquidations` | Recent liquidations + filter on `xyz:AAPL`.          |
| `pnpm --filter @hypedexer/examples run example:websocket`    | Subscribes to `completed_trades` for 15 seconds.     |
| `pnpm --filter @hypedexer/examples run example:errors`       | Triggers each SDK error class and narrows on it.     |

Pass `HL_USER=0x…` to `profile` to target a different address.

## Notes

- The WebSocket example needs the `ws` peer dep, which is already declared in
  this workspace package.
- HIP-3 tickers (`xyz:AAPL`, `cash:GOLD`, …) pass through the API surface
  as-is — no encoding required.
- Error handling covers every branch of the SDK's typed hierarchy — see
  `06-error-handling.ts` for the full tree.
