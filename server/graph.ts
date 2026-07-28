import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { Sql } from "postgres";
import { NODE_COLLISION_GAP, NODE_RADIUS_SCALE, SCALABLE_LAYOUT_PAGE_THRESHOLD, UNCLASSIFIED_NODE_COLOR, type GraphCounts, type GraphEdge, type GraphNode, type GraphRebuildAccepted, type GraphRebuildPhase, type GraphRebuildStatus, type GraphResponse, type GraphTimelineResponse, type NodeDetailResponse, type SemanticGroup } from "../src/types";
import { detectLeidenCommunities } from "./community";
import type { Config } from "./config";
import { parseVector, placeUnclassifiedNearGraph, projectPackedGrid3D, projectUmap, relaxNodeCollisions, separateSemanticGroups } from "./layout";
import { assignCurvatures, familyForType, GROUP_COLORS, RELATION_STYLE, shapeForType } from "./style";
import { createCommunityNames } from "./community-labeling";
import { buildGraphTimeline, type HistoryPageRow, type HistoryVersionRow } from "./graph-history";

type PageRow = { id: number; source_id: string; slug: string; type: string; title: string; source_name: string; chunk_count: number; tags: string[] | null; created_at: Date | string; current_content_hash: string; current_content_length: number };
type VectorRow = { id: number; embedding_text: string | null };
type LinkRow = { id: number; from_page_id: number; to_page_id: number; link_type: string; link_source: string | null };
type SemanticRow = { from_page_id: number; to_page_id: number; similarity: number };
type NodeDetailRow = { compiled_truth: string | null; updated_at: Date | string | null };
const MAX_NODE_CONTENT_CHARS = 64_000;

interface BuildResult { graph: GraphResponse; historyPages: HistoryPageRow[] }
interface PersistedSnapshot { version: 1; graph: GraphResponse; historyPages: HistoryPageRow[] }

function safeErrorMessage(error: unknown): string {
  return error instanceof Error
    ? error.message.replace(/postgres(?:ql)?:\/\/[^\s]+/gi, "<redacted>")
    : "Unknown error";
}

export class GraphService {
  private snapshot: GraphResponse | null = null;
  private timelineSnapshot: GraphTimelineResponse | null = null;
  private historyPageSnapshot: HistoryPageRow[] = [];
  private buildPromise: Promise<BuildResult> | null = null;
  private rebuildStatus: GraphRebuildStatus = {
    state: "idle", phase: "idle", startedAt: null, finishedAt: null,
    lastSuccessfulAt: null, snapshotAvailable: false, error: null,
  };
  constructor(private sql: Sql, private config: Config) {}

  get cached() { return this.snapshot; }

