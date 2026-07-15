import type {
  GraphEdge,
  GraphNode,
  GraphResponse,
  GraphTimelineNode,
  GraphTimelineResponse,
  NodeDetailResponse,
  RelationFamily,
  StatusResponse,
} from "../src/api/types";
import { RELATION_VISUALS, shapeForType } from "../src/graph/visual-spec";

interface DemoPageSeed {
  slug: string;
  title: string;
  type: string;
  chunks: number;
  summary: string;
}

interface DemoGroupSeed {
  id: string;
  label: string;
  color: string;
  center: { x: number; y: number; z: number };
  pages: DemoPageSeed[];
}

const GENERATED_AT = "2026-06-18T09:30:00.000Z";
const SOURCE_ID = "demo";
const SOURCE_NAME = "Synthetic Demo";

const OFFSETS = [
  { x: 0, y: 0, z: 0 },
  { x: -10, y: 8, z: 5 },
  { x: 10, y: 9, z: -4 },
  { x: -12, y: -8, z: -5 },
  { x: 12, y: -7, z: 6 },
  { x: -1, y: 15, z: -8 },
  { x: 2, y: -15, z: 8 },
] as const;

const GROUPS: DemoGroupSeed[] = [
  {
    id: "atlas-launch",
    label: "Atlas Launch",
    color: "#45B8C8",
    center: { x: -50, y: 30, z: 8 },
    pages: [
      { slug: "atlas-workspace", title: "Atlas Workspace", type: "project", chunks: 8, summary: "A demonstration workspace for planning a small product launch." },
      { slug: "product-brief", title: "Product Brief", type: "note", chunks: 5, summary: "Audience, problem statement, constraints, and desired outcomes." },
      { slug: "user-journey-map", title: "User Journey Map", type: "analysis", chunks: 6, summary: "A synthetic journey from discovery through successful adoption." },
      { slug: "launch-checklist", title: "Launch Checklist", type: "guide", chunks: 4, summary: "A reusable checklist for preparing, shipping, and reviewing a release." },
      { slug: "feedback-themes", title: "Feedback Themes", type: "analysis", chunks: 7, summary: "Grouped observations from fictional usability sessions." },
      { slug: "metrics-definition", title: "Metrics Definition", type: "concept", chunks: 3, summary: "Clear definitions for activation, retention, and task completion." },
      { slug: "release-notes", title: "Release Notes", type: "project-log", chunks: 4, summary: "A concise record of demo milestones and decisions." },
    ],
  },
  {
    id: "research-synthesis",
    label: "Research Synthesis",
    color: "#9A7BD8",
    center: { x: 28, y: 43, z: -18 },
    pages: [
      { slug: "research-library", title: "Research Library", type: "project", chunks: 7, summary: "A curated collection of synthetic research material." },
      { slug: "interview-guide", title: "Interview Guide", type: "guide", chunks: 4, summary: "Open-ended prompts for a fictional discovery interview." },
      { slug: "observation-notes", title: "Observation Notes", type: "note", chunks: 6, summary: "Anonymized example observations without real participants." },
      { slug: "evidence-matrix", title: "Evidence Matrix", type: "analysis", chunks: 5, summary: "A compact mapping between claims, evidence, and confidence." },
      { slug: "synthesis-draft", title: "Synthesis Draft", type: "note", chunks: 8, summary: "Emerging themes and opportunities from the demo evidence set." },
      { slug: "open-questions", title: "Open Questions", type: "concept", chunks: 3, summary: "Questions that remain intentionally unresolved in the demo." },
      { slug: "research-decision-log", title: "Research Decision Log", type: "project-log", chunks: 5, summary: "A dated trail of research scope and method decisions." },
    ],
  },
  {
    id: "platform-design",
    label: "Platform Design",
    color: "#55B889",
    center: { x: 50, y: -27, z: 14 },
    pages: [
      { slug: "knowledge-graph-prototype", title: "Knowledge Graph Prototype", type: "project", chunks: 10, summary: "A safe demonstration of semantic and explicit graph exploration." },
      { slug: "search-pipeline", title: "Search Pipeline", type: "analysis", chunks: 7, summary: "A conceptual retrieval pipeline using synthetic documents." },
      { slug: "api-contract", title: "API Contract", type: "guide", chunks: 5, summary: "Read-only response shapes for the demo graph interface." },
      { slug: "graph-rendering-notes", title: "Graph Rendering Notes", type: "note", chunks: 8, summary: "Notes about labels, halos, focus, and camera transitions." },
      { slug: "data-quality-checklist", title: "Data Quality Checklist", type: "guide", chunks: 4, summary: "Checks for stable identifiers, valid links, and safe content." },
      { slug: "architecture-decision", title: "Architecture Decision", type: "project-log", chunks: 6, summary: "Why the demo keeps its fixture isolated from production data." },
      { slug: "performance-baseline", title: "Performance Baseline", type: "ops-snapshot", chunks: 4, summary: "A fictional baseline for layout and interaction responsiveness." },
    ],
  },
  {
    id: "learning-garden",
    label: "Learning Garden",
    color: "#D8A34E",
    center: { x: -30, y: -42, z: -14 },
    pages: [
      { slug: "learning-roadmap", title: "Learning Roadmap", type: "project", chunks: 6, summary: "A sample roadmap linking concepts, experiments, and reviews." },
      { slug: "systems-notes", title: "Systems Notes", type: "note", chunks: 7, summary: "General notes about resilient systems and clear interfaces." },
      { slug: "visualization-reading-list", title: "Visualization Reading List", type: "guide", chunks: 4, summary: "A fictional reading queue for information visualization." },
      { slug: "experiment-notebook", title: "Experiment Notebook", type: "project-log", chunks: 8, summary: "Small repeatable experiments using only demo inputs." },
      { slug: "concept-index", title: "Concept Index", type: "concept", chunks: 5, summary: "A connected index of the learning garden's core concepts." },
      { slug: "weekly-review", title: "Weekly Review", type: "note", chunks: 3, summary: "A synthetic weekly reflection and next-step list." },
      { slug: "study-retrospective", title: "Study Retrospective", type: "analysis", chunks: 5, summary: "A review of which example learning loops worked well." },
    ],
  },
  {
    id: "creative-studio",
    label: "Creative Studio",
    color: "#D97872",
    center: { x: 2, y: 3, z: 34 },
    pages: [
      { slug: "demo-storyboard", title: "Demo Storyboard", type: "project", chunks: 7, summary: "A scene-by-scene plan for presenting the demo memory map." },
      { slug: "visual-language-guide", title: "Visual Language Guide", type: "guide", chunks: 5, summary: "Color, hierarchy, spacing, and motion guidance for the demo." },
      { slug: "interaction-sketches", title: "Interaction Sketches", type: "note", chunks: 6, summary: "Synthetic sketches for focus, hover, and timeline behavior." },
      { slug: "presentation-outline", title: "Presentation Outline", type: "note", chunks: 4, summary: "A concise outline for explaining the map to a new viewer." },
      { slug: "copywriting-notes", title: "Copywriting Notes", type: "analysis", chunks: 5, summary: "Plain-language labels that avoid internal implementation terms." },
      { slug: "accessibility-review", title: "Accessibility Review", type: "guide", chunks: 4, summary: "Keyboard, contrast, and readable-state checks for the demo." },
      { slug: "demo-walkthrough", title: "Demo Walkthrough", type: "project-log", chunks: 6, summary: "A reproducible walkthrough of the synthetic graph experience." },
    ],
  },
];

