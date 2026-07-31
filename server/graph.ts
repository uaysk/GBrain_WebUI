import type { Sql } from "postgres";
import type {
  GraphRebuildAccepted,
  GraphRebuildPhase,
  GraphRebuildStatus,
  GraphResponse,
  GraphTimelineResponse,
  NodeDetailResponse,
} from "../shared/contracts";
import type { Config } from "./config";
import { WorkerGraphBuildExecutor, type GraphBuildExecutor } from "./graph-build-executor";
import type { GraphBuildResult } from "./graph-assembler";
import { buildGraphTimeline } from "./graph-history";
import { GraphRepository } from "./graph-repository";
import { createSnapshotBundle, SnapshotStore, type SnapshotBundle } from "./snapshot-store";

const MAX_NODE_CONTENT_CHARS = 64_000;

function safeErrorMessage(error: unknown): string {
  return error instanceof Error
    ? error.message.replace(/postgres(?:ql)?:\/\/[^\s]+/gi, "<redacted>")
    : "Unknown error";
}

export interface GraphServiceOptions {
  repository?: GraphRepository;
  executor?: GraphBuildExecutor;
  snapshotStore?: SnapshotStore;
  shutdownTimeoutMs?: number;
}

export class GraphService {
  private active: SnapshotBundle | null = null;
  private generation = 0;
  private timelineCache: { generation: number; value: GraphTimelineResponse } | null = null;
  private timelineInFlight: { generation: number; promise: Promise<GraphTimelineResponse> } | null = null;
  private buildPromise: Promise<GraphBuildResult> | null = null;
  private readonly repository: GraphRepository;
  private readonly executor: GraphBuildExecutor;
  private readonly snapshotStore: SnapshotStore;
  private readonly shutdownTimeoutMs: number;
  private rebuildStatus: GraphRebuildStatus = {
    state: "idle",
    phase: "idle",
    startedAt: null,
    finishedAt: null,
    lastSuccessfulAt: null,
    snapshotAvailable: false,
    error: null,
  };

  constructor(sql: Sql, private readonly config: Config, options: GraphServiceOptions = {}) {
    this.repository = options.repository ?? new GraphRepository(sql, config);
    this.executor = options.executor ?? new WorkerGraphBuildExecutor(config);
    this.snapshotStore = options.snapshotStore ?? new SnapshotStore(config.snapshotPath);
    this.shutdownTimeoutMs = options.shutdownTimeoutMs ?? 5_000;
  }

  get cached(): GraphResponse | null {
    return this.active?.graph ?? null;
  }

  async initialize(): Promise<void> {
    try {
      const stored = await this.snapshotStore.load(this.generation + 1);
      if (!stored) return;
      this.generation = stored.generation;
      this.active = stored;
      this.rebuildStatus = {
        state: "idle",
        phase: "idle",
        startedAt: null,
        finishedAt: null,
        lastSuccessfulAt: stored.graph.generatedAt,
        snapshotAvailable: true,
        error: null,
      };
    } catch (error) {
      console.error("Persisted graph snapshot ignored:", safeErrorMessage(error));
    }
  }

  getRebuildStatus(): GraphRebuildStatus {
    return { ...this.rebuildStatus, snapshotAvailable: this.active !== null };
  }

  startRebuild(): GraphRebuildAccepted {
    if (this.buildPromise) return { accepted: false, status: this.getRebuildStatus() };
    const startedAt = new Date().toISOString();
    this.rebuildStatus = {
      state: "running",
      phase: "loading-pages",
      startedAt,
      finishedAt: null,
      lastSuccessfulAt: this.rebuildStatus.lastSuccessfulAt,
      snapshotAvailable: this.active !== null,
      error: null,
    };
    const promise = this.build()
      .then(async (result) => {
        this.setRebuildPhase("persisting");
        await this.snapshotStore.persist(result);
        const bundle = createSnapshotBundle(result, this.generation + 1);
        this.generation = bundle.generation;
        this.active = bundle;
        this.timelineCache = null;
        const finishedAt = new Date().toISOString();
        this.rebuildStatus = {
          state: "succeeded",
          phase: "idle",
          startedAt,
          finishedAt,
          lastSuccessfulAt: result.graph.generatedAt,
          snapshotAvailable: true,
          error: null,
        };
        return result;
      })
      .catch((error: unknown) => {
        const finishedAt = new Date().toISOString();
        this.rebuildStatus = {
          state: "failed",
          phase: "idle",
          startedAt,
          finishedAt,
          lastSuccessfulAt: this.rebuildStatus.lastSuccessfulAt,
          snapshotAvailable: this.active !== null,
          error: "Graph rebuild failed; the last successful snapshot remains active.",
        };
        console.error("Graph rebuild failed:", safeErrorMessage(error));
        throw error;
      })
      .finally(() => {
        if (this.buildPromise === promise) this.buildPromise = null;
      });
    this.buildPromise = promise;
    void promise.catch(() => undefined);
    return { accepted: true, status: this.getRebuildStatus() };
  }

