import pg from "pg";
import { databaseCredentialsFromEnv } from "./config.js";
import { EMBEDDING_DIMENSIONS } from "./types.js";

const { Client, Pool } = pg;
const APPLICATION_NAME = "gbrain-webui-graphify-hybrid";

let sharedPool: pg.Pool | undefined;

function connectionConfig(cacheCredentials: boolean): pg.ClientConfig {
  return {
    ...databaseCredentialsFromEnv({ cache: cacheCredentials }),
    application_name: APPLICATION_NAME,
    statement_timeout: 60_000,
    query_timeout: 60_000,
  };
}

export function createDatabaseClient(): pg.Client {
  return new Client(connectionConfig(false));
}

export function getSharedDatabasePool(): pg.Pool {
  if (!sharedPool) {
    sharedPool = new Pool({
      ...connectionConfig(true),
      max: 4,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 10_000,
      allowExitOnIdle: true,
    });
  }
  return sharedPool;
}

export async function closeSharedDatabasePool(): Promise<void> {
  const pool = sharedPool;
  sharedPool = undefined;
  if (pool) await pool.end();
}

export function assertPgvectorVersion(version: string): void {
  const match = /^(\d+)\.(\d+)(?:\.(\d+))?/.exec(version.trim());
  if (!match) throw new Error(`Unable to parse pgvector version: ${version}`);
  const major = Number(match[1]);
  const minor = Number(match[2]);
  if (major < 1 && minor < 8) {
    throw new Error(`pgvector 0.8 or newer is required; found ${version}`);
  }
}

export async function setupSchema(client: pg.Client): Promise<void> {
  const extension = await client.query<{ extversion: string }>(
    "SELECT extversion FROM pg_extension WHERE extname = 'vector'",
  );
  if (!extension.rows[0]?.extversion) throw new Error("PostgreSQL extension vector is not installed");
  assertPgvectorVersion(extension.rows[0].extversion);

  await client.query(`
    CREATE TABLE IF NOT EXISTS graphify_node_embeddings (
      project text NOT NULL,
      node_id text NOT NULL,
      graph_sha text NOT NULL,
      content_hash text NOT NULL,
      embedding_model text NOT NULL,
      label text NOT NULL,
      source_file text NOT NULL DEFAULT '',
      source_location text NOT NULL DEFAULT '',
      community integer,
      community_name text NOT NULL DEFAULT '',
      search_text text NOT NULL,
      search_tsv tsvector GENERATED ALWAYS AS (
        to_tsvector('simple', coalesce(search_text, ''))
      ) STORED,
      embedding halfvec(${EMBEDDING_DIMENSIONS}) NOT NULL,
      metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
      indexed_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (project, node_id)
    )
  `);
  await client.query(`
    CREATE INDEX IF NOT EXISTS graphify_node_embeddings_hnsw
    ON graphify_node_embeddings
    USING hnsw (embedding halfvec_cosine_ops)
    WITH (m = 16, ef_construction = 96)
  `);
  await client.query(`
    CREATE INDEX IF NOT EXISTS graphify_node_embeddings_fts
    ON graphify_node_embeddings USING gin (search_tsv)
  `);
  await client.query(`
    CREATE INDEX IF NOT EXISTS graphify_node_embeddings_source
    ON graphify_node_embeddings (project, source_file)
  `);
  await client.query(`
    CREATE TABLE IF NOT EXISTS graphify_index_runs (
      id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      project text NOT NULL,
      graph_sha text NOT NULL,
      embedding_model text NOT NULL,
      retrieval_input_hash text,
      node_count integer NOT NULL,
      embedded_count integer NOT NULL,
      reused_count integer NOT NULL,
      removed_count integer NOT NULL,
      duration_ms bigint NOT NULL,
      completed_at timestamptz NOT NULL DEFAULT now()
    )
  `);
  await client.query(
    "ALTER TABLE graphify_index_runs ADD COLUMN IF NOT EXISTS retrieval_input_hash text",
  );
}

export async function withSharedDatabaseClient<T>(
  operation: (client: pg.PoolClient) => Promise<T>,
): Promise<T> {
  const client = await getSharedDatabasePool().connect();
  try {
    return await operation(client);
  } finally {
    client.release();
  }
}