const unclassifiedSeeds: DemoPageSeed[] = [
  { slug: "demo-inbox", title: "Demo Inbox", type: "note", chunks: 2, summary: "An intentionally unclassified synthetic capture." },
  { slug: "demo-scratchpad", title: "Demo Scratchpad", type: "note", chunks: 1, summary: "An outline-only page used to demonstrate missing embeddings." },
];

const nodeId = (slug: string) => `${SOURCE_ID}::${slug}`;
const summaryById = new Map<string, string>();

const baseNodes: GraphNode[] = GROUPS.flatMap((group, groupIndex) => group.pages.map((page, pageIndex) => {
  const offset = OFFSETS[pageIndex]!;
  const id = nodeId(page.slug);
  summaryById.set(id, page.summary);
  return {
    id,
    dbId: groupIndex * 100 + pageIndex + 1,
    sourceId: SOURCE_ID,
    sourceName: SOURCE_NAME,
    slug: page.slug,
    title: page.title,
    type: page.type,
    shape: shapeForType(page.type),
    groupId: group.id,
    groupLabel: group.label,
    color: group.color,
    chunkCount: page.chunks,
    degree: 0,
    size: 4,
    hasEmbedding: true,
    isUnclassified: false,
    communityStrength: 0.72 + pageIndex * 0.035,
    x: group.center.x + offset.x,
    y: group.center.y + offset.y,
    z: group.center.z + offset.z,
  };
}));

