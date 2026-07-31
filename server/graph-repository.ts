import type { Sql } from "postgres";
import { SCALABLE_LAYOUT_PAGE_THRESHOLD, type GraphRebuildPhase } from "../shared/contracts";
import type { Config } from "./config";
import type { HistoryVersionRow } from "./graph-history";

export type PageRow = {
  id: number;
  source_id: string;
  slug: string;
  type: string;
  title: string;
  source_name: string;
  chunk_count: number;
  tags: string[] | null;
  created_at: Date | string;
  current_content_hash: string;
  current_content_length: number;
};
export type VectorRow = { id: number; embedding_text: string | null };
export type LinkRow = { id: number; from_page_id: number; to_page_id: number; link_type: string; link_source: string | null };
export type SemanticRow = { from_page_id: number; to_page_id: number; similarity: number };
export type NodeDetailRow = { compiled_truth: string | null; updated_at: Date | string | null };

export interface GraphBuildData {
  pages: PageRow[];
  vectors: VectorRow[];
  links: LinkRow[];
  semantic: SemanticRow[];
  scalableLayout: boolean;
  generatedAt: Date | string;
}

export type RebuildPhaseReporter = (phase: GraphRebuildPhase) => void;

export type GraphRepositoryConfig = Pick<
  Config,
  "db" | "allowedSourceIds" | "rebuildStatementTimeoutSeconds" | "semanticCandidateChunks" | "semanticHnswEfSearch"
>;

export class GraphRepository {
  constructor(private readonly sql: Sql, private readonly config: GraphRepositoryConfig) {}

  async status(): Promise<boolean> {
    const rows = await this.sql`SELECT 1 AS ok`;
    return rows[0]?.ok === 1;
  }

  async loadBuildData(reportPhase: RebuildPhaseReporter): Promise<GraphBuildData> {
    const schema = this.config.db.schema;
    const sources = this.config.allowedSourceIds;
    reportPhase("loading-pages");
    return this.sql.begin(async (tx) => {
      await tx`SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY`;
      await tx`SELECT set_config('statement_timeout', ${`${this.config.rebuildStatementTimeoutSeconds}s`}, true)`;
      const generatedAtRows = await tx<{ generated_at: Date | string }[]>`SELECT transaction_timestamp() AS generated_at`;
      const pages = await tx.unsafe<PageRow[]>(`
        WITH visible_pages AS MATERIALIZED (
          SELECT p.id, p.source_id, p.slug, p.type, p.title, p.created_at,
                 p.compiled_truth, COALESCE(s.name, p.source_id) AS source_name
          FROM "${schema}".pages p
          LEFT JOIN "${schema}".sources s ON s.id = p.source_id
          WHERE p.deleted_at IS NULL AND p.source_id = ANY($1::text[])
            AND NOT EXISTS (
              SELECT 1 FROM "${schema}".tags graph_hidden_tag
              WHERE graph_hidden_tag.page_id = p.id AND graph_hidden_tag.tag = 'brain-map'
            )
        ), chunk_counts AS MATERIALIZED (
          SELECT c.page_id, COUNT(*)::int AS chunk_count
          FROM "${schema}".content_chunks c
          JOIN visible_pages p ON p.id = c.page_id
          GROUP BY c.page_id
        ), page_tags AS MATERIALIZED (
          SELECT t.page_id, array_agg(DISTINCT t.tag ORDER BY t.tag) FILTER (WHERE t.tag IS NOT NULL) AS tags
          FROM "${schema}".tags t
          JOIN visible_pages p ON p.id = t.page_id
          GROUP BY t.page_id
        )
        SELECT p.id, p.source_id, p.slug, p.type, p.title, p.created_at,
               md5(COALESCE(p.compiled_truth, '')) AS current_content_hash,
               char_length(COALESCE(p.compiled_truth, ''))::int AS current_content_length,
               p.source_name,
               COALESCE(c.chunk_count, 0)::int AS chunk_count,
               COALESCE(t.tags, '{}') AS tags
        FROM visible_pages p
        LEFT JOIN chunk_counts c ON c.page_id = p.id
        LEFT JOIN page_tags t ON t.page_id = p.id
        ORDER BY p.source_id, p.slug`, [sources]);
      const scalableLayout = pages.length > SCALABLE_LAYOUT_PAGE_THRESHOLD;

      reportPhase("loading-vectors");
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

      reportPhase("semantic-neighbors");
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
            LIMIT ($2 * 4)
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
  }

  async getHistoryVersions(pageIds: number[], graphGeneratedAt: string): Promise<HistoryVersionRow[]> {
    if (!pageIds.length) return [];
    const schema = this.config.db.schema;
    return this.sql.begin(async (tx) => {
      await tx`SET TRANSACTION READ ONLY`;
      return tx.unsafe<HistoryVersionRow[]>(`
        SELECT pv.id, pv.page_id, pv.snapshot_at,
               md5(COALESCE(pv.compiled_truth, '')) AS content_hash,
               char_length(COALESCE(pv.compiled_truth, ''))::int AS content_length
        FROM "${schema}".page_versions pv
        JOIN "${schema}".pages p ON p.id = pv.page_id
        WHERE pv.page_id = ANY($1::int[]) AND p.source_id = ANY($2::text[]) AND p.deleted_at IS NULL
          AND pv.snapshot_at <= $3::timestamptz
        ORDER BY pv.page_id, pv.snapshot_at, pv.id`, [pageIds, this.config.allowedSourceIds, graphGeneratedAt]);
    });
  }

  async getNodeDetail(pageId: number, sourceId: string): Promise<NodeDetailRow | null> {
    const rows = await this.sql.begin(async (tx) => {
      await tx`SET TRANSACTION READ ONLY`;
      return tx.unsafe<NodeDetailRow[]>(`
        SELECT compiled_truth, updated_at
        FROM "${this.config.db.schema}".pages
        WHERE id = $1 AND source_id = $2 AND source_id = ANY($3::text[]) AND deleted_at IS NULL
        LIMIT 1`, [pageId, sourceId, this.config.allowedSourceIds]);
    });
    return rows[0] ?? null;
  }
}