  async initialize(): Promise<void> {
    if (!this.config.snapshotPath) return;
    try {
      const stored = JSON.parse(await readFile(this.config.snapshotPath, "utf8")) as PersistedSnapshot;
      if (stored.version !== 1 || !stored.graph?.generatedAt || !Array.isArray(stored.graph.nodes) || !Array.isArray(stored.historyPages)) {
        throw new Error("Unsupported persisted graph snapshot");
      }
      this.snapshot = stored.graph;
      this.historyPageSnapshot = stored.historyPages;
      this.rebuildStatus = {
        state: "idle", phase: "idle", startedAt: null, finishedAt: null,
        lastSuccessfulAt: stored.graph.generatedAt, snapshotAvailable: true, error: null,
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") console.error("Persisted graph snapshot ignored:", safeErrorMessage(error));
    }
  }

  getRebuildStatus(): GraphRebuildStatus {
    return { ...this.rebuildStatus, snapshotAvailable: this.snapshot !== null };
  }

  startRebuild(): GraphRebuildAccepted {
    if (this.buildPromise) return { accepted: false, status: this.getRebuildStatus() };
    const startedAt = new Date().toISOString();
    this.rebuildStatus = {
      state: "running", phase: "loading-pages", startedAt, finishedAt: null,
      lastSuccessfulAt: this.rebuildStatus.lastSuccessfulAt, snapshotAvailable: this.snapshot !== null, error: null,
    };
    const promise = this.build().then(async (result) => {
      this.setRebuildPhase("persisting");
      await this.persistSnapshot(result);
      this.snapshot = result.graph;
      this.historyPageSnapshot = result.historyPages;
      this.timelineSnapshot = null;
      const finishedAt = new Date().toISOString();
      this.rebuildStatus = {
        state: "succeeded", phase: "idle", startedAt, finishedAt,
        lastSuccessfulAt: finishedAt, snapshotAvailable: true, error: null,
      };
      return result;
    }).catch((error: unknown) => {
      const finishedAt = new Date().toISOString();
      this.rebuildStatus = {
        state: "failed", phase: "idle", startedAt, finishedAt,
        lastSuccessfulAt: this.rebuildStatus.lastSuccessfulAt,
        snapshotAvailable: this.snapshot !== null,
        error: "Graph rebuild failed; the last successful snapshot remains active.",
      };
      console.error("Graph rebuild failed:", safeErrorMessage(error));
      throw error;
    }).finally(() => { this.buildPromise = null; });
    this.buildPromise = promise;
    void promise.catch(() => undefined);
    return { accepted: true, status: this.getRebuildStatus() };
  }

  private setRebuildPhase(phase: GraphRebuildPhase): void {
    if (this.rebuildStatus.state === "running") this.rebuildStatus = { ...this.rebuildStatus, phase };
  }

  private async persistSnapshot(result: BuildResult): Promise<void> {
    if (!this.config.snapshotPath) return;
    await mkdir(dirname(this.config.snapshotPath), { recursive: true });
    const temporaryPath = `${this.config.snapshotPath}.${process.pid}.tmp`;
    await writeFile(temporaryPath, JSON.stringify({ version: 1, ...result } satisfies PersistedSnapshot), { mode: 0o600 });
    await rename(temporaryPath, this.config.snapshotPath);
  }

  async status(): Promise<boolean> {
    const rows = await this.sql`SELECT 1 AS ok`;
    return rows[0]?.ok === 1;
  }

  async getGraph(): Promise<GraphResponse> {
    return this.snapshot ?? this.rebuild();
  }

  async getGraphHistory(): Promise<GraphTimelineResponse> {
    const currentGraph = await this.getGraph();
    if (this.timelineSnapshot?.graphGeneratedAt === currentGraph.generatedAt) return this.timelineSnapshot;
    const stableIdByPageId = new Map(currentGraph.nodes.map((node) => [node.dbId, node.id]));
    const pageIds = [...stableIdByPageId.keys()];
    if (!pageIds.length) {
      const empty = buildGraphTimeline(currentGraph.generatedAt, stableIdByPageId, [], []);
      this.timelineSnapshot = empty;
      return empty;
    }
    const schema = this.config.db.schema;
    const sources = this.config.allowedSourceIds;
    const data = await this.sql.begin(async (tx) => {
      await tx`SET TRANSACTION READ ONLY`;
      const versions = await tx.unsafe<HistoryVersionRow[]>(`
        SELECT pv.id, pv.page_id, pv.snapshot_at,
               md5(COALESCE(pv.compiled_truth, '')) AS content_hash,
               char_length(COALESCE(pv.compiled_truth, ''))::int AS content_length
        FROM "${schema}".page_versions pv
        JOIN "${schema}".pages p ON p.id = pv.page_id
        WHERE pv.page_id = ANY($1::int[]) AND p.source_id = ANY($2::text[]) AND p.deleted_at IS NULL
          AND pv.snapshot_at <= $3::timestamptz
        ORDER BY pv.page_id, pv.snapshot_at, pv.id`, [pageIds, sources, currentGraph.generatedAt]);
      return versions;
    });
    const pages = this.historyPageSnapshot.filter((page) => stableIdByPageId.has(page.id));
    const timeline = buildGraphTimeline(currentGraph.generatedAt, stableIdByPageId, pages, data);
    this.timelineSnapshot = timeline;
    return timeline;
  }

  async getNodeDetail(id: string): Promise<NodeDetailResponse | null> {
    const node = (await this.getGraph()).nodes.find((candidate) => candidate.id === id);
    if (!node) return null;
    const rows = await this.sql.begin(async (tx) => {
      await tx`SET TRANSACTION READ ONLY`;
      return tx.unsafe<NodeDetailRow[]>(`
        SELECT compiled_truth, updated_at
        FROM "${this.config.db.schema}".pages
        WHERE id = $1 AND source_id = $2 AND source_id = ANY($3::text[]) AND deleted_at IS NULL
        LIMIT 1`, [node.dbId, node.sourceId, this.config.allowedSourceIds]);
    });
    const row = rows[0];
    if (!row) return null;
    const content = row.compiled_truth ?? "";
    const updatedAt = row.updated_at instanceof Date ? row.updated_at.toISOString() : row.updated_at;
    return {
      id,
      content: content.slice(0, MAX_NODE_CONTENT_CHARS),
      contentTruncated: content.length > MAX_NODE_CONTENT_CHARS,
      updatedAt,
    };
  }

  async rebuild(): Promise<GraphResponse> {
    if (!this.buildPromise) this.startRebuild();
    return (await this.buildPromise!).graph;
  }

  private async build(): Promise<BuildResult> {
    const schema = this.config.db.schema;
    const sources = this.config.allowedSourceIds;
    this.setRebuildPhase("loading-pages");
    const data = await this.sql.begin(async (tx) => {
      await tx`SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY`;
      await tx`SELECT set_config('statement_timeout', ${`${this.config.rebuildStatementTimeoutSeconds}s`}, true)`;
      const generatedAtRows = await tx<{ generated_at: Date | string }[]>`SELECT transaction_timestamp() AS generated_at`;
      const pages = await tx.unsafe<PageRow[]>(`
        SELECT p.id, p.source_id, p.slug, p.type, p.title, p.created_at,
               md5(COALESCE(p.compiled_truth, '')) AS current_content_hash,
               char_length(COALESCE(p.compiled_truth, ''))::int AS current_content_length,
               COALESCE(s.name, p.source_id) AS source_name,
               COUNT(DISTINCT c.id)::int AS chunk_count,
               COALESCE(array_agg(DISTINCT t.tag) FILTER (WHERE t.tag IS NOT NULL), '{}') AS tags
        FROM "${schema}".pages p
        LEFT JOIN "${schema}".sources s ON s.id = p.source_id
        LEFT JOIN "${schema}".content_chunks c ON c.page_id = p.id
        LEFT JOIN "${schema}".tags t ON t.page_id = p.id
        WHERE p.deleted_at IS NULL AND p.source_id = ANY($1::text[])
          AND NOT EXISTS (
            SELECT 1 FROM "${schema}".tags graph_hidden_tag
            WHERE graph_hidden_tag.page_id = p.id AND graph_hidden_tag.tag = 'brain-map'
          )
        GROUP BY p.id, p.source_id, p.slug, p.type, p.title, s.name
        ORDER BY p.source_id, p.slug`, [sources]);
      const scalableLayout = pages.length > SCALABLE_LAYOUT_PAGE_THRESHOLD;
      this.setRebuildPhase("loading-vectors");
      const vectorProjection = scalableLayout ? "NULL::text" : "avg(l2_normalize(c.embedding))::text";
      const vectors = await tx.unsafe<VectorRow[]>(`
        SELECT p.id, ${vectorProjection} AS embedding_text
        FROM "${schema}".pages p
        JOIN "${schema}".content_chunks c ON c.page_id = p.id
        WHERE p.deleted_at IS NULL AND p.source_id = ANY($1::text[]) AND c.embedding IS NOT NULL
          AND NOT EXISTS (
            SELECT 1 FROM "${schema}".tags graph_hidden_tag
            WHERE graph_hidden_tag.page_id = p.id AND graph_hidden_tag.tag = 'brain-map'
          )
        GROUP BY p.id ORDER BY p.id`, [sources]);
      const links = await tx.unsafe<LinkRow[]>(`
        SELECT l.id, l.from_page_id, l.to_page_id, l.link_type, l.link_source
        FROM "${schema}".links l
        JOIN "${schema}".pages pf ON pf.id = l.from_page_id
        JOIN "${schema}".pages pt ON pt.id = l.to_page_id
        WHERE pf.deleted_at IS NULL AND pt.deleted_at IS NULL
          AND pf.source_id = ANY($1::text[]) AND pt.source_id = ANY($1::text[])
          AND NOT EXISTS (
            SELECT 1 FROM "${schema}".tags graph_hidden_from_tag
            WHERE graph_hidden_from_tag.page_id = pf.id AND graph_hidden_from_tag.tag = 'brain-map'
          )
          AND NOT EXISTS (
            SELECT 1 FROM "${schema}".tags graph_hidden_to_tag
            WHERE graph_hidden_to_tag.page_id = pt.id AND graph_hidden_to_tag.tag = 'brain-map'
          )
        ORDER BY l.id`, [sources]);
      this.setRebuildPhase("semantic-neighbors");
      await tx`SELECT set_config('hnsw.iterative_scan', 'relaxed_order', true)`;
      await tx`SELECT set_config('hnsw.ef_search', ${String(this.config.semanticHnswEfSearch)}, true)`;
      await tx`SELECT set_config('enable_seqscan', 'off', true)`;
      const semantic = await tx.unsafe<SemanticRow[]>(`
        WITH page_vectors AS MATERIALIZED (
          SELECT p.id, avg(l2_normalize(c.embedding))::halfvec(2560) AS embedding
          FROM "${schema}".pages p JOIN "${schema}".content_chunks c ON c.page_id = p.id
          WHERE p.deleted_at IS NULL AND p.source_id = ANY($1::text[]) AND c.embedding IS NOT NULL
            AND NOT EXISTS (
              SELECT 1 FROM "${schema}".tags graph_hidden_tag
              WHERE graph_hidden_tag.page_id = p.id AND graph_hidden_tag.tag = 'brain-map'
            )
          GROUP BY p.id
        ), raw_candidates AS MATERIALIZED (
          SELECT source_vector.id AS from_page_id, candidate.page_id AS to_page_id
          FROM page_vectors source_vector
          CROSS JOIN LATERAL (
            SELECT candidate_chunk.page_id
            FROM "${schema}".content_chunks candidate_chunk
            WHERE candidate_chunk.embedding IS NOT NULL AND candidate_chunk.page_id <> source_vector.id
            ORDER BY candidate_chunk.embedding <=> source_vector.embedding
            LIMIT $2
          ) candidate
        ), candidate_pages AS MATERIALIZED (
          SELECT candidates.from_page_id, candidates.to_page_id
          FROM raw_candidates candidates
          JOIN "${schema}".pages candidate_page ON candidate_page.id = candidates.to_page_id
          WHERE candidate_page.deleted_at IS NULL
            AND candidate_page.source_id = ANY($1::text[])
            AND NOT EXISTS (
              SELECT 1 FROM "${schema}".tags graph_hidden_tag
              WHERE graph_hidden_tag.page_id = candidate_page.id AND graph_hidden_tag.tag = 'brain-map'
            )
          GROUP BY candidates.from_page_id, candidates.to_page_id
        ), ranked AS (
          SELECT candidates.from_page_id, candidates.to_page_id,
                 1 - (source_vector.embedding <=> target_vector.embedding) AS similarity,
                 row_number() OVER (
                   PARTITION BY candidates.from_page_id
                   ORDER BY source_vector.embedding <=> target_vector.embedding, candidates.to_page_id
                 ) AS rank
          FROM candidate_pages candidates
          JOIN page_vectors source_vector ON source_vector.id = candidates.from_page_id
          JOIN page_vectors target_vector ON target_vector.id = candidates.to_page_id
        )
        SELECT from_page_id, to_page_id, similarity::float8 AS similarity
        FROM ranked WHERE rank <= 2 ORDER BY from_page_id, rank`, [sources, this.config.semanticCandidateChunks]);
      return { pages, vectors, links, semantic, scalableLayout, generatedAt: generatedAtRows[0]!.generated_at };
    });

    const stableByDbId = new Map(data.pages.map((p) => [p.id, `${p.source_id}::${p.slug}`]));
    const rawExplicit = data.links.flatMap((edge) => {
      const source = stableByDbId.get(edge.from_page_id); const target = stableByDbId.get(edge.to_page_id);
      if (!source || !target) return [];
      const family = familyForType(edge.link_type); const style = RELATION_STYLE[family];
      return [{ id: `explicit-${edge.id}`, source, target, kind: "explicit" as const, linkType: edge.link_type || "association", linkSource: edge.link_source,
        family, color: style.color, dashPattern: [...style.dash], width: style.width, directed: style.directed, similarity: null }];
    });
    const rawSemantic = data.semantic.flatMap((edge, index) => {
      const source = stableByDbId.get(edge.from_page_id); const target = stableByDbId.get(edge.to_page_id);
      if (!source || !target) return [];
      const style = RELATION_STYLE.semantic;
      return [{ id: `semantic-${edge.from_page_id}-${edge.to_page_id}-${index}`, source, target, kind: "semantic" as const, linkType: "semantic_similarity", linkSource: "chunk HNSW candidates + exact page-centroid rerank",
        family: "semantic" as const, color: style.color, dashPattern: [], width: style.width, directed: false, similarity: edge.similarity }];
    });
    this.setRebuildPhase("layout");
    const community = detectLeidenCommunities(
      data.pages.map((page) => stableByDbId.get(page.id)!),
      rawSemantic.map((edge) => ({ source: edge.source, target: edge.target, similarity: edge.similarity })),
      rawExplicit.map((edge) => ({ source: edge.source, target: edge.target, family: edge.family })),
      this.config.community,
    );
    const embeddedPageIds = new Set(data.vectors.map((vector) => vector.id));
    const vectorById = new Map(data.vectors.flatMap((vector) => vector.embedding_text ? [[vector.id, parseVector(vector.embedding_text)] as const] : []));
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
    const groupByPage = new Map(data.pages.map((page) => [page.id, community.labels[stableByDbId.get(page.id)!] ?? -1]));
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
    const unclassifiedGroup: SemanticGroup = { id: "unclassified", label: "No retained relation", color: UNCLASSIFIED_NODE_COLOR, count: community.isolatedCount, kind: "unclassified" };
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
    const nodes: GraphNode[] = data.pages.map((p) => {
      const hasEmbedding = embeddedPageIds.has(p.id);
      const groupIndex = groupByPage.get(p.id);
      const group = groupIndex === -1 ? unclassifiedGroup : groupMeta[groupIndex ?? -1]!;
      const stableId = stableByDbId.get(p.id)!;
      const position = coordinateByPage.get(p.id)!;
      return {
        id: stableId, dbId: p.id, sourceId: p.source_id, sourceName: p.source_name,
        slug: p.slug, title: p.title, type: p.type, shape: shapeForType(p.type), groupId: group.id,
        groupLabel: group.label, color: group.color, chunkCount: p.chunk_count, degree: degree.get(p.id) ?? 0,
        size: nodeSizeByPage.get(p.id)!,
        hasEmbedding, isUnclassified: groupIndex === -1,
        communityStrength: community.strengths[stableId] ?? null,
        x: position[0]!, y: position[1]!, z: position[2]!,
      };
    });

    const placed = assignCurvatures([...rawExplicit, ...rawSemantic]);
    const explicitEdges = placed.filter((e) => e.kind === "explicit") as GraphEdge[];
    const semanticEdges = placed.filter((e) => e.kind === "semantic") as GraphEdge[];
    const chunks = data.pages.reduce((sum, p) => sum + p.chunk_count, 0);
    const counts: GraphCounts = {
      pages: nodes.length, chunks, links: explicitEdges.length, explicitEdges: explicitEdges.length, semanticEdges: semanticEdges.length,
      embeddedPages: embeddedPages.length, unembeddedPages: unembedded.length, unclassifiedPages: community.isolatedCount,
      embeddingCoverage: nodes.length ? embeddedPages.length / nodes.length : 0,
    };
    const generatedAt = data.generatedAt instanceof Date ? data.generatedAt.toISOString() : new Date(data.generatedAt).toISOString();
    const historyPages = data.pages.map((page) => ({
      id: page.id,
      created_at: page.created_at,
      current_content_hash: page.current_content_hash,
      current_content_length: page.current_content_length,
    }));
    const graph: GraphResponse = {
      generatedAt, nodes, explicitEdges, semanticEdges, semanticGroups,
      communityDetection: {
        engine: "leiden", resolution: community.resolution, modularity: community.modularity,
        communityCount: community.communityCount, weightedEdgeCount: community.weightedEdgeCount,
        isolatedCount: community.isolatedCount, minSemanticSimilarity: community.minSemanticSimilarity,
      },
      counts,
      layout: {
        engine: data.scalableLayout ? "packed-grid" : "umap",
        scalableThreshold: SCALABLE_LAYOUT_PAGE_THRESHOLD,
      },
    };
    return { graph, historyPages };
  }
}