for (const [index, page] of unclassifiedSeeds.entries()) {
  const id = nodeId(page.slug);
  summaryById.set(id, page.summary);
  baseNodes.push({
    id,
    dbId: 900 + index,
    sourceId: SOURCE_ID,
    sourceName: SOURCE_NAME,
    slug: page.slug,
    title: page.title,
    type: page.type,
    shape: shapeForType(page.type),
    groupId: "unclassified",
    groupLabel: "Unsorted Demo Notes",
    color: "#E8A838",
    chunkCount: page.chunks,
    degree: 0,
    size: 3.8,
    hasEmbedding: index === 0,
    isUnclassified: true,
    communityStrength: null,
    x: index === 0 ? -82 : 84,
    y: index === 0 ? -13 : 16,
    z: index === 0 ? -6 : 5,
  });
}

const linkTypes: Record<RelationFamily, string> = {
  semantic: "semantic_similarity",
  mention: "references",
  association: "related_to",
  hierarchy: "contains",
  provenance: "derived_from",
  temporal: "follows",
  custom: "related_to",
};

function edge(kind: "explicit" | "semantic", family: RelationFamily, source: string, target: string, index: number, similarity: number | null = null): GraphEdge {
  const visual = RELATION_VISUALS[family];
  return {
    id: `demo-${kind}-${index}`,
    source,
    target,
    kind,
    linkType: linkTypes[family],
    linkSource: kind === "explicit" ? "demo-fixture" : null,
    family,
    color: visual.color,
    dashPattern: [...visual.dash],
    width: visual.width,
    directed: visual.directed,
    similarity,
    curvature: 0,
    parallelIndex: 0,
    selfLink: false,
  };
}

const semanticEdges: GraphEdge[] = [];
const explicitEdges: GraphEdge[] = [];
let semanticIndex = 0;
let explicitIndex = 0;
const groupNodeIds = GROUPS.map((group) => group.pages.map((page) => nodeId(page.slug)));

for (const ids of groupNodeIds) {
  const hub = ids[0]!;
  ids.slice(1).forEach((id, index) => {
    semanticEdges.push(edge("semantic", "semantic", hub, id, semanticIndex++, 0.92 - index * 0.025));
  });
  for (let index = 1; index < ids.length - 1; index += 1) {
    semanticEdges.push(edge("semantic", "semantic", ids[index]!, ids[index + 1]!, semanticIndex++, 0.79 + (index % 3) * 0.025));
  }
  const families: RelationFamily[] = ["hierarchy", "mention", "provenance", "temporal", "association", "mention"];
  families.forEach((family, index) => explicitEdges.push(edge("explicit", family, ids[index]!, ids[index + 1]!, explicitIndex++)));
}

const crossGroupRelations: Array<[number, number, RelationFamily]> = [
  [0, 2, "association"],
  [1, 0, "provenance"],
  [3, 1, "mention"],
  [4, 0, "association"],
  [2, 4, "provenance"],
  [3, 2, "temporal"],
];
for (const [sourceGroup, targetGroup, family] of crossGroupRelations) {
  explicitEdges.push(edge("explicit", family, groupNodeIds[sourceGroup]![0]!, groupNodeIds[targetGroup]![0]!, explicitIndex++));
}

