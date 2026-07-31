import { apiConfigFromEnv } from "./config.js";
import { embedTexts } from "./api-client.js";
import { createDatabaseClient, setupSchema, withSharedDatabaseClient } from "./database.js";
import { buildRetrievalInput } from "./documents.js";
import { DEFAULT_PROJECT, type RetrievalDocument } from "./types.js";

export async function runContinuousBatchWorkers<T>(
  items: T[],
  batchSize: number,
  concurrency: number,
  worker: (batch: T[]) => Promise<void>,
): Promise<void> {
  if (!Number.isInteger(batchSize) || batchSize < 1) throw new Error("batchSize must be a positive integer");
  if (!Number.isInteger(concurrency) || concurrency < 1) throw new Error("concurrency must be a positive integer");
  let nextOffset = 0;
  const workerCount = Math.min(concurrency, Math.ceil(items.length / batchSize));
  await Promise.all(
    Array.from({ length: workerCount }, async () => {
      while (nextOffset < items.length) {
        const offset = nextOffset;
        nextOffset += batchSize;
        await worker(items.slice(offset, offset + batchSize));
      }
    }),
  );
}

export function assertSafeProjectReplacement(
  existingNodeIds: string[],
  documentNodeIds: string[],
  allowReplacement = false,
): void {
  if (allowReplacement || existingNodeIds.length < 100 || documentNodeIds.length < 100) return;
  const documents = new Set(documentNodeIds);
  const overlap = existingNodeIds.filter((nodeId) => documents.has(nodeId)).length;
  const denominator = Math.min(existingNodeIds.length, documentNodeIds.length);
  const overlapRatio = denominator > 0 ? overlap / denominator : 1;
  if (overlapRatio < 0.25) {
    throw new Error(
      `Refusing to replace project index: only ${overlap}/${denominator} node IDs overlap. `
      + "Verify --project, or set GRAPHIFY_ALLOW_PROJECT_REPLACEMENT=1 for an intentional full replacement.",
    );
  }
}

function vectorLiteral(vector: number[]): string {
  return `[${vector.join(",")}]`;
}

async function writeDocumentBatch(
  client: ReturnType<typeof createDatabaseClient>,
  documents: RetrievalDocument[],
  vectors: number[][],
  embeddingModel: string,
): Promise<void> {
  const values: unknown[] = [];
  const rows = documents.map((document, index) => {
    const base = values.length;
    values.push(
      document.project,
      document.nodeId,
      document.graphSha,
      document.contentHash,
      embeddingModel,
      document.label,
      document.sourceFile,
      document.sourceLocation,
      document.community,
      document.communityName,
      document.searchText,
      vectorLiteral(vectors[index]),
      JSON.stringify(document.metadata),
    );
    const parameter = (position: number) => `$${base + position}`;
    return `(${parameter(1)},${parameter(2)},${parameter(3)},${parameter(4)},${parameter(5)},`
      + `${parameter(6)},${parameter(7)},${parameter(8)},${parameter(9)},${parameter(10)},`
      + `${parameter(11)},${parameter(12)}::halfvec,${parameter(13)}::jsonb)`;
  });
  await client.query(
    `INSERT INTO graphify_node_embeddings (
      project,node_id,graph_sha,content_hash,embedding_model,label,source_file,
      source_location,community,community_name,search_text,embedding,metadata
    ) VALUES ${rows.join(",")}
    ON CONFLICT (project,node_id) DO UPDATE SET
      graph_sha=EXCLUDED.graph_sha,
      content_hash=EXCLUDED.content_hash,
      embedding_model=EXCLUDED.embedding_model,
      label=EXCLUDED.label,
      source_file=EXCLUDED.source_file,
      source_location=EXCLUDED.source_location,
      community=EXCLUDED.community,
      community_name=EXCLUDED.community_name,
      search_text=EXCLUDED.search_text,
      embedding=EXCLUDED.embedding,
      metadata=EXCLUDED.metadata,
      indexed_at=now()`,
    values,
  );
}

