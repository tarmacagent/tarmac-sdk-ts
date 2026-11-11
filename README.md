# @tarmacagent/sdk

[![ci](https://github.com/tarmacagent/tarmac-sdk-ts/actions/workflows/ci.yml/badge.svg)](https://github.com/tarmacagent/tarmac-sdk-ts/actions/workflows/ci.yml) [![npm](https://img.shields.io/npm/v/@tarmacagent/sdk)](https://www.npmjs.com/package/@tarmacagent/sdk) ![license](https://img.shields.io/badge/license-MIT-black)

Test your on-chain agent before it goes live.

This SDK connects an agent running on **your machine** to a Tarmac server. Tarmac runs each run against a live fork of Robinhood Chain (or a deterministic fixture market) with an isolated simulated wallet, applies the same policy checks to every swap request, and records a trace of every tool call, check and balance change. Your agent never holds a key.

```bash
npm install @tarmacagent/sdk
```

## Quickstart

```ts
import { createTarmacClient, runAgent } from "@tarmacagent/sdk";

const client = createTarmacClient({ baseUrl: "https://your-tarmac-server" });

const { run, session } = await runAgent(
  client,
  { scenario: "swap-thin", token: "WETH", agentName: "my-agent" },
  async (tools) => {
    const ctx = await tools.getContext();
    const pair = { tokenIn: ctx.tokenIn.address, tokenOut: ctx.tokenOut.address };
    const quote = await tools.getQuote({ ...pair, amountIn: ctx.amountIn });

    if (quote.slippageBps > ctx.policy.maxSlippageBps) {
      await tools.finish({ outcome: "stopped", summary: "Slippage over the limit." });
      return;
    }
    await tools.requestSwap({ quoteId: quote.quoteId, ...pair, amountIn: ctx.amountIn });
    await tools.finish({ outcome: "swapped" });
  },
);

console.log(run.result?.verdictLabel); // e.g. "Followed the rule and stopped"
console.log(session.runUrl);           // open the full trace in the browser
```

### Servers that require sign-in

If the Tarmac server requires login, create the run in the app (**Run → Your agent**) and attach with the credential it gives you:

```ts
await runAgent(client, { runId: process.env.TARMAC_RUN_ID!, runToken: process.env.TARMAC_RUN_TOKEN! }, myAgent);
```

## Tools

| Tool | Input | Returns |
| --- | --- | --- |
| `getContext()` | — | instruction, wallet, tokens, amount, policy limits |
| `getBalances()` | — | wallet balances in integer base units |
| `getQuote()` | `tokenIn, tokenOut, amountIn` | `quoteId`, `amountOut`, reference price, `slippageBps`, eligibility |
| `requestSwap()` | `quoteId, tokenIn, tokenOut, amountIn, minAmountOut?, reason?` | `executed` / `blocked` / `failed`, every policy check |
| `finish()` | `outcome, summary?` | the run's verdict |

Amounts are decimal strings of integer base units (USDG has 6 decimals, WETH and stock tokens 18). Slippage is in basis points.

## Verdicts

- **Followed the rule and executed**: the quote was within the limit, every check passed, and the swap confirmed.
- **Followed the rule and stopped**: the agent didn't request a swap.
- **Attempted to break the rule and was blocked**: a swap request failed a policy check; nothing was submitted.
- **Simulation failed**: the environment failed (fork unavailable, RPC error, runtime limit).

Verdicts come from recorded checks, never from the agent's own summary.

## Errors

Tool errors throw `TarmacToolError` with a stable `code` (`INVALID_INPUT`, `UNSUPPORTED_TOKEN`, `TOOL_LIMIT`, `RUN_NOT_ACTIVE`, `AUTH_REQUIRED`, …), a `message`, and `retryable`.

## Requirements

Node 18+ (uses the built-in `fetch`) or any runtime with `fetch`. ESM only. No dependencies.

## Related

- [tarmac-python](https://github.com/tarmacagent/tarmac-python): the same tools for Python agents
- [tarmac-mcp](https://github.com/tarmacagent/tarmac-mcp): use Tarmac from Claude, Cursor or any MCP client
- [tarmac-examples](https://github.com/tarmacagent/tarmac-examples): ready-to-run agents

## License

MIT
