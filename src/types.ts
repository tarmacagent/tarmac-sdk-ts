/**
 * The Tarmac tool contract.
 *
 * Every agent — the bundled demo agent and any external agent using this SDK —
 * talks to the simulation through exactly these tools. Amounts are integer
 * base units encoded as decimal strings. Slippage is expressed in basis points.
 */

export type ToolName = "get_context" | "get_balances" | "get_quote" | "request_swap" | "finish";

export const TOOL_NAMES: readonly ToolName[] = [
  "get_context",
  "get_balances",
  "get_quote",
  "request_swap",
  "finish",
] as const;

export type ExecutionMode = "fixture" | "fork";
export type MarketCondition = "normal" | "thin";

export interface TokenInfo {
  symbol: string;
  address: `0x${string}`;
  decimals: number;
}

export interface RunContext {
  runId: string;
  mode: ExecutionMode;
  /** Plain-language instruction the agent was given. */
  instruction: string;
  chain: { id: number; name: string };
  venue: { name: string; router: `0x${string}` };
  wallet: { address: `0x${string}`; label: string };
  tokenIn: TokenInfo;
  tokenOut: TokenInfo;
  /** Amount the instruction asks to swap, in base units of tokenIn. */
  amountIn: string;
  policy: PolicyLimits;
}

export interface PolicyLimits {
  version: string;
  /** Maximum allowed slippage versus the reference price, in basis points. */
  maxSlippageBps: number;
  /** Maximum spend per swap, in base units of tokenIn. */
  spendCap: string;
  /** Maximum seconds between submission and the transaction deadline. */
  deadlineSeconds: number;
  /** How slippage is measured. */
  slippageReference: string;
}

export interface BalanceEntry {
  symbol: string;
  address: `0x${string}` | "native";
  decimals: number;
  raw: string;
  formatted: string;
}

export interface BalancesResult {
  wallet: `0x${string}`;
  block: string | null;
  balances: BalanceEntry[];
}

export interface QuoteInput {
  tokenIn: `0x${string}`;
  tokenOut: `0x${string}`;
  amountIn: string;
}

export interface QuoteResult {
  quoteId: string;
  tokenIn: `0x${string}`;
  tokenOut: `0x${string}`;
  amountIn: string;
  amountOut: string;
  venue: { name: string; pool: string; feeBps: number };
  reference: {
    description: string;
    /** Output at the reference mid price, before fees and price impact. */
    amountOut: string;
    /** Human-readable reference price, tokenIn per tokenOut. */
    price: string;
  };
  /** (reference.amountOut - amountOut) / reference.amountOut, in bps, rounded up. */
  slippageBps: number;
  policy: { maxSlippageBps: number; eligible: boolean };
  block: string | null;
  expiresAt: string;
}

export interface SwapRequest {
  quoteId: string;
  tokenIn: `0x${string}`;
  tokenOut: `0x${string}`;
  amountIn: string;
  /** Optional. Tarmac raises it to the policy minimum if lower. */
  minAmountOut?: string;
  /** Optional. Must equal the simulated wallet if provided. */
  recipient?: `0x${string}`;
  /** Optional. Must equal the configured router if provided. */
  router?: `0x${string}`;
  /** Optional free-text reason. Recorded, never used for policy decisions. */
  reason?: string;
}

export interface PolicyCheck {
  id: string;
  label: string;
  passed: boolean;
  expected: string;
  actual: string;
}

export interface SwapResult {
  status: "executed" | "blocked" | "failed";
  checks: PolicyCheck[];
  /** Present when status is "blocked" or "failed". */
  reason?: string;
  execution?: {
    amountIn: string;
    amountOut: string;
    minAmountOut: string;
    deadline: string;
    /** Simulated transaction hash (fork mode) or fixture receipt id. */
    reference: string;
    referenceKind: "fork-tx" | "fixture-receipt";
    gasUsed: string | null;
  };
}

export interface FinishInput {
  /** What the agent believes it did. Recorded as an unverified note. */
  outcome: "swapped" | "stopped";
  summary?: string;
}

export interface FinishResult {
  runId: string;
  status: string;
  verdict: Verdict | null;
}

export type Verdict = "executed" | "stopped" | "blocked" | "failed";

export interface TarmacTools {
  getContext(): Promise<RunContext>;
  getBalances(): Promise<BalancesResult>;
  getQuote(input: QuoteInput): Promise<QuoteResult>;
  requestSwap(input: SwapRequest): Promise<SwapResult>;
  finish(input: FinishInput): Promise<FinishResult>;
}

/** Error returned by the tool interface. `code` is stable; `message` is human-readable. */
export interface ToolErrorBody {
  error: { code: string; message: string; retryable: boolean };
}

export class TarmacToolError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly retryable = false,
  ) {
    super(message);
    this.name = "TarmacToolError";
  }
}
