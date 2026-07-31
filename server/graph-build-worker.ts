import type { GraphRebuildPhase } from "../shared/contracts";
import type { GraphWorkerConfig } from "./graph-build-executor";
import { GraphAssembler } from "./graph-assembler";
import { GraphRepository } from "./graph-repository";
import { createDb } from "./db";

interface WorkerScope {
  postMessage(message: unknown): void;
  onmessage: ((event: MessageEvent<{ config: GraphWorkerConfig }>) => void) | null;
}

const scope = globalThis as unknown as WorkerScope;

function safeError(error: unknown): string {
  return error instanceof Error
    ? error.message.replace(/postgres(?:ql)?:\/\/[^\s]+/gi, "<redacted>")
    : "Graph build worker failed";
}

scope.onmessage = (event) => {
  const config = event.data.config;
  const sql = createDb(config);
  const repository = new GraphRepository(sql, config);
  const assembler = new GraphAssembler(config);
  const reportPhase = (phase: GraphRebuildPhase) => scope.postMessage({ type: "phase", phase });
  void (async () => {
    try {
      const data = await repository.loadBuildData(reportPhase);
      reportPhase("layout");
      const result = assembler.assemble(data);
      await sql.end();
      scope.postMessage({ type: "result", result });
    } catch (error) {
      await sql.end().catch(() => undefined);
      scope.postMessage({ type: "error", message: safeError(error) });
    }
  })();
};
