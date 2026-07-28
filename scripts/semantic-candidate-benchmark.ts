import { createDb } from "../server/db";
import { loadConfig } from "../server/config";

type SemanticRow = { from_page_id: number; to_page_id: number; similarity: number };

const config = loadConfig();
const sql = createDb(config);
const schema = config.db.schema;
const sources = config.allowedSourceIds;

const pageVectors = `
  SELECT p.id, avg(l2_normalize(c.embedding))::halfvec(2560) AS embedding
  FROM "${schema}".pages p
  JOIN "${schema}".content_chunks c ON c.page_id = p.id
  WHERE p.deleted_at IS NULL AND p.source_id = ANY($1::text[]) AND c.embedding IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM "${schema}".tags graph_hidden_tag
      WHERE graph_hidden_tag.page_id = p.id AND graph_hidden_tag.tag = 'brain-map'
    )
  GROUP BY p.id`;

const exactQuery = `
  WITH page_vectors AS MATERIALIZED (${pageVectors}), ranked AS (
    SELECT a.id AS from_page_id, b.id AS to_page_id,
           1 - (a.embedding <=> b.embedding) AS similarity,
           row_number() OVER (PARTITION BY a.id ORDER BY a.embedding <=> b.embedding, b.id) AS rank
    FROM page_vectors a JOIN page_vectors b ON a.id <> b.id
  )
  SELECT from_page_id, to_page_id, similarity::float8 AS similarity
  FROM ranked WHERE rank <= 2 ORDER BY from_page_id, rank`;

const candidateQuery = `
  WITH page_vectors AS MATERIALIZED (${pageVectors}), raw_candidates AS MATERIALIZED (
    SELECT a.id AS from_page_id, candidate.page_id AS to_page_id
    FROM page_vectors a
    CROSS JOIN LATERAL (
      SELECT c.page_id
      FROM "${schema}".content_chunks c
      WHERE c.embedding IS NOT NULL AND c.page_id <> a.id
      ORDER BY c.embedding <=> a.embedding
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
  FROM ranked WHERE rank <= 2 ORDER BY from_page_id, rank`;

function edgeKey(row: SemanticRow): string {
  return `${row.from_page_id}:${row.to_page_id}`;
}

function planUsesIndex(value: unknown, indexName: string): boolean {
  if (!value || typeof value !== "object") return false;
  if (Array.isArray(value)) return value.some((item) => planUsesIndex(item, indexName));
  const record = value as Record<string, unknown>;
  return record["Index Name"] === indexName || Object.values(record).some((item) => planUsesIndex(item, indexName));
}

function collectPlanNodes(value: unknown, nodes: string[] = []): string[] {
  if (!value || typeof value !== "object") return nodes;
  if (Array.isArray(value)) {
    for (const item of value) collectPlanNodes(item, nodes);
    return nodes;
  }
  const record = value as Record<string, unknown>;
  if (typeof record["Node Type"] === "string") {
    const index = typeof record["Index Name"] === "string" ? `:${record["Index Name"]}` : "";
    nodes.push(`${record["Node Type"]}${index}`);
  }
  for (const item of Object.values(record)) collectPlanNodes(item, nodes);
  return nodes;
}

try {
  await sql.begin(async (tx) => {
    await tx`SET TRANSACTION READ ONLY`;
    await tx`SELECT set_config('statement_timeout', '180s', true)`;
    await tx`SELECT set_config('hnsw.iterative_scan', 'relaxed_order', true)`;
    await tx`SELECT set_config('hnsw.ef_search', '80', true)`;

    const exactStarted = performance.now();
    const exact = await tx.unsafe<SemanticRow[]>(exactQuery, [sources]);
    const exactMs = performance.now() - exactStarted;
    const exactKeys = new Set(exact.map(edgeKey));
    const candidates = [];

    for (const candidateChunks of [16, 32, 64, 128]) {
      const started = performance.now();
      const approximate = await tx.unsafe<SemanticRow[]>(candidateQuery, [sources, candidateChunks]);
      const durationMs = performance.now() - started;
      const overlap = approximate.filter((row) => exactKeys.has(edgeKey(row))).length;
      candidates.push({
        candidateChunks,
        durationMs: Number(durationMs.toFixed(1)),
        edges: approximate.length,
        exactTop2Recall: Number((overlap / Math.max(1, exact.length)).toFixed(4)),
      });
    }

    await tx`SELECT set_config('enable_seqscan', 'off', true)`;
    const forcedStarted = performance.now();
    const forced = await tx.unsafe<SemanticRow[]>(candidateQuery, [sources, 64]);
    const forcedMs = performance.now() - forcedStarted;
    const planRows = await tx.unsafe<Array<{ "QUERY PLAN": unknown }>>(
      `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${candidateQuery}`,
      [sources, 64],
    );
    const plan = planRows[0]?.["QUERY PLAN"];
    console.log(JSON.stringify({
      pages: exact.length / 2,
      exactMs: Number(exactMs.toFixed(1)),
      exactEdges: exact.length,
      candidates,
      forcedHnswMs: Number(forcedMs.toFixed(1)),
      forcedHnswEdges: forced.length,
      usesChunkHnsw: planUsesIndex(plan, "idx_chunks_embedding"),
      planNodes: [...new Set(collectPlanNodes(plan))],
    }));
  });
} finally {
  await sql.end();
}