export async function indexGraph(input: {
  graphPath?: string;
  root?: string;
  project?: string;
  graphSha?: string;
  batchSize?: number;
  concurrency?: number;
  onProgress?: (done: number, total: number, reused: number) => void;
}): Promise<{
  graphSha: string;
  retrievalInputHash: string;
  nodeCount: number;
  embeddedCount: number;
  reusedCount: number;
  removedCount: number;
  durationMs: number;
}> {
  const started = performance.now();
  const config = apiConfigFromEnv({ cache: true });
  const project = input.project || DEFAULT_PROJECT;
  const retrieval = await buildRetrievalInput({
    graphPath: input.graphPath,
    root: input.root,
    project,
    embeddingModel: config.embeddingModel,
  });
  if (input.graphSha && input.graphSha !== retrieval.graphSha) {
    throw new Error(
      `--sha does not match graph.json content: expected ${retrieval.graphSha}, received ${input.graphSha}`,
    );
  }
  const documents = retrieval.documents;
  const client = createDatabaseClient();
  await client.connect();
  try {
    await setupSchema(client);
    const existing = await client.query<{ node_id: string; content_hash: string; embedding_model: string }>(
      `SELECT node_id, content_hash, embedding_model
       FROM graphify_node_embeddings WHERE project = $1`,
      [project],
    );
    assertSafeProjectReplacement(
      existing.rows.map((row) => row.node_id),
      documents.map((document) => document.nodeId),
      process.env.GRAPHIFY_ALLOW_PROJECT_REPLACEMENT === "1",
    );
    const hashes = new Map(existing.rows.map((row) => [row.node_id, `${row.embedding_model}:${row.content_hash}`]));
    const pending = documents.filter(
      (document) => hashes.get(document.nodeId) !== `${config.embeddingModel}:${document.contentHash}`,
    );
    const reusedCount = documents.length - pending.length;
    const batchSize = Math.max(1, Math.min(64, input.batchSize || 64));
    const concurrency = Math.max(1, Math.min(8, input.concurrency || 4));
    let embeddedCount = 0;
    let databaseWriteTail: Promise<void> = Promise.resolve();
    await runContinuousBatchWorkers(pending, batchSize, concurrency, async (batch) => {
      const vectors = await embedTexts(batch.map((document) => document.searchText));
      const write = databaseWriteTail.then(
        () => writeDocumentBatch(client, batch, vectors, config.embeddingModel),
      );
      databaseWriteTail = write.catch(() => undefined);
      await write;
      embeddedCount += batch.length;
      input.onProgress?.(embeddedCount, pending.length, reusedCount);
    });
    await client.query(
      `UPDATE graphify_node_embeddings
       SET graph_sha = $2
       WHERE project = $1 AND graph_sha <> $2`,
      [project, retrieval.graphSha],
    );
    const removed = await client.query(
      `DELETE FROM graphify_node_embeddings
       WHERE project = $1 AND NOT (node_id = ANY($2::text[]))`,
      [project, documents.map((document) => document.nodeId)],
    );
    const removedCount = removed.rowCount || 0;
    const durationMs = Math.round(performance.now() - started);
    await client.query(
      `INSERT INTO graphify_index_runs (
        project,graph_sha,embedding_model,retrieval_input_hash,node_count,
        embedded_count,reused_count,removed_count,duration_ms
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [
        project,
        retrieval.graphSha,
        config.embeddingModel,
        retrieval.retrievalInputHash,
        documents.length,
        embeddedCount,
        reusedCount,
        removedCount,
        durationMs,
      ],
    );
    return {
      graphSha: retrieval.graphSha,
      retrievalInputHash: retrieval.retrievalInputHash,
      nodeCount: documents.length,
      embeddedCount,
      reusedCount,
      removedCount,
      durationMs,
    };
  } finally {
    await client.end();
  }
}

export async function indexStatus(
  project = DEFAULT_PROJECT,
  currentRetrievalInputHash?: string,
): Promise<Record<string, unknown>> {
  return withSharedDatabaseClient(async (client) => {
    const result = await client.query(
      `SELECT project, graph_sha, embedding_model,
              to_jsonb(graphify_index_runs)->>'retrieval_input_hash' AS retrieval_input_hash, node_count,
              embedded_count, reused_count, removed_count, duration_ms, completed_at
       FROM graphify_index_runs
       WHERE project = $1
       ORDER BY completed_at DESC LIMIT 1`,
      [project],
    );
    const count = await client.query(
      `SELECT count(*)::int AS count, min(indexed_at) AS oldest, max(indexed_at) AS newest
       FROM graphify_node_embeddings WHERE project = $1`,
      [project],
    );
    const latestRun = result.rows[0] || null;
    return {
      latestRun,
      index: count.rows[0],
      freshness: {
        currentRetrievalInputHash: currentRetrievalInputHash || null,
        fresh: Boolean(
          currentRetrievalInputHash
          && latestRun?.retrieval_input_hash
          && currentRetrievalInputHash === latestRun.retrieval_input_hash
        ),
        reason: !latestRun?.retrieval_input_hash
          ? "latest successful run predates retrieval_input_hash"
          : !currentRetrievalInputHash
            ? "current retrieval input hash was not evaluated"
            : currentRetrievalInputHash === latestRun.retrieval_input_hash
              ? "current"
              : "graph, model, or source content changed",
      },
    };
  });
}