  private setRebuildPhase(phase: GraphRebuildPhase): void {
    if (this.rebuildStatus.state === "running") this.rebuildStatus = { ...this.rebuildStatus, phase };
  }

  private build(): Promise<GraphBuildResult> {
    return this.executor.build((phase) => this.setRebuildPhase(phase));
  }

  status(): Promise<boolean> {
    return this.repository.status();
  }

  async getGraph(): Promise<GraphResponse> {
    return (await this.getActiveBundle()).graph;
  }

  async getSerializedGraph(): Promise<string> {
    return (await this.getActiveBundle()).serializedGraph;
  }

  private async getActiveBundle(): Promise<SnapshotBundle> {
    if (this.active) return this.active;
    await this.rebuild();
    if (!this.active) throw new Error("Graph snapshot is unavailable");
    return this.active;
  }

  async getGraphHistory(): Promise<GraphTimelineResponse> {
    const bundle = await this.getActiveBundle();
    if (this.timelineCache?.generation === bundle.generation) return this.timelineCache.value;
    if (this.timelineInFlight?.generation === bundle.generation) return this.timelineInFlight.promise;

    const promise = this.buildTimeline(bundle).then((timeline) => {
      if (this.active?.generation === bundle.generation) {
        this.timelineCache = { generation: bundle.generation, value: timeline };
      }
      return timeline;
    }).finally(() => {
      if (this.timelineInFlight?.promise === promise) this.timelineInFlight = null;
    });
    this.timelineInFlight = { generation: bundle.generation, promise };
    return promise;
  }

  private async buildTimeline(bundle: SnapshotBundle): Promise<GraphTimelineResponse> {
    const stableIdByPageId = new Map(bundle.graph.nodes.map((node) => [node.dbId, node.id]));
    const pageIds = [...stableIdByPageId.keys()];
    if (!pageIds.length) return buildGraphTimeline(bundle.graph.generatedAt, stableIdByPageId, [], []);
    const versions = await this.repository.getHistoryVersions(pageIds, bundle.graph.generatedAt);
    const pages = bundle.historyPages.filter((page) => stableIdByPageId.has(page.id));
    return buildGraphTimeline(bundle.graph.generatedAt, stableIdByPageId, [...pages], versions);
  }

  async getNodeDetail(id: string): Promise<NodeDetailResponse | null> {
    const bundle = await this.getActiveBundle();
    const node = bundle.nodeById.get(id);
    if (!node) return null;
    const row = await this.repository.getNodeDetail(node.dbId, node.sourceId);
    if (!row) return null;
    const content = row.compiled_truth ?? "";
    const updatedAt = row.updated_at instanceof Date ? row.updated_at.toISOString() : row.updated_at;
    return {
      id,
      content: content.slice(0, MAX_NODE_CONTENT_CHARS),
      contentTruncated: content.length > MAX_NODE_CONTENT_CHARS,
      updatedAt,
    };
  }

  async rebuild(): Promise<GraphResponse> {
    if (!this.buildPromise) this.startRebuild();
    return (await this.buildPromise!).graph;
  }

  async close(): Promise<void> {
    const closing = Promise.resolve(this.executor.close?.());
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const bounded = new Promise<void>((resolve) => {
      timeout = setTimeout(() => {
        console.error("Graph build executor shutdown timed out; the last-good snapshot remains intact.");
        resolve();
      }, this.shutdownTimeoutMs);
    });
    await Promise.race([closing, bounded]);
    if (timeout) clearTimeout(timeout);
  }
}
