import {
  SCALABLE_LAYOUT_PAGE_THRESHOLD,
  type GraphCounts,
  type GraphEdge,
  type GraphNode,
  type GraphResponse,
  type SemanticGroup,
} from "../shared/contracts";
import { NODE_COLLISION_GAP, NODE_RADIUS_SCALE, UNCLASSIFIED_NODE_COLOR } from "../shared/graph-visuals";
import { createCommunityNames } from "./community-labeling";
import { detectLeidenCommunities } from "./community";
import type { Config } from "./config";
import type { HistoryPageRow } from "./graph-history";
import type { GraphBuildData, PageRow } from "./graph-repository";
import {
  parseVector,
  placeUnclassifiedNearGraph,
  projectPackedGrid3D,
  projectUmap,
  relaxNodeCollisions,
  separateSemanticGroups,
} from "./layout";
import { assignCurvatures, familyForType, GROUP_COLORS, RELATION_STYLE, shapeForType } from "./style";

export interface GraphBuildResult {
  graph: GraphResponse;
  historyPages: HistoryPageRow[];
}

/** Pure, deterministic conversion from repository rows to a graph snapshot. */
export class GraphAssembler {
  constructor(private readonly config: Pick<Config, "community">) {}

  assemble(data: GraphBuildData): GraphBuildResult {
    const stableByDbId = new Map(data.pages.map((page) => [page.id, `${page.source_id}::${page.slug}`]));
    const rawExplicit = data.links.flatMap((edge) => {
      const source = stableByDbId.get(edge.from_page_id);
      const target = stableByDbId.get(edge.to_page_id);
      if (!source || !target) return [];
      const family = familyForType(edge.link_type);
      const style = RELATION_STYLE[family];
      return [{
        id: `explicit-${edge.id}`,
        source,
        target,
        kind: "explicit" as const,
        linkType: edge.link_type || "association",
        linkSource: edge.link_source,
        family,
        color: style.color,
        dashPattern: [...style.dash],
        width: style.width,
        directed: style.directed,
        similarity: null,
      }];
    });
    const rawSemantic = data.semantic.flatMap((edge, index) => {
      const source = stableByDbId.get(edge.from_page_id);
      const target = stableByDbId.get(edge.to_page_id);
      if (!source || !target) return [];
      const style = RELATION_STYLE.semantic;
      return [{
        id: `semantic-${edge.from_page_id}-${edge.to_page_id}-${index}`,
        source,
        target,
        kind: "semantic" as const,
        linkType: "semantic_similarity",
        linkSource: "chunk HNSW candidates + exact page-centroid rerank",
        family: "semantic" as const,
        color: style.color,
        dashPattern: [],
        width: style.width,
        directed: false,
        similarity: edge.similarity,
      }];
    });
    const community = detectLeidenCommunities(
      data.pages.map((page) => stableByDbId.get(page.id)!),
      rawSemantic.map((edge) => ({ source: edge.source, target: edge.target, similarity: edge.similarity })),
      rawExplicit.map((edge) => ({ source: edge.source, target: edge.target, family: edge.family })),
      this.config.community,
    );
    const embeddedPageIds = new Set(data.vectors.map((vector) => vector.id));
    const vectorById = new Map(data.vectors.flatMap((vector) => (
      vector.embedding_text ? [[vector.id, parseVector(vector.embedding_text)] as const] : []
    )));
    const embeddedPages = data.pages.filter((page) => embeddedPageIds.has(page.id));
    const unembedded = data.pages.filter((page) => !embeddedPageIds.has(page.id));
    const degree = new Map<number, number>();
    for (const edge of [...data.links, ...data.semantic]) {
      degree.set(edge.from_page_id, (degree.get(edge.from_page_id) ?? 0) + 1);
      degree.set(edge.to_page_id, (degree.get(edge.to_page_id) ?? 0) + 1);
    }
    const nodeSizeByPage = new Map(data.pages.map((page) => [
      page.id,
      1 + Math.log1p(page.chunk_count) * 0.18 + Math.log1p(degree.get(page.id) ?? 0) * 0.13,
    ]));
    const groupByPage = new Map(data.pages.map((page) => [
      page.id,
      community.labels[stableByDbId.get(page.id)!] ?? -1,
    ]));
    const membersByGroup = Array.from({ length: community.communityCount }, () => [] as PageRow[]);
    for (const page of data.pages) {
      const group = groupByPage.get(page.id) ?? -1;
      if (group >= 0) membersByGroup[group]?.push(page);
    }
    const communityNames = createCommunityNames(membersByGroup);
    const groupMeta: SemanticGroup[] = membersByGroup.map((members, index) => ({
      id: `group-${index + 1}`,
      label: `Leiden ${String(index + 1).padStart(2, "0")} · ${communityNames[index]}`,
      color: GROUP_COLORS[index % GROUP_COLORS.length]!,
      count: members.length,
      kind: "community" as const,
    }));
    const unclassifiedGroup: SemanticGroup = {
      id: "unclassified",
      label: "No retained relation",
      color: UNCLASSIFIED_NODE_COLOR,
      count: community.isolatedCount,
      kind: "unclassified",
    };
    const semanticGroups = community.isolatedCount ? [...groupMeta, unclassifiedGroup] : groupMeta;
    const allLayoutRadii = data.pages.map((page) => NODE_RADIUS_SCALE * nodeSizeByPage.get(page.id)!);
    let coordinateByPage: Map<number, number[]>;
    if (data.scalableLayout) {
      const packed = projectPackedGrid3D(data.pages.map((page, index) => ({
        id: String(page.id),
        group: embeddedPageIds.has(page.id) ? (groupByPage.get(page.id) ?? -1) : -2,
        radius: allLayoutRadii[index]!,
      })), NODE_COLLISION_GAP);
      coordinateByPage = new Map(data.pages.map((page) => [page.id, packed.get(String(page.id))!]));
    } else {
      const pageVectors = embeddedPages.map((page) => vectorById.get(page.id)!);
      const groupsForEmbedded = embeddedPages.map((page) => groupByPage.get(page.id) ?? -1);
      const umapCoords = projectUmap(pageVectors);
      const separatedCoords = separateSemanticGroups(umapCoords, groupsForEmbedded);
      const layoutRadii = embeddedPages.map((page) => NODE_RADIUS_SCALE * nodeSizeByPage.get(page.id)!);
      const coords = relaxNodeCollisions(separatedCoords, layoutRadii, 28, NODE_COLLISION_GAP);
      coordinateByPage = new Map(embeddedPages.map((page, index) => [page.id, coords[index]!]));
      unembedded.forEach((page, index) => {
        const angle = (index / Math.max(1, unembedded.length)) * Math.PI * 2;
        coordinateByPage.set(page.id, [Math.cos(angle) * 148, (index % 2 ? 1 : -1) * 24, Math.sin(angle) * 148]);
      });
      const allCoordinates = data.pages.map((page) => coordinateByPage.get(page.id)!);
      const nearGraphCoordinates = placeUnclassifiedNearGraph(
        allCoordinates,
        data.pages.map((page) => (groupByPage.get(page.id) ?? -1) === -1),
      );
      const finalCoordinates = relaxNodeCollisions(nearGraphCoordinates, allLayoutRadii, 32, NODE_COLLISION_GAP);
      data.pages.forEach((page, index) => coordinateByPage.set(page.id, finalCoordinates[index]!));
    }

    const nodes: GraphNode[] = data.pages.map((page) => {
      const hasEmbedding = embeddedPageIds.has(page.id);
      const groupIndex = groupByPage.get(page.id);
      const group = groupIndex === -1 ? unclassifiedGroup : groupMeta[groupIndex ?? -1]!;
      const stableId = stableByDbId.get(page.id)!;
      const position = coordinateByPage.get(page.id)!;
      return {
        id: stableId,
        dbId: page.id,
        sourceId: page.source_id,
        sourceName: page.source_name,
        slug: page.slug,
        title: page.title,
        type: page.type,
        shape: shapeForType(page.type),
        groupId: group.id,
        groupLabel: group.label,
        color: group.color,
        chunkCount: page.chunk_count,
        degree: degree.get(page.id) ?? 0,
        size: nodeSizeByPage.get(page.id)!,
        hasEmbedding,
        isUnclassified: groupIndex === -1,
        communityStrength: community.strengths[stableId] ?? null,
        x: position[0]!,
        y: position[1]!,
        z: position[2]!,
      };
    });

    const placed = assignCurvatures([...rawExplicit, ...rawSemantic]);
    const explicitEdges = placed.filter((edge) => edge.kind === "explicit") as GraphEdge[];
    const semanticEdges = placed.filter((edge) => edge.kind === "semantic") as GraphEdge[];
    const chunks = data.pages.reduce((sum, page) => sum + page.chunk_count, 0);
    const counts: GraphCounts = {
      pages: nodes.length,
      chunks,
      links: explicitEdges.length,
      explicitEdges: explicitEdges.length,
      semanticEdges: semanticEdges.length,
      embeddedPages: embeddedPages.length,
      unembeddedPages: unembedded.length,
      unclassifiedPages: community.isolatedCount,
      embeddingCoverage: nodes.length ? embeddedPages.length / nodes.length : 0,
    };
    const generatedAt = data.generatedAt instanceof Date
      ? data.generatedAt.toISOString()
      : new Date(data.generatedAt).toISOString();
    const historyPages = data.pages.map((page) => ({
      id: page.id,
      created_at: page.created_at,
      current_content_hash: page.current_content_hash,
      current_content_length: page.current_content_length,
    }));
    return {
      historyPages,
      graph: {
        generatedAt,
        nodes,
        explicitEdges,
        semanticEdges,
        semanticGroups,
        communityDetection: {
          engine: "leiden",
          resolution: community.resolution,
          modularity: community.modularity,
          communityCount: community.communityCount,
          weightedEdgeCount: community.weightedEdgeCount,
          isolatedCount: community.isolatedCount,
          minSemanticSimilarity: community.minSemanticSimilarity,
        },
        counts,
        layout: {
          engine: data.scalableLayout ? "packed-grid" : "umap",
          scalableThreshold: SCALABLE_LAYOUT_PAGE_THRESHOLD,
        },
      },
    };
  }
}
