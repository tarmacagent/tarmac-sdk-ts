import {
  TarmacToolError,
  type ExecutionMode,
  type FinishResult,
  type TarmacTools,
  type ToolErrorBody,
  type ToolName,
} from "./types.ts";

export * from "./types.ts";

/** Anything that can carry a tool call to the simulation. */
export type ToolTransport = (tool: ToolName, input: unknown) => Promise<unknown>;

/** Builds the typed tool surface on top of a transport. Shared by the demo agent and the HTTP client. */
export function toolsFromTransport(call: ToolTransport): TarmacTools {
  return {
    getContext: () => call("get_context", {}) as never,
    getBalances: () => call("get_balances", {}) as never,
    getQuote: (input) => call("get_quote", input) as never,
    requestSwap: (input) => call("request_swap", input) as never,
    finish: (input) => call("finish", input) as never,
  };
}

export interface StartRunOptions {
  /** "swap-normal" or "swap-thin". */
  scenario: "swap-normal" | "swap-thin";
  /** Token to buy with USDG: "WETH" or "NVDA". Defaults to WETH. */
  token?: "WETH" | "NVDA";
  /** "fixture" works everywhere. "fork" requires a server with a fork worker configured. */
  mode?: ExecutionMode;
  /** A short name for your agent, shown in the trace. */
  agentName: string;
  policy?: { maxSlippageBps?: number; spendCapUsdg?: number; deadlineSeconds?: number };
}

export interface RunSession {
  runId: string;
  /** Link that opens this run in the browser. The credential is in the URL fragment and never sent to the server in logs. */
  runUrl: string;
  /** Scoped run credential. Valid for this run only. Keep it out of shared logs. */
  runToken: string;
  tools: TarmacTools;
  /** Fetch the current run record (status, verdict, trace). */
  getRun(): Promise<RunView>;
}

export interface RunView {
  id: string;
  status: string;
  result?: { verdict: string; verdictLabel: string; reason: string } | null;
  [key: string]: unknown;
}

export interface TarmacClientOptions {
  /** e.g. http://localhost:3000 */
  baseUrl: string;
  fetch?: typeof fetch;
  /** How many times to retry a transient failure. Defaults to 2; 0 disables retries. */
  retries?: number;
  /** Base delay before the first retry, doubled each attempt. Defaults to 500 ms. */
  backoffMs?: number;
}

/** Tools that only read state, so a network failure can be retried without side effects. */
const READ_ONLY_TOOLS: ReadonlySet<ToolName> = new Set<ToolName>(["get_context", "get_balances", "get_quote"]);
/** Statuses where the server rejected the request before doing any work. */
const REJECTED_BEFORE_WORK = new Set([429, 503]);

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function createTarmacClient(options: TarmacClientOptions) {
  const base = options.baseUrl.replace(/\/$/, "");
  const rawFetch = options.fetch ?? fetch;
  const retries = Math.max(0, options.retries ?? 2);
  const backoffMs = Math.max(0, options.backoffMs ?? 500);

  /**
   * fetch with retries. A request the server rejected before doing any work (429/503 marked
   * retryable) is always safe to retry. A network failure is retried only when `idempotent`:
   * a swap request that timed out may already have run, so it is never sent twice.
   */
  async function doFetch(url: string, init: RequestInit = {}, idempotent = false): Promise<Response> {
    for (let attempt = 0; ; attempt++) {
      let res: Response;
      try {
        res = await rawFetch(url, init);
      } catch (e) {
        if (attempt < retries && idempotent) {
          await sleep(backoffMs * 2 ** attempt);
          continue;
        }
        throw new TarmacToolError("NETWORK_ERROR", e instanceof Error ? e.message : String(e), true);
      }
      if (attempt < retries && REJECTED_BEFORE_WORK.has(res.status)) {
        const body = (await res.clone().json().catch(() => null)) as ToolErrorBody | null;
        if (body?.error?.retryable) {
          await sleep(backoffMs * 2 ** attempt);
          continue;
        }
      }
      return res;
    }
  }

  async function json<T>(res: Response): Promise<T> {
    const body = (await res.json().catch(() => null)) as unknown;
    if (!res.ok) {
      const err = (body as ToolErrorBody | null)?.error;
      throw new TarmacToolError(err?.code ?? `HTTP_${res.status}`, err?.message ?? res.statusText, err?.retryable ?? false);
    }
    return body as T;
  }

  return {
    async startRun(opts: StartRunOptions): Promise<RunSession> {
      const res = await doFetch(`${base}/api/runs`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          scenarioId: opts.scenario,
          token: opts.token ?? "WETH",
          mode: opts.mode ?? "fixture",
          agent: { kind: "external", name: opts.agentName },
          policy: opts.policy ?? {},
        }),
      });
      const created = await json<{ run: RunView; runToken: string; runUrl: string }>(res);
      return session(created.run.id, created.runToken, `${base}${created.runUrl}`);
    },

    /** Attach to a run created elsewhere (e.g. "Your agent" in the Tarmac app) using its run credential. */
    attach(runId: string, runToken: string): RunSession {
      return session(runId, runToken, `${base}/runs/${runId}#token=${runToken}`);
    },
  };

  function session(runId: string, token: string, runUrl: string): RunSession {
      const auth = { authorization: `Bearer ${token}` };

      const transport: ToolTransport = async (tool, input) => {
        const r = await doFetch(`${base}/api/runs/${runId}/tools/${tool}`, {
          method: "POST",
          headers: { "content-type": "application/json", ...auth },
          body: JSON.stringify(input ?? {}),
        }, READ_ONLY_TOOLS.has(tool));
        return json(r);
      };

      return {
        runId,
        runToken: token,
        runUrl,
        tools: toolsFromTransport(transport),
        getRun: async () => (await json<{ run: RunView }>(await doFetch(`${base}/api/runs/${runId}`, { headers: auth }, true))).run,
      };
  }
}

export type TarmacClient = ReturnType<typeof createTarmacClient>;

/**
 * Convenience wrapper: start a run, hand the tools to your agent, and make sure
 * the run is finished even if your agent throws.
 */
export async function runAgent(
  client: TarmacClient,
  opts: StartRunOptions | { runId: string; runToken: string },
  agent: (tools: TarmacTools) => Promise<void>,
): Promise<{ session: RunSession; run: RunView; finish: FinishResult | null }> {
  const session = "runToken" in opts ? client.attach(opts.runId, opts.runToken) : await client.startRun(opts);
  let finish: FinishResult | null = null;
  const tools: TarmacTools = {
    ...session.tools,
    finish: async (input) => (finish = await session.tools.finish(input)),
  };
  try {
    await agent(tools);
  } finally {
    if (!finish) {
      finish = await session.tools
        .finish({ outcome: "stopped", summary: "Agent returned without calling finish." })
        .catch(() => null);
    }
  }
  return { session, run: await session.getRun(), finish };
}
