import type { PoolClient } from "pg";

export const DEFAULT_PROJECT = "gbrain-webui";
export const DEFAULT_GRAPH = "graphify-out/graph.json";
export const EMBEDDING_DIMENSIONS = 2_560;

export type GraphNode = {
  id: string;
  label?: string;
  source_file?: string;
  source_location?: string;
  community?: number;
  community_name?: string;
  [key: string]: unknown;
};

export type GraphLink = {
  source: string;
  target: string;
  relation?: string;
  context?: string;
  confidence?: string;
  [key: string]: unknown;
};

export type GraphData = {
  directed?: boolean;
  nodes: GraphNode[];
  links?: GraphLink[];
  edges?: GraphLink[];
};

export type RetrievalDocument = {
  project: string;
  nodeId: string;
  graphSha: string;
  contentHash: string;
  label: string;
  sourceFile: string;
  sourceLocation: string;
  community: number | null;
  communityName: string;
  searchText: string;
  metadata: Record<string, unknown>;
};

export type RankedNode = {
  nodeId: string;
  label: string;
  sourceFile: string;
  sourceLocation: string;
  searchText: string;
  lexicalRank?: number;
  vectorRank?: number;
  ftsRank?: number;
  fusedScore: number;
  rerankScore?: number;
};

export type GraphifySynthesis = {
  answer: string;
  evidence: Array<{
    nodeId: string;
    label: string;
    sourceFile: string;
    sourceLocation: string;
    reason: string;
  }>;
  limitations: string[];
};

export type HybridQueryResult = {
  question: string;
  seeds: RankedNode[];
  nodes: GraphNode[];
  links: GraphLink[];
  retrieval: {
    lexicalCandidates: number;
    vectorCandidates: number;
    ftsCandidates: number;
    rerankedCandidates: number;
    elapsedMs: number;
  };
  synthesis?: GraphifySynthesis;
};

export type Queryable = Pick<PoolClient, "query">;
