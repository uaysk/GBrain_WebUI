import type { GraphRebuildPhase } from "../shared/contracts";
import type { Config } from "./config";
import type { GraphBuildResult } from "./graph-assembler";
import type { GraphRepositoryConfig } from "./graph-repository";

export type GraphWorkerConfig = GraphRepositoryConfig & Pick<Config, "community">;

type WorkerMessage =
  | { type: "phase"; phase: GraphRebuildPhase }
  | { type: "result"; result: GraphBuildResult }
  | { type: "error"; message: string };

export interface GraphBuildExecutor {
  build(reportPhase: (phase: GraphRebuildPhase) => void): Promise<GraphBuildResult>;
  close?(): Promise<void> | void;
}

export class WorkerGraphBuildExecutor implements GraphBuildExecutor {
  private active: { worker: Worker; reject: (error: Error) => void } | null = null;
  private readonly workerConfig: GraphWorkerConfig;

  constructor(config: Config) {
    this.workerConfig = {
      db: config.db,
      allowedSourceIds: config.allowedSourceIds,
      rebuildStatementTimeoutSeconds: config.rebuildStatementTimeoutSeconds,
      semanticCandidateChunks: config.semanticCandidateChunks,
      semanticHnswEfSearch: config.semanticHnswEfSearch,
      community: config.community,
    };
  }

  build(reportPhase: (phase: GraphRebuildPhase) => void): Promise<GraphBuildResult> {
    if (this.active) return Promise.reject(new Error("Graph build worker is already active"));
    return new Promise<GraphBuildResult>((resolve, reject) => {
      const workerEntry = import.meta.url.endsWith(".ts") ? "./graph-build-worker.ts" : "./graph-build-worker.js";
      const worker = new Worker(new URL(workerEntry, import.meta.url), { type: "module" });
      const finish = () => {
        worker.terminate();
        if (this.active?.worker === worker) this.active = null;
      };
      this.active = { worker, reject };
      worker.onmessage = (event: MessageEvent<WorkerMessage>) => {
        const message = event.data;
        if (message.type === "phase") {
          reportPhase(message.phase);
          return;
        }
        finish();
        if (message.type === "result") resolve(message.result);
        else reject(new Error(message.message));
      };
      worker.onerror = () => {
        finish();
        reject(new Error("Graph build worker crashed"));
      };
      worker.postMessage({ config: this.workerConfig });
    });
  }

  close(): void {
    const active = this.active;
    if (!active) return;
    this.active = null;
    active.worker.terminate();
    active.reject(new Error("Graph build worker stopped during shutdown"));
  }
}
