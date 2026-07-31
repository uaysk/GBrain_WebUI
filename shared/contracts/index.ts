/** Stable HTTP and worker wire contracts shared by browser, server, and tools. */
export type NodeShape = "circle" | "triangle" | "square" | "diamond" | "pentagon" | "hexagon" | "octagon";
export type RelationFamily = "semantic" | "mention" | "association" | "hierarchy" | "provenance" | "temporal" | "custom";
export const SCALABLE_LAYOUT_PAGE_THRESHOLD = 2_000;

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
export interface GraphResponse { generatedAt: string; nodes: GraphNode[]; explicitEdges: GraphEdge[]; semanticEdges: GraphEdge[]; semanticGroups: SemanticGroup[]; communityDetection: CommunityDetectionInfo; counts: GraphCounts; layout: { engine: "umap" | "packed-grid"; scalableThreshold: number } }
export interface StatusResponse { connected: boolean; lastBuiltAt: string | null; counts: GraphCounts | null; error?: string }
export interface NodeDetailResponse { id: string; content: string; contentTruncated: boolean; updatedAt: string | null }

export type GraphRebuildState = "idle" | "running" | "succeeded" | "failed";
export type GraphRebuildPhase = "idle" | "loading-pages" | "loading-vectors" | "semantic-neighbors" | "layout" | "persisting";
export interface GraphRebuildStatus {
  state: GraphRebuildState;
  phase: GraphRebuildPhase;
  startedAt: string | null;
  finishedAt: string | null;
  lastSuccessfulAt: string | null;
  snapshotAvailable: boolean;
  error: string | null;
}
export interface GraphRebuildAccepted { accepted: boolean; status: GraphRebuildStatus }

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

export type ControlTone = "neutral" | "good" | "warning" | "danger";
export type ControlPhaseStatus = "ok" | "warn" | "fail" | "skipped" | "running" | "unknown";
export type ControlJobStatus = "waiting" | "waiting-children" | "paused" | "active" | "completed" | "failed" | "delayed" | "dead" | "cancelled" | "unknown";

export interface ControlMetric {
  key: string;
  label: string;
  value: number;
  tone: ControlTone;
}

export type ControlPhaseCode =
  | "migration_required"
  | "feature_disabled"
  | "pack_gated"
  | "insufficient_evidence"
  | "budget_exhausted";

export interface ControlPhase {
  name: string;
  label: string;
  status: ControlPhaseStatus;
  durationMs: number;
  summary: string;
  metrics: ControlMetric[];
  warnings: string[];
  /** Allowlisted machine codes only. Raw error hints and warning payloads are never copied. */
  codes?: ControlPhaseCode[];
}

export interface ControlRun {
  id: number | null;
  name: string;
  label: string;
  jobStatus: ControlJobStatus;
  reportStatus: ControlPhaseStatus;
  sourceId: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  durationMs: number;
  partial: boolean;
  phases: ControlPhase[];
  impacts: ControlMetric[];
  warnings: string[];
}

export interface ControlSourceStatus {
  id: string;
  name: string;
  syncEnabled: boolean;
  lastSyncAt: string | null;
  stalenessHours: number;
  stalenessClass: "fresh" | "aging" | "stale" | "unknown";
  pages: number;
  chunksTotal: number;
  chunksUnembedded: number;
  embeddingCoveragePct: number;
  backfillQueued: number;
  backfillActive: number;
}

export interface ControlJob {
  id: number;
  parentId?: number | null;
  name: string;
  label: string;
  queue: string;
  status: ControlJobStatus;
  sourceId: string | null;
  createdAt: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  durationMs: number;
  attemptsMade: number;
  maxAttempts: number;
  error: string | null;
  progress: ControlJobProgress | null;
  run: ControlRun | null;
}

export interface ControlJobProgress {
  phase: string | null;
  message: string | null;
  completed: number | null;
  total: number | null;
  percent: number | null;
}

export interface ControlRecentJobCounts {
  sampleSize: number;
  waiting: number;
  waitingChildren: number;
  paused: number;
  active: number;
  completed: number;
  failed: number;
  delayed: number;
  dead: number;
  cancelled: number;
  unknown: number;
}

export type ControlSectionFreshness = "fresh" | "stale" | "unavailable";

export interface ControlCenterQuality {
  status: ControlSectionFreshness;
  recentJobs: ControlSectionFreshness;
  sourceDreamRuns: ControlSectionFreshness;
  globalDreamRuns: ControlSectionFreshness;
}

export interface ControlAffectedPage {
  sourceId: string;
  slug: string;
  phases: string[];
}

export interface ControlAffectedPages {
  items: ControlAffectedPage[];
  total: number;
  truncated: boolean;
  /** Whether the report can account for the complete affected-page set. */
  coverage: "complete" | "partial" | "unavailable";
}

export interface ControlDreamMetricComparison {
  key: string;
  label: string;
  current: number;
  previous: number;
  delta: number;
}

export type ControlDreamFindingKind = "failure" | "warning" | "remediation" | "metric" | "duration";

export interface ControlDreamFinding {
  id: string;
  kind: ControlDreamFindingKind;
  phase: string | null;
  label: string;
  detail: string;
}

export interface ControlDreamRunDetail {
  snapshotGeneratedAt: string;
  stale: boolean;
  run: ControlRun;
  previousRun: ControlRun | null;
  comparison: { metrics: ControlDreamMetricComparison[] };
  findings: ControlDreamFinding[];
  affectedPages: ControlAffectedPages;
}

export interface ControlCenterResponse {
  generatedAt: string;
  availability: {
    configured: boolean;
    connected: boolean;
    message: string | null;
  };
  management: {
    enabled: boolean;
    confirmationRequired: true;
  };
  version: string | null;
  sources: ControlSourceStatus[];
  latestFullRun: ControlRun | null;
  latestTargetedRun: ControlRun | null;
  recentJobCounts: ControlRecentJobCounts;
  jobs: ControlJob[];
  /** Dedicated source/global Dream history from the same polling generation. */
  dreamRuns?: ControlRun[];
  /** Optional for compatibility with snapshots produced before Dream Inspector. */
  quality?: ControlCenterQuality;
}

export type ControlActionName =
  | "quick-dream"
  | "source-sync"
  | "embedding-refresh"
  | "job-retry"
  | "job-cancel";

export type ControlActionRequest =
  | {
    action: "quick-dream" | "source-sync" | "embedding-refresh";
    sourceId: string;
    confirmation: string;
  }
  | {
    action: "job-retry" | "job-cancel";
    jobId: number;
    expectedStatus: ControlJobStatus;
    confirmation: string;
  };

export interface ControlActionJob {
  id: number;
  name: string;
  label: string;
  status: ControlJobStatus;
  sourceId: string | null;
  createdAt: string | null;
}

export interface ControlActionResult {
  actionId: string;
  action: ControlActionName;
  outcome: "accepted" | "pending-verification";
  replayed: boolean;
  message: string;
  generatedAt: string;
  job: ControlActionJob | null;
}
