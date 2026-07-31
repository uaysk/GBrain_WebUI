import type pg from "pg";
import { apiConfigFromEnv } from "./config.js";
import { apiRequest, embedTexts, validateRerankRows, type ApiRequestOptions } from "./api-client.js";
import { assertPgvectorVersion, withSharedDatabaseClient } from "./database.js";
import { loadGraph } from "./documents.js";
import {
  DEFAULT_PROJECT,
  type GraphData,
  type GraphLink,
  type GraphNode,
  type HybridQueryResult,
  type RankedNode,
} from "./types.js";

function queryTokens(question: string): string[] {
  return [...new Set(
    question.toLocaleLowerCase().match(/[\p{L}\p{N}_]+/gu)?.filter((token) => token.length >= 2) || [],
  )];
}

export function lexicalRank(
  graph: GraphData,
  question: string,
  limit = 50,
): Array<{ nodeId: string; score: number }> {
  const terms = queryTokens(question);
  const ranked: Array<{ nodeId: string; score: number }> = [];
  for (const node of graph.nodes) {
    const label = String(node.label || "").toLocaleLowerCase();
    const bare = label.replace(/\(\)$/, "");
    const source = String(node.source_file || "").toLocaleLowerCase();
    let score = 0;
    let matched = 0;
    for (const term of terms) {
      if (term === label || term === bare) {
        score += 1_000;
        matched += 1;
      } else if (label.startsWith(term) || bare.startsWith(term)) {
        score += 100;
        matched += 1;
      } else if (label.includes(term)) {
        score += 4;
        matched += 1;
      }
      if (source.includes(term)) score += 1;
    }
    if (matched > 0) score *= (matched / Math.max(1, terms.length)) ** 2;
    if (score > 0) ranked.push({ nodeId: node.id, score });
  }
  ranked.sort((a, b) => b.score - a.score || a.nodeId.localeCompare(b.nodeId));
  return ranked.slice(0, limit);
}

export function reciprocalRankFusion(
  rankings: Array<{ name: "lexical" | "vector" | "fts"; ids: string[]; weight?: number }>,
  k = 60,
): Map<string, { score: number; lexicalRank?: number; vectorRank?: number; ftsRank?: number }> {
  const fused = new Map<string, { score: number; lexicalRank?: number; vectorRank?: number; ftsRank?: number }>();
  for (const ranking of rankings) {
    ranking.ids.forEach((id, index) => {
      const current = fused.get(id) || { score: 0 };
      const rank = index + 1;
      current.score += (ranking.weight || 1) / (k + rank);
      if (ranking.name === "lexical") current.lexicalRank = rank;
      if (ranking.name === "vector") current.vectorRank = rank;
      if (ranking.name === "fts") current.ftsRank = rank;
      fused.set(id, current);
    });
  }
  return fused;
}

function vectorLiteral(vector: number[]): string {
  return `[${vector.join(",")}]`;
}

export async function databaseRankings(
  client: Pick<pg.PoolClient, "query">,
  project: string,
  question: string,
  limit: number,
  dependencies: { embed?: typeof embedTexts } = {},
): Promise<{
  vector: Array<RankedNode & { similarity: number }>;
  fts: Array<RankedNode & { similarity: number }>;
}> {
  const extension = await client.query<{ extversion: string }>(
    "SELECT extversion FROM pg_extension WHERE extname = 'vector'",
  );
  if (!extension.rows[0]?.extversion) throw new Error("PostgreSQL extension vector is not installed");
  assertPgvectorVersion(extension.rows[0].extversion);
  const [queryVector] = await (dependencies.embed || embedTexts)([question]);
  const commonSelect = `
    node_id AS "nodeId", label, source_file AS "sourceFile",
    source_location AS "sourceLocation", search_text AS "searchText"
  `;
  await client.query("BEGIN");
  try {
    await client.query("SET LOCAL hnsw.iterative_scan = 'strict_order'");
    await client.query("SET LOCAL hnsw.ef_search = 200");
    await client.query("SET LOCAL hnsw.max_scan_tuples = 20000");
    // The project/source B-tree plus an exact sort wins PostgreSQL's cost
    // estimate for the current corpus even though the HNSW path is faster.
    // Scope the planner guard to the vector query and restore sorting before
    // the independent FTS ranking below.
    await client.query("SET LOCAL enable_sort = off");
    const vector = await client.query<RankedNode & { similarity: number }>(
      `SELECT ${commonSelect}, 1 - (embedding <=> $2::halfvec) AS similarity
       FROM graphify_node_embeddings
       WHERE project = $1
       ORDER BY embedding <=> $2::halfvec
       LIMIT $3`,
      [project, vectorLiteral(queryVector), limit],
    );
    await client.query("SET LOCAL enable_sort = on");
    const fts = await client.query<RankedNode & { similarity: number }>(
      `SELECT ${commonSelect},
         ts_rank_cd(search_tsv, plainto_tsquery('simple', $2)) AS similarity
       FROM graphify_node_embeddings
       WHERE project = $1 AND search_tsv @@ plainto_tsquery('simple', $2)
       ORDER BY similarity DESC, node_id
       LIMIT $3`,
      [project, question, limit],
    );
    await client.query("COMMIT");
    return { vector: vector.rows, fts: fts.rows };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  }
}

export async function rerank(
  question: string,
  candidates: RankedNode[],
  topN: number,
  options: ApiRequestOptions = {},
): Promise<RankedNode[]> {
  if (candidates.length === 0) return [];
  const config = options.config || apiConfigFromEnv({ cache: true });
  const result = await apiRequest<unknown>("/rerank", {
    model: config.rerankerModel,
    query: question,
    documents: candidates.map((candidate) => candidate.searchText.slice(0, 2_000)),
    top_n: Math.min(topN, candidates.length),
  }, { ...options, config });
  return validateRerankRows(result, candidates.length).map((row) => ({
    ...candidates[row.index],
    rerankScore: row.score,
  }));
}

