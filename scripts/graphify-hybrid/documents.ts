import { createHash } from "node:crypto";
import { readFile, realpath } from "node:fs/promises";
import path from "node:path";
import {
  DEFAULT_GRAPH,
  DEFAULT_PROJECT,
  type GraphData,
  type GraphNode,
  type RetrievalDocument,
} from "./types.js";

export type GraphArtifact = {
  graph: GraphData;
  graphSha: string;
  bytes: Buffer;
};

export async function loadGraphArtifact(graphPath = DEFAULT_GRAPH): Promise<GraphArtifact> {
  const bytes = await readFile(graphPath);
  let parsed: GraphData;
  try {
    parsed = JSON.parse(bytes.toString("utf8")) as GraphData;
  } catch (error) {
    throw new Error(`Invalid Graphify graph JSON: ${graphPath}`, { cause: error });
  }
  if (!Array.isArray(parsed.nodes) || parsed.nodes.some((node) => !node || typeof node.id !== "string")) {
    throw new Error(`Invalid Graphify graph: ${graphPath}`);
  }
  return {
    graph: parsed,
    graphSha: createHash("sha256").update(bytes).digest("hex"),
    bytes,
  };
}

export async function loadGraph(graphPath = DEFAULT_GRAPH): Promise<GraphData> {
  return (await loadGraphArtifact(graphPath)).graph;
}

function insideRoot(root: string, candidate: string): boolean {
  return candidate === root || candidate.startsWith(`${root}${path.sep}`);
}

function safeSourcePath(root: string, sourceFile: string): string | null {
  if (!sourceFile || sourceFile.includes("\0")) return null;
  const resolvedRoot = path.resolve(root);
  const resolved = path.resolve(resolvedRoot, sourceFile);
  if (!insideRoot(resolvedRoot, resolved)) return null;
  if (resolved.includes(`${path.sep}graphify-out${path.sep}`)) return null;
  return resolved;
}

function sourceLine(sourceLocation: string): number {
  const match = sourceLocation.match(/L(\d+)/i);
  return match ? Math.max(1, Number(match[1])) : 1;
}

type SourceCacheOptions = {
  onSourceRead?: (canonicalPath: string) => void;
  readSource?: (canonicalPath: string) => Promise<Buffer>;
  canonicalize?: (sourcePath: string) => Promise<string>;
};

type CachedSource = { kind: "text"; lines: string[] } | { kind: "unavailable" };

function createSourceSnippetReader(root: string, options: SourceCacheOptions = {}) {
  const resolvedRoot = path.resolve(root);
  const cache = new Map<string, Promise<CachedSource>>();
  const readSource = options.readSource || ((sourcePath: string) => readFile(sourcePath));
  const canonicalize = options.canonicalize || realpath;

  async function cachedSource(sourceFile: string): Promise<CachedSource> {
    const sourcePath = safeSourcePath(resolvedRoot, sourceFile);
    if (!sourcePath) return { kind: "unavailable" };
    let canonicalPath: string;
    try {
      canonicalPath = await canonicalize(sourcePath);
    } catch {
      canonicalPath = sourcePath;
    }
    if (!insideRoot(resolvedRoot, canonicalPath)) return { kind: "unavailable" };
    let pending = cache.get(canonicalPath);
    if (!pending) {
      pending = (async () => {
        options.onSourceRead?.(canonicalPath);
        try {
          const bytes = await readSource(canonicalPath);
          if (bytes.length > 2_000_000 || bytes.includes(0)) return { kind: "unavailable" } as const;
          return { kind: "text", lines: bytes.toString("utf8").split(/\r?\n/) } as const;
        } catch {
          return { kind: "unavailable" } as const;
        }
      })();
      cache.set(canonicalPath, pending);
    }
    return pending;
  }

  return async (node: GraphNode): Promise<string> => {
    const source = await cachedSource(String(node.source_file || ""));
    if (source.kind !== "text") return "";
    const line = sourceLine(String(node.source_location || ""));
    const start = Math.max(0, line - 3);
    const end = Math.min(source.lines.length, line + 8);
    return source.lines.slice(start, end).join("\n").slice(0, 4_000);
  };
}

