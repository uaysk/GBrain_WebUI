import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AuthService } from "../server/auth";
import type { Config } from "../server/config";
import { createHttpHandler, type GraphHttpService } from "../server/http";
import type { ControlDreamRunDetail } from "../shared/contracts";

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

function config(): Config {
  return {
    db: { host: "localhost", port: 5432, database: "test", user: "test", password: "unused", schema: "public" },
    community: { resolution: 0.5, minSemanticSimilarity: 0.65, seed: 84 },
    auth: { password: "test-password", sessionSecret: "s".repeat(40), sessionHours: 12, maxAttempts: 5, attemptWindowMinutes: 15 },
    controlCenter: { mcpUrl: null, mcpToken: null, requestTimeoutMs: 1_000, cacheMs: 1_000, mutationsEnabled: false, actionLedgerPath: null },
    allowedSourceIds: ["default"],
    host: "127.0.0.1",
    port: 3000,
    trustProxyHops: 0,
    publicOrigin: null,
    rebuildMinIntervalSeconds: 0,
    rebuildStatementTimeoutSeconds: 600,
    semanticCandidateChunks: 64,
    semanticHnswEfSearch: 80,
    snapshotPath: null,
  };
}

const graph = {
  cached: null,
  status: async () => true,
  getGraph: async () => { throw new Error("unused"); },
  getSerializedGraph: async () => { throw new Error("unused"); },
  getGraphHistory: async () => { throw new Error("unused"); },
  getNodeDetail: async () => null,
  getRebuildStatus: () => ({ state: "idle", phase: "idle", startedAt: null, finishedAt: null, lastSuccessfulAt: null, snapshotAvailable: false, error: null }),
  startRebuild: () => ({ accepted: true, status: { state: "running", phase: "loading-pages", startedAt: null, finishedAt: null, lastSuccessfulAt: null, snapshotAvailable: false, error: null } }),
} as GraphHttpService;

describe("side-effect-free HTTP handler", () => {
  test("serves only GET/HEAD static files and caches only hashed assets immutably", async () => {
    const dist = await mkdtemp(join(tmpdir(), "gbrain-http-"));
    directories.push(dist);
    await mkdir(join(dist, "assets"));
    await writeFile(join(dist, "index.html"), "<main>app</main>");
    await writeFile(join(dist, "assets", "app-AbCd1234.js"), "hashed");
    await writeFile(join(dist, "assets", "plain.js"), "plain");
    const appConfig = config();
    const auth = new AuthService(appConfig.auth);
    const handler = createHttpHandler({
      config: appConfig,
      graph,
      auth,
      controlCenter: {
        getOverview: async () => { throw new Error("unused"); },
        getDreamRunDetail: () => ({ status: "unavailable" }),
        invalidate: () => undefined,
      },
      controlActions: { enabled: false, execute: async () => { throw new Error("unused"); } },
      distPath: dist,
      environment: "production",
    });
    const login = await handler(new Request("https://example.test/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Origin: "https://example.test" },
      body: new URLSearchParams({ password: appConfig.auth.password }),
    }), { address: "127.0.0.1", secure: true });
    const cookie = login.headers.get("set-cookie")!.split(";", 1)[0]!;
    const headers = { Cookie: cookie, Accept: "text/html" };

    const html = await handler(new Request("https://example.test/control", { headers }), { address: "127.0.0.1", secure: true });
    expect(html.headers.get("cache-control")).toBe("no-cache");
    expect(await html.text()).toContain("app");

    const hashed = await handler(new Request("https://example.test/assets/app-AbCd1234.js", { headers: { Cookie: cookie } }), { address: "127.0.0.1", secure: true });
    expect(hashed.headers.get("cache-control")).toContain("immutable");
    const plain = await handler(new Request("https://example.test/assets/plain.js", { headers: { Cookie: cookie } }), { address: "127.0.0.1", secure: true });
    expect(plain.headers.get("cache-control")).toBe("no-cache");

    const head = await handler(new Request("https://example.test/assets/app-AbCd1234.js", { method: "HEAD", headers: { Cookie: cookie } }), { address: "127.0.0.1", secure: true });
    expect(await head.text()).toBe("");
    expect(head.headers.get("content-length")).toBe(String("hashed".length));
    const post = await handler(new Request("https://example.test/assets/app-AbCd1234.js", { method: "POST", headers: { Cookie: cookie } }), { address: "127.0.0.1", secure: true });
    expect(post.status).toBe(405);
  });

  test("serves Dream details from the Control snapshot with 400/404/503 boundaries", async () => {
    const appConfig = config();
    const auth = new AuthService(appConfig.auth);
    let overviewCalls = 0;
    let detailCalls = 0;
    const detail: ControlDreamRunDetail = {
      snapshotGeneratedAt: "2026-07-31T00:00:00.000Z",
      stale: false,
      run: {
        id: 3,
        name: "autopilot-cycle",
        label: "Dream · Source cycle",
        jobStatus: "completed",
        reportStatus: "ok",
        sourceId: "default",
        startedAt: null,
        finishedAt: null,
        durationMs: 0,
        partial: false,
        phases: [],
        impacts: [],
        warnings: [],
      },
      previousRun: null,
      comparison: { metrics: [] },
      findings: [],
      affectedPages: { items: [], total: 0, truncated: false, coverage: "complete" },
    };
    const handler = createHttpHandler({
      config: appConfig,
      graph,
      auth,
      controlCenter: {
        getOverview: async () => {
          overviewCalls += 1;
          throw new Error("Dream detail must not poll");
        },
        getDreamRunDetail: (jobId) => {
          detailCalls += 1;
          if (jobId === 1) return { status: "unavailable" };
          if (jobId === 2) return { status: "not-found" };
          return { status: "ok", detail };
        },
        invalidate: () => undefined,
      },
      controlActions: { enabled: false, execute: async () => { throw new Error("unused"); } },
    });
    const login = await handler(new Request("https://example.test/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Origin: "https://example.test" },
      body: new URLSearchParams({ password: appConfig.auth.password }),
    }), { address: "127.0.0.1", secure: true });
    const cookie = login.headers.get("set-cookie")!.split(";", 1)[0]!;
    const request = (path: string) => handler(
      new Request(`https://example.test${path}`, { headers: { Cookie: cookie } }),
      { address: "127.0.0.1", secure: true },
    );

    expect((await request("/api/control-center/dream-runs/not-a-number")).status).toBe(400);
    expect((await request("/api/control-center/dream-runs/0")).status).toBe(400);
    expect((await request("/api/control-center/dream-runs/1")).status).toBe(503);
    expect((await request("/api/control-center/dream-runs/2")).status).toBe(404);
    const found = await request("/api/control-center/dream-runs/3");
    expect(found.status).toBe(200);
    expect(await found.json()).toEqual(detail);
    expect(overviewCalls).toBe(0);
    expect(detailCalls).toBe(3);
  });
});