function edgeContext(link: GraphLink): string {
  return String(link.context || link.relation || "").toLocaleLowerCase();
}

export function expandSubgraph(
  graph: GraphData,
  seedIds: string[],
  depth = 2,
  contextFilters: string[] = [],
  maxNodes = 100,
): { nodes: GraphNode[]; links: GraphLink[] } {
  const byId = new Map(graph.nodes.map((node) => [node.id, node]));
  const filters = new Set(contextFilters.map((filter) => filter.toLocaleLowerCase()));
  const links = (graph.links || graph.edges || []).filter((link) => {
    if (filters.size === 0) return true;
    const context = edgeContext(link);
    return [...filters].some((filter) => context.includes(filter));
  });
  const adjacency = new Map<string, GraphLink[]>();
  for (const link of links) {
    for (const id of [String(link.source), String(link.target)]) {
      const current = adjacency.get(id) || [];
      current.push(link);
      adjacency.set(id, current);
    }
  }
  const visited = new Set(seedIds.filter((id) => byId.has(id)));
  let frontier = [...visited];
  const includedLinks: GraphLink[] = [];
  for (let level = 0; level < depth && frontier.length > 0 && visited.size < maxNodes; level += 1) {
    const next: string[] = [];
    for (const id of frontier) {
      for (const link of adjacency.get(id) || []) {
        const neighbor = String(link.source) === id ? String(link.target) : String(link.source);
        if (!byId.has(neighbor)) continue;
        if (!includedLinks.includes(link)) includedLinks.push(link);
        if (!visited.has(neighbor) && visited.size < maxNodes) {
          visited.add(neighbor);
          next.push(neighbor);
        }
      }
    }
    frontier = next;
  }
  return {
    nodes: [...visited].map((id) => byId.get(id)!).filter(Boolean),
    links: includedLinks.filter(
      (link) => visited.has(String(link.source)) && visited.has(String(link.target)),
    ),
  };
}

type HybridRetrieveInput = {
  question: string;
  graphPath?: string;
  project?: string;
  topK?: number;
  seedCount?: number;
  depth?: number;
  contextFilters?: string[];
  useReranker?: boolean;
};

export async function hybridRetrieve(
  input: HybridRetrieveInput,
  dependencies: {
    retrieveDatabase?: (
      project: string,
      question: string,
      limit: number,
    ) => ReturnType<typeof databaseRankings>;
    rerankCandidates?: typeof rerank;
  } = {},
): Promise<Omit<HybridQueryResult, "synthesis">> {
  const started = performance.now();
  const graph = await loadGraph(input.graphPath);
  const project = input.project || DEFAULT_PROJECT;
  const topK = Math.max(10, Math.min(100, input.topK || 50));
  const lexical = lexicalRank(graph, input.question, topK);
  const retrieveDatabase = dependencies.retrieveDatabase || (
    (selectedProject: string, question: string, limit: number) => withSharedDatabaseClient(
      (client) => databaseRankings(client, selectedProject, question, limit),
    )
  );
  const db = await retrieveDatabase(project, input.question, topK);
  const fused = reciprocalRankFusion([
    { name: "lexical", ids: lexical.map((row) => row.nodeId), weight: 1.15 },
    { name: "vector", ids: db.vector.map((row) => row.nodeId), weight: 1 },
    { name: "fts", ids: db.fts.map((row) => row.nodeId), weight: 0.7 },
  ]);
  const candidatesById = new Map<string, RankedNode>();
  for (const row of [...db.vector, ...db.fts]) candidatesById.set(row.nodeId, row);
  const nodeById = new Map(graph.nodes.map((node) => [node.id, node]));
  let candidates: RankedNode[] = [...fused.entries()]
    .filter(([nodeId]) => nodeById.has(nodeId))
    .sort((a, b) => b[1].score - a[1].score || a[0].localeCompare(b[0]))
    .slice(0, Math.min(40, topK))
    .map(([nodeId, scores]) => {
      const databaseRow = candidatesById.get(nodeId);
      const graphNode = nodeById.get(nodeId);
      return {
        nodeId,
        label: databaseRow?.label || String(graphNode?.label || nodeId),
        sourceFile: databaseRow?.sourceFile || String(graphNode?.source_file || ""),
        sourceLocation: databaseRow?.sourceLocation || String(graphNode?.source_location || ""),
        searchText: databaseRow?.searchText || [
          graphNode?.label,
          graphNode?.source_file,
          graphNode?.source_location,
        ].filter(Boolean).join("\n"),
        lexicalRank: scores.lexicalRank,
        vectorRank: scores.vectorRank,
        ftsRank: scores.ftsRank,
        fusedScore: scores.score,
      };
    });
  if (input.useReranker !== false) {
    candidates = await (dependencies.rerankCandidates || rerank)(input.question, candidates, candidates.length);
  }
  const seeds = candidates.slice(0, Math.max(1, Math.min(10, input.seedCount || 5)));
  const subgraph = expandSubgraph(
    graph,
    seeds.map((seed) => seed.nodeId),
    input.depth ?? 2,
    input.contextFilters || [],
  );
  return {
    question: input.question,
    seeds,
    ...subgraph,
    retrieval: {
      lexicalCandidates: lexical.length,
      vectorCandidates: db.vector.length,
      ftsCandidates: db.fts.length,
      rerankedCandidates: input.useReranker === false ? 0 : candidates.length,
      elapsedMs: Math.round(performance.now() - started),
    },
  };
}