const neighbors = new Map<string, Set<string>>();
for (const relation of [...semanticEdges, ...explicitEdges]) {
  const source = String(relation.source);
  const target = String(relation.target);
  if (!neighbors.has(source)) neighbors.set(source, new Set());
  if (!neighbors.has(target)) neighbors.set(target, new Set());
  neighbors.get(source)!.add(target);
  neighbors.get(target)!.add(source);
}

const nodes = baseNodes.map((node) => {
  const degree = neighbors.get(node.id)?.size ?? 0;
  return { ...node, degree, size: 3.2 + Math.log1p(node.chunkCount + degree) * 0.95 };
});

const counts = {
  pages: nodes.length,
  chunks: nodes.reduce((sum, node) => sum + node.chunkCount, 0),
  links: explicitEdges.length,
  explicitEdges: explicitEdges.length,
  semanticEdges: semanticEdges.length,
  embeddedPages: nodes.filter((node) => node.hasEmbedding).length,
  unembeddedPages: nodes.filter((node) => !node.hasEmbedding).length,
  unclassifiedPages: nodes.filter((node) => node.isUnclassified).length,
  embeddingCoverage: nodes.filter((node) => node.hasEmbedding).length / nodes.length,
};

export const demoGraph: GraphResponse = {
  generatedAt: GENERATED_AT,
  nodes,
  explicitEdges,
  semanticEdges,
  semanticGroups: [
    ...GROUPS.map((group) => ({ id: group.id, label: group.label, color: group.color, count: group.pages.length, kind: "community" as const })),
    { id: "unclassified", label: "Unsorted Demo Notes", color: "#E8A838", count: unclassifiedSeeds.length, kind: "unclassified" as const },
  ],
  communityDetection: {
    engine: "leiden",
    resolution: 0.5,
    modularity: 0.71,
    communityCount: GROUPS.length,
    weightedEdgeCount: explicitEdges.length + semanticEdges.length,
    isolatedCount: unclassifiedSeeds.length,
    minSemanticSimilarity: 0.65,
  },
  counts,
};

const stateDates = [
  "2026-04-07T09:00:00.000Z",
  "2026-04-23T09:00:00.000Z",
  "2026-05-09T09:00:00.000Z",
  "2026-05-26T09:00:00.000Z",
  "2026-06-10T09:00:00.000Z",
] as const;

const timelineNodes: GraphTimelineNode[] = nodes.map((node, index) => {
  const isStatic = node.isUnclassified || index % 9 === 0;
  const createdIndex = index % 3;
  const revisedIndex = Math.min(stateDates.length - 1, createdIndex + 2 + (index % 2));
  return {
    id: node.id,
    static: isStatic,
    createdAt: stateDates[createdIndex]!,
    states: isStatic ? [] : [
      { at: stateDates[createdIndex]!, revision: 1, sizeScale: 0.84 },
      { at: stateDates[revisedIndex]!, revision: 2, sizeScale: 1 },
    ],
  };
});

export const demoTimeline: GraphTimelineResponse = {
  graphGeneratedAt: GENERATED_AT,
  startAt: stateDates[0],
  endAt: GENERATED_AT,
  versionedNodeCount: timelineNodes.filter((node) => !node.static).length,
  staticNodeCount: timelineNodes.filter((node) => node.static).length,
  stateCount: timelineNodes.reduce((sum, node) => sum + node.states.length, 0),
  transitionCount: timelineNodes.reduce((sum, node) => sum + Math.max(0, node.states.length - 1), 0),
  nodes: timelineNodes,
};

export const demoStatus: StatusResponse = {
  connected: true,
  lastBuiltAt: GENERATED_AT,
  counts,
};

export const demoNodeDetails: Record<string, NodeDetailResponse> = Object.fromEntries(nodes.map((node) => [node.id, {
  id: node.id,
  content: `# ${node.title}\n\n${summaryById.get(node.id)}\n\n## Demo notes\n\n- Uses synthetic content only\n- Belongs to the **${node.groupLabel}** community\n- Demonstrates read-only memory exploration\n\n> This page is part of the reproducible README fixture and contains no user memory.`,
  contentTruncated: false,
  updatedAt: "2026-06-10T09:00:00.000Z",
}]));

export const DEMO_SELECTED_NODE_ID = nodeId("knowledge-graph-prototype");
