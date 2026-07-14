export type NodeShape = "circle" | "triangle" | "square" | "diamond" | "pentagon" | "hexagon" | "octagon";
export type RelationFamily = "semantic" | "mention" | "association" | "hierarchy" | "provenance" | "temporal" | "custom";

export interface GraphNode {
  id: string;
  dbId: number;
  sourceId: string;
  sourceName: string;
  slug: string;
  title: string;
  type: string;
  shape: NodeShape;
  groupId: string;
  groupLabel: string;
  color: string;
  chunkCount: number;
  degree: number;
  size: number;
  hasEmbedding: boolean;
  isUnclassified: boolean;
  communityStrength: number | null;
  x: number;
  y: number;
  z: number;
}

export interface GraphEdge {
  id: string;
  source: string | GraphNode;
  target: string | GraphNode;
  kind: "explicit" | "semantic";
  linkType: string;
  linkSource: string | null;
  family: RelationFamily;
  color: string;
  dashPattern: number[];
  width: number;
  directed: boolean;
  similarity: number | null;
  curvature: number;
  parallelIndex: number;
  selfLink: boolean;
}

export interface SemanticGroup { id: string; label: string; color: string; count: number; kind: "community" | "unclassified" }
export interface GraphCounts { pages: number; chunks: number; links: number; explicitEdges: number; semanticEdges: number; embeddedPages: number; unembeddedPages: number; unclassifiedPages: number; embeddingCoverage: number }
export interface CommunityDetectionInfo { engine: "leiden"; resolution: number; modularity: number; communityCount: number; weightedEdgeCount: number; isolatedCount: number; minSemanticSimilarity: number }
export interface GraphResponse { generatedAt: string; nodes: GraphNode[]; explicitEdges: GraphEdge[]; semanticEdges: GraphEdge[]; semanticGroups: SemanticGroup[]; communityDetection: CommunityDetectionInfo; counts: GraphCounts }
export interface StatusResponse { connected: boolean; lastBuiltAt: string | null; counts: GraphCounts | null; error?: string }
export interface NodeDetailResponse { id: string; content: string; contentTruncated: boolean; updatedAt: string | null }

export interface GraphTimelineNodeState {
  at: string;
  revision: number;
  sizeScale: number;
}

export interface GraphTimelineNode {
  id: string;
  static: boolean;
  createdAt: string;
  states: GraphTimelineNodeState[];
}

export interface GraphTimelineResponse {
  graphGeneratedAt: string;
  startAt: string;
  endAt: string;
  versionedNodeCount: number;
  staticNodeCount: number;
  stateCount: number;
  transitionCount: number;
  nodes: GraphTimelineNode[];
}
