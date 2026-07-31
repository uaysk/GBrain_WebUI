import { randomUUID } from "node:crypto";
import { mkdir, open, readFile, rename, unlink } from "node:fs/promises";
import { dirname } from "node:path";
import type { GraphNode, GraphResponse } from "../shared/contracts";
import type { GraphBuildResult } from "./graph-assembler";
import type { HistoryPageRow } from "./graph-history";

interface PersistedSnapshot {
  version: 1;
  graph: GraphResponse;
  historyPages: HistoryPageRow[];
}

export interface SnapshotBundle {
  readonly generation: number;
  readonly graph: GraphResponse;
  readonly historyPages: readonly HistoryPageRow[];
  readonly nodeById: ReadonlyMap<string, GraphNode>;
  readonly serializedGraph: string;
}

function validateSnapshot(value: unknown): PersistedSnapshot {
  if (!value || typeof value !== "object") throw new Error("Persisted graph snapshot must be an object");
  const candidate = value as Partial<PersistedSnapshot>;
  if (candidate.version !== 1 || !candidate.graph || typeof candidate.graph.generatedAt !== "string") {
    throw new Error("Unsupported persisted graph snapshot");
  }
  if (!Array.isArray(candidate.graph.nodes)
    || !Array.isArray(candidate.graph.explicitEdges)
    || !Array.isArray(candidate.graph.semanticEdges)
    || !Array.isArray(candidate.graph.semanticGroups)
    || !Array.isArray(candidate.historyPages)) {
    throw new Error("Persisted graph snapshot is incomplete");
  }
  const ids = new Set<string>();
  for (const node of candidate.graph.nodes) {
    if (!node || typeof node.id !== "string" || !node.id || ids.has(node.id) || !Number.isInteger(node.dbId)) {
      throw new Error("Persisted graph snapshot contains an invalid node");
    }
    ids.add(node.id);
  }
  return candidate as PersistedSnapshot;
}

export function createSnapshotBundle(result: GraphBuildResult, generation: number): SnapshotBundle {
  const nodes = result.graph.nodes.map((node) => Object.freeze({ ...node }));
  const explicitEdges = result.graph.explicitEdges.map((edge) => Object.freeze({ ...edge, dashPattern: Object.freeze([...edge.dashPattern]) }));
  const semanticEdges = result.graph.semanticEdges.map((edge) => Object.freeze({ ...edge, dashPattern: Object.freeze([...edge.dashPattern]) }));
  const semanticGroups = result.graph.semanticGroups.map((group) => Object.freeze({ ...group }));
  const graph = Object.freeze({
    ...result.graph,
    nodes: Object.freeze(nodes),
    explicitEdges: Object.freeze(explicitEdges),
    semanticEdges: Object.freeze(semanticEdges),
    semanticGroups: Object.freeze(semanticGroups),
    communityDetection: Object.freeze({ ...result.graph.communityDetection }),
    counts: Object.freeze({ ...result.graph.counts }),
    layout: Object.freeze({ ...result.graph.layout }),
  }) as GraphResponse;
  const historyPages = Object.freeze(result.historyPages.map((page) => Object.freeze({ ...page })));
  return Object.freeze({
    generation,
    graph,
    historyPages,
    nodeById: new Map(nodes.map((node) => [node.id, node])),
    serializedGraph: JSON.stringify(graph),
  });
}

export class SnapshotStore {
  constructor(private readonly path: string | null) {}

  async load(generation: number): Promise<SnapshotBundle | null> {
    if (!this.path) return null;
    try {
      const stored = validateSnapshot(JSON.parse(await readFile(this.path, "utf8")));
      return createSnapshotBundle({ graph: stored.graph, historyPages: stored.historyPages }, generation);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    }
  }

  async persist(result: GraphBuildResult): Promise<void> {
    const snapshot = validateSnapshot({ version: 1, ...result });
    if (!this.path) return;
    const directory = dirname(this.path);
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const temporaryPath = `${this.path}.${process.pid}.${randomUUID()}.tmp`;
    try {
      const file = await open(temporaryPath, "wx", 0o600);
      try {
        await file.writeFile(JSON.stringify(snapshot), "utf8");
        await file.sync();
      } finally {
        await file.close();
      }
      await rename(temporaryPath, this.path);
      const directoryHandle = await open(directory, "r");
      try {
        await directoryHandle.sync();
      } finally {
        await directoryHandle.close();
      }
    } catch (error) {
      await unlink(temporaryPath).catch(() => undefined);
      throw error;
    }
  }
}
