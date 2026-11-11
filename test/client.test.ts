import { describe, expect, it } from "vitest";
import { TarmacToolError, createTarmacClient, runAgent, toolsFromTransport } from "../src/index.ts";

type Call = { url: string; method: string; headers: Record<string, string>; body: unknown };

/** In-memory stand-in for a Tarmac server: records every request. */
function fakeServer() {
  const calls: Call[] = [];
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const headers = Object.fromEntries(new Headers(init?.headers).entries());
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ url, method: init?.method ?? "GET", headers, body });
    const json = (status: number, payload: unknown) => new Response(JSON.stringify(payload), { status, headers: { "content-type": "application/json" } });
    if (url.endsWith("/api/runs") && init?.method === "POST")
      return json(201, { run: { id: "run_abcdefghijkmnpqr", status: "running" }, runToken: "trt_secret_token_value_1234", runUrl: "/runs/run_abcdefghijkmnpqr#token=trt_secret_token_value_1234" });
    if (url.includes("/tools/get_quote")) return json(422, { error: { code: "UNSUPPORTED_TOKEN", message: "USDG → WETH only.", retryable: false } });
    if (url.includes("/tools/finish")) return json(200, { runId: "run_abcdefghijkmnpqr", status: "completed", verdict: "stopped" });
    if (url.includes("/tools/")) return json(200, { ok: true });
    if (url.endsWith("/api/runs/run_abcdefghijkmnpqr")) return json(200, { run: { id: "run_abcdefghijkmnpqr", status: "completed", result: { verdict: "stopped" } } });
    return json(404, { error: { code: "NOT_FOUND", message: "nope", retryable: false } });
  }) as typeof fetch;
  return { calls, fetchImpl };
}

describe("createTarmacClient", () => {
  it("starts a run and sends the scoped credential on every tool call", async () => {
    const { calls, fetchImpl } = fakeServer();
    const client = createTarmacClient({ baseUrl: "http://tarmac.test/", fetch: fetchImpl });
    const s = await client.startRun({ scenario: "swap-thin", agentName: "unit" });
    expect(s.runId).toBe("run_abcdefghijkmnpqr");
    expect(s.runUrl).toBe("http://tarmac.test/runs/run_abcdefghijkmnpqr#token=trt_secret_token_value_1234");
    expect(calls[0]!.body).toMatchObject({ scenarioId: "swap-thin", token: "WETH", mode: "fixture", agent: { kind: "external", name: "unit" } });
    await s.tools.getBalances();
    expect(calls[1]!.url).toBe("http://tarmac.test/api/runs/run_abcdefghijkmnpqr/tools/get_balances");
    expect(calls[1]!.headers.authorization).toBe("Bearer trt_secret_token_value_1234");
  });

  it("turns error bodies into typed TarmacToolError", async () => {
    const { fetchImpl } = fakeServer();
    const s = createTarmacClient({ baseUrl: "http://tarmac.test", fetch: fetchImpl }).attach("run_abcdefghijkmnpqr", "trt_secret_token_value_1234");
    const err = await s.tools.getQuote({ tokenIn: "0x1", tokenOut: "0x2", amountIn: "1" } as never).catch((e) => e);
    expect(err).toBeInstanceOf(TarmacToolError);
    expect(err).toMatchObject({ code: "UNSUPPORTED_TOKEN", retryable: false });
  });
});

describe("runAgent", () => {
  it("finishes the run even if the agent throws", async () => {
    const { calls, fetchImpl } = fakeServer();
    const client = createTarmacClient({ baseUrl: "http://tarmac.test", fetch: fetchImpl });
    await expect(
      runAgent(client, { runId: "run_abcdefghijkmnpqr", runToken: "trt_secret_token_value_1234" }, async () => {
        throw new Error("agent crashed");
      }),
    ).rejects.toThrow("agent crashed");
    expect(calls.some((c) => c.url.endsWith("/tools/finish"))).toBe(true);
  });

  it("returns the final run record", async () => {
    const { fetchImpl } = fakeServer();
    const client = createTarmacClient({ baseUrl: "http://tarmac.test", fetch: fetchImpl });
    const { run, finish } = await runAgent(client, { scenario: "swap-normal", agentName: "unit" }, async (tools) => {
      await tools.finish({ outcome: "stopped" });
    });
    expect(finish?.verdict).toBe("stopped");
    expect(run.status).toBe("completed");
  });
});

describe("toolsFromTransport", () => {
  it("maps methods to tool names", async () => {
    const seen: string[] = [];
    const tools = toolsFromTransport(async (tool) => (seen.push(tool), {}));
    await tools.getContext();
    await tools.getBalances();
    await tools.getQuote({} as never);
    await tools.requestSwap({} as never);
    await tools.finish({ outcome: "stopped" });
    expect(seen).toEqual(["get_context", "get_balances", "get_quote", "request_swap", "finish"]);
  });
});