function relationSummaries(graph: GraphData): Map<string, string[]> {
  const byId = new Map(graph.nodes.map((node) => [node.id, node]));
  const summaries = new Map<string, string[]>();
  const add = (id: string, value: string) => {
    const current = summaries.get(id) || [];
    if (current.length < 16 && !current.includes(value)) current.push(value);
    summaries.set(id, current);
  };
  for (const link of graph.links || graph.edges || []) {
    const source = byId.get(String(link.source));
    const target = byId.get(String(link.target));
    if (!source || !target) continue;
    const relation = String(link.relation || "related_to");
    add(source.id, `outgoing ${relation} ${target.label || target.id}`);
    add(target.id, `incoming ${relation} ${source.label || source.id}`);
  }
  return summaries;
}

export async function buildRetrievalDocuments(input: {
  graph: GraphData;
  root?: string;
  project?: string;
  graphSha: string;
  embeddingModel: string;
  sourceCache?: SourceCacheOptions;
}): Promise<RetrievalDocument[]> {
  const root = input.root || ".";
  const project = input.project || DEFAULT_PROJECT;
  const relations = relationSummaries(input.graph);
  const sourceSnippet = createSourceSnippetReader(root, input.sourceCache);
  const documents: RetrievalDocument[] = [];
  const concurrency = 32;
  for (let offset = 0; offset < input.graph.nodes.length; offset += concurrency) {
    const nodes = input.graph.nodes.slice(offset, offset + concurrency);
    const snippets = await Promise.all(nodes.map(sourceSnippet));
    for (let index = 0; index < nodes.length; index += 1) {
      const node = nodes[index];
      const label = String(node.label || node.id);
      const sourceFile = String(node.source_file || "");
      const sourceLocation = String(node.source_location || "");
      const communityName = String(node.community_name || "");
      const searchText = [
        `symbol: ${label}`,
        `node_id: ${node.id}`,
        sourceFile ? `source: ${sourceFile}:${sourceLocation}` : "",
        communityName ? `community: ${communityName}` : "",
        ...(relations.get(node.id) || []),
        snippets[index] ? `source snippet:\n${snippets[index]}` : "",
      ].filter(Boolean).join("\n").replaceAll("\0", "").slice(0, 12_000);
      const contentHash = createHash("sha256")
        .update(`${input.embeddingModel}\0${searchText}`)
        .digest("hex");
      documents.push({
        project,
        nodeId: node.id,
        graphSha: input.graphSha,
        contentHash,
        label,
        sourceFile,
        sourceLocation,
        community: typeof node.community === "number" ? node.community : null,
        communityName,
        searchText,
        metadata: { fileType: node.file_type || null, origin: node._origin || null },
      });
    }
  }
  return documents;
}

export function retrievalInputHash(input: {
  graphSha: string;
  embeddingModel: string;
  documents: RetrievalDocument[];
}): string {
  const fingerprint = createHash("sha256");
  fingerprint.update(`${input.graphSha}\0${input.embeddingModel}\0`);
  for (const document of [...input.documents].sort((a, b) => a.nodeId.localeCompare(b.nodeId))) {
    fingerprint.update(`${document.nodeId}\0${document.contentHash}\0`);
  }
  return fingerprint.digest("hex");
}

export async function buildRetrievalInput(input: {
  graphPath?: string;
  root?: string;
  project?: string;
  embeddingModel: string;
  sourceCache?: SourceCacheOptions;
}) {
  const artifact = await loadGraphArtifact(input.graphPath);
  const documents = await buildRetrievalDocuments({
    graph: artifact.graph,
    root: input.root,
    project: input.project,
    graphSha: artifact.graphSha,
    embeddingModel: input.embeddingModel,
    sourceCache: input.sourceCache,
  });
  return {
    ...artifact,
    documents,
    retrievalInputHash: retrievalInputHash({
      graphSha: artifact.graphSha,
      embeddingModel: input.embeddingModel,
      documents,
    }),
  };
}
