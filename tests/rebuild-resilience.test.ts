import { afterEach, describe, expect, spyOn, test } from "bun:test";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Sql } from "postgres";
import { GraphService } from "../server/graph";
import type { GraphBuildExecutor } from "../server/graph-build-executor";
import { SnapshotStore } from "../server/snapshot-store";
import type { Config } from "../server/config";
import type { GraphResponse } from "../src/types";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

function config(snapshotPath: string): Config {
  return {
    db: { host: "localhost", port: 5432, database: "test", user: "test", password: "not-used", schema: "public" },
    community: { resolution: 0.5, minSemanticSimilarity: 0.65, seed: 84 },
    auth: { password: "not-used", sessionSecret: "x".repeat(32), sessionHours: 12, maxAttempts: 5, attemptWindowMinutes: 15 },
    controlCenter: {
      mcpUrl: null,
      mcpToken: null,
      requestTimeoutMs: 10_000,
      cacheMs: 10_000,
      mutationsEnabled: false,
      actionLedgerPath: null,
    },
    allowedSourceIds: ["default"], host: "127.0.0.1", port: 3000, trustProxyHops: 0, publicOrigin: null,
    rebuildMinIntervalSeconds: 0, rebuildStatementTimeoutSeconds: 600,
    semanticCandidateChunks: 64, semanticHnswEfSearch: 80, snapshotPath,
  };
}

function graph(generatedAt: string): GraphResponse {
  return {
    generatedAt,
    nodes: [], explicitEdges: [], semanticEdges: [], semanticGroups: [],
    communityDetection: {
      engine: "leiden", resolution: 0.5, modularity: 0, communityCount: 0,
      weightedEdgeCount: 0, isolatedCount: 0, minSemanticSimilarity: 0.65,
    },
    counts: {
      pages: 0, chunks: 0, links: 0, explicitEdges: 0, semanticEdges: 0,
      embeddedPages: 0, unembeddedPages: 0, unclassifiedPages: 0, embeddingCoverage: 0,
    },
    layout: { engine: "umap", scalableThreshold: 2_000 },
  };
}

type BuildResult = { graph: GraphResponse; historyPages: [] };
type TestableGraphService = { build: () => Promise<BuildResult> };

async function waitForTerminalState(service: GraphService): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (service.getRebuildStatus().state !== "running") return;
    await Bun.sleep(5);
  }
  throw new Error("Timed out waiting for graph rebuild");
}

describe("graph rebuild resilience", () => {
  test("atomically persists a successful snapshot and restores it on initialization", async () => {
    const directory = await mkdtemp(join(tmpdir(), "gbrain-snapshot-"));
    temporaryDirectories.push(directory);
    const snapshotPath = join(directory, "graph.json");
    const expected = graph("2026-07-19T05:00:00.000Z");
    const service = new GraphService(null as unknown as Sql, config(snapshotPath));
    (service as unknown as TestableGraphService).build = async () => ({ graph: expected, historyPages: [] });

    expect(service.startRebuild().accepted).toBe(true);
    await waitForTerminalState(service);
    expect(service.getRebuildStatus()).toMatchObject({ state: "succeeded", snapshotAvailable: true });
    expect(service.cached).toEqual(expected);
    expect((await stat(snapshotPath)).mode & 0o777).toBe(0o600);
    expect(JSON.parse(await readFile(snapshotPath, "utf8"))).toMatchObject({ version: 1, graph: expected });

    const restored = new GraphService(null as unknown as Sql, config(snapshotPath));
    await restored.initialize();
    expect(restored.cached).toEqual(expected);
    expect(restored.getRebuildStatus()).toMatchObject({ state: "idle", snapshotAvailable: true, lastSuccessfulAt: expected.generatedAt });
  });

  test("keeps the last successful snapshot when a later rebuild fails", async () => {
    const directory = await mkdtemp(join(tmpdir(), "gbrain-snapshot-"));
    temporaryDirectories.push(directory);
    const snapshotPath = join(directory, "graph.json");
    const expected = graph("2026-07-19T05:00:00.000Z");
    const service = new GraphService(null as unknown as Sql, config(snapshotPath));
    (service as unknown as TestableGraphService).build = async () => ({ graph: expected, historyPages: [] });
    service.startRebuild();
    await waitForTerminalState(service);

    const errorLog = spyOn(console, "error").mockImplementation(() => undefined);
    (service as unknown as TestableGraphService).build = async () => { throw new Error("simulated database outage"); };
    service.startRebuild();
    await waitForTerminalState(service);
    errorLog.mockRestore();

    expect(service.cached).toEqual(expected);
    expect(service.getRebuildStatus()).toMatchObject({ state: "failed", snapshotAvailable: true, lastSuccessfulAt: expect.any(String) });
    expect(service.getRebuildStatus().error).not.toContain("simulated database outage");
    expect(JSON.parse(await readFile(snapshotPath, "utf8"))).toMatchObject({ version: 1, graph: expected });
  });

  test("does not activate an unpersisted result when durable storage fails", async () => {
    const directory = await mkdtemp(join(tmpdir(), "gbrain-snapshot-"));
    temporaryDirectories.push(directory);
    const snapshotPath = join(directory, "graph.json");
    class SwitchableStore extends SnapshotStore {
      fail = false;
      override async persist(result: BuildResult): Promise<void> {
        if (this.fail) throw new Error("simulated fsync failure");
        await super.persist(result);
      }
    }
    const store = new SwitchableStore(snapshotPath);
    const initial = graph("2026-07-19T05:00:00.000Z");
    const replacement = graph("2026-07-20T05:00:00.000Z");
    const service = new GraphService(null as unknown as Sql, config(snapshotPath), { snapshotStore: store });
    (service as unknown as TestableGraphService).build = async () => ({ graph: initial, historyPages: [] });
    service.startRebuild();
    await waitForTerminalState(service);

    store.fail = true;
    const errorLog = spyOn(console, "error").mockImplementation(() => undefined);
    (service as unknown as TestableGraphService).build = async () => ({ graph: replacement, historyPages: [] });
    service.startRebuild();
    await waitForTerminalState(service);
    errorLog.mockRestore();

    expect(service.cached?.generatedAt).toBe(initial.generatedAt);
    expect(service.getRebuildStatus()).toMatchObject({ state: "failed", snapshotAvailable: true });
    expect(JSON.parse(await readFile(snapshotPath, "utf8"))).toMatchObject({ graph: initial });
  });

  test("bounds shutdown even if an executor close never settles", async () => {
    const expected = graph("2026-07-19T05:00:00.000Z");
    const executor: GraphBuildExecutor = {
      async build() { return { graph: expected, historyPages: [] }; },
      close() { return new Promise<void>(() => undefined); },
    };
    const service = new GraphService(null as unknown as Sql, config(""), {
      executor,
      snapshotStore: new SnapshotStore(null),
      shutdownTimeoutMs: 10,
    });
    service.startRebuild();
    await waitForTerminalState(service);
    const errorLog = spyOn(console, "error").mockImplementation(() => undefined);
    const started = performance.now();
    await service.close();
    errorLog.mockRestore();
    expect(performance.now() - started).toBeLessThan(100);
    expect(service.cached).toEqual(expected);
  });
});
