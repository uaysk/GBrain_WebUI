import { afterEach, describe, expect, it } from "bun:test";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  apiRequest,
  validateEmbeddingResponse,
  validateRerankRows,
} from "./api-client.js";
import { parseCliArgs } from "./cli-options.js";
import { databaseCredentialsFromEnv } from "./config.js";
import { assertPgvectorVersion } from "./database.js";
import { buildRetrievalDocuments, loadGraphArtifact } from "./documents.js";
import { databaseRankings } from "./ranking.js";
import { loadSecureEnvFile } from "./secure-env.js";
import { validateSynthesis } from "./synthesis.js";
import { EMBEDDING_DIMENSIONS, type GraphData } from "./types.js";

const temporaryDirectories: string[] = [];
const environmentSnapshot = { ...process.env };

async function temporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(path.join(tmpdir(), "graphify-hardening-"));
  temporaryDirectories.push(directory);
  return directory;
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => (
    rm(directory, { recursive: true, force: true })
  )));
  for (const key of Object.keys(process.env)) {
    if (!(key in environmentSnapshot)) delete process.env[key];
  }
  Object.assign(process.env, environmentSnapshot);
});

const apiConfig = {
  endpoint: "https://example.invalid/v1",
  apiKey: "test",
  embeddingModel: "embedding",
  rerankerModel: "reranker",
  synthesisModel: "synthesis",
};

describe("Graphify hybrid API policy", () => {
  it("does not retry an HTTP 400 response", async () => {
    let calls = 0;
    const fetchImpl = (async () => {
      calls += 1;
      return new Response(JSON.stringify({ error: { message: "invalid" } }), { status: 400 });
    }) as unknown as typeof fetch;
    await expect(apiRequest("/embeddings", {}, {
      config: apiConfig,
      fetchImpl,
      sleep: async () => undefined,
    })).rejects.toThrow("HTTP 400");
    expect(calls).toBe(1);
  });

  it("retries only retryable responses and honors the retry cap", async () => {
    let calls = 0;
    const delays: number[] = [];
    const fetchImpl = (async () => {
      calls += 1;
      if (calls === 1) {
        return new Response(JSON.stringify({ error: { message: "busy" } }), {
          status: 429,
          headers: { "retry-after": "0" },
        });
      }
      if (calls === 2) {
        return new Response(JSON.stringify({ error: { message: "unavailable" } }), { status: 503 });
      }
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }) as unknown as typeof fetch;
    await expect(apiRequest<{ ok: boolean }>("/rerank", {}, {
      config: apiConfig,
      fetchImpl,
      sleep: async (delay) => { delays.push(delay); },
      random: () => 0.5,
    })).resolves.toEqual({ ok: true });
    expect(calls).toBe(3);
    expect(delays).toHaveLength(2);
    expect(delays[0]).toBe(0);
  });

  it("rejects malformed embedding, rerank, and synthesis results", () => {
    const vector = Array(EMBEDDING_DIMENSIONS).fill(0);
    vector[10] = Number.NaN;
    expect(() => validateEmbeddingResponse({ data: [{ index: 0, embedding: vector }] }, 1))
      .toThrow("shape mismatch");
    expect(() => validateRerankRows({ results: [
      { index: 0, relevance_score: 1 },
      { index: 0, relevance_score: 0.5 },
    ] }, 2)).toThrow("duplicate index");
    expect(() => validateSynthesis({ answer: "answer", evidence: [], limitations: "none" }))
      .toThrow("shape mismatch");
  });
});

describe("Graphify hybrid input and persistence boundaries", () => {
  it("reads each canonical source file once per document build", async () => {
    const root = await temporaryDirectory();
    await writeFile(path.join(root, "shared.ts"), "export const shared = true;\n", { mode: 0o600 });
    let reads = 0;
    const graph: GraphData = {
      nodes: [
        { id: "a", source_file: "shared.ts", source_location: "L1" },
        { id: "b", source_file: "shared.ts", source_location: "L1" },
      ],
      links: [],
    };
    await buildRetrievalDocuments({
      graph,
      root,
      project: "gbrain-webui",
      graphSha: "sha",
      embeddingModel: "model",
      sourceCache: { onSourceRead: () => { reads += 1; } },
    });
    expect(reads).toBe(1);
  });

  it("defines graph_sha from the exact graph.json bytes", async () => {
    const root = await temporaryDirectory();
    const first = path.join(root, "first.json");
    const second = path.join(root, "second.json");
    await writeFile(first, "{\"nodes\":[]}\n");
    await writeFile(second, "{ \"nodes\": [] }\n");
    expect((await loadGraphArtifact(first)).graphSha).not.toBe((await loadGraphArtifact(second)).graphSha);
  });

  it("requires a regular owner-only environment file", async () => {
    const root = await temporaryDirectory();
    const envFile = path.join(root, ".env.graphify");
    await writeFile(envFile, "GRAPHIFY_TEST_VALUE=loaded\n", { mode: 0o644 });
    await expect(loadSecureEnvFile(envFile)).rejects.toThrow("mode 0600");
    await chmod(envFile, 0o600);
    await loadSecureEnvFile(envFile);
    expect(process.env.GRAPHIFY_TEST_VALUE).toBe("loaded");
  });

  it("requires pgvector 0.8 or newer", () => {
    expect(() => assertPgvectorVersion("0.7.4")).toThrow("0.8 or newer");
    expect(() => assertPgvectorVersion("0.8.0")).not.toThrow();
    expect(() => assertPgvectorVersion("1.0.0")).not.toThrow();
  });

  it("verifies PostgreSQL TLS unless the legacy opt-in is explicit", () => {
    process.env.GRAPHIFY_DATABASE_URL = "postgresql://user:password@db.example:5432/graphify?sslmode=require";
    delete process.env.GRAPHIFY_PG_TLS_LEGACY_INSECURE;
    expect(databaseCredentialsFromEnv().ssl).toMatchObject({ rejectUnauthorized: true });
    process.env.GRAPHIFY_PG_TLS_LEGACY_INSECURE = "1";
    expect(databaseCredentialsFromEnv().ssl).toMatchObject({ rejectUnauthorized: false });
  });
});

describe("Graphify hybrid strict CLI and vector query", () => {
  it("rejects unknown, missing, fractional, non-numeric, and foreign-project options", () => {
    expect(() => parseCliArgs(["query", "question", "--wat"])).toThrow("Unknown option");
    expect(() => parseCliArgs(["query", "question", "--depth"])).toThrow("requires a value");
    expect(() => parseCliArgs(["query", "question", "--depth=1.5"])).toThrow("integer");
    expect(() => parseCliArgs(["query", "question", "--top-k=NaN"])).toThrow("integer");
    expect(() => parseCliArgs(["index", "--concurrency=9"])).toThrow();
    expect(() => parseCliArgs(["status", "--project=another-project"])).toThrow("only supports");
  });

  it("uses bounded strict-order HNSW scanning with a project filter", async () => {
    const calls: Array<{ sql: string; values?: unknown[] }> = [];
    const client = {
      async query(sql: string, values?: unknown[]) {
        calls.push({ sql, values });
        if (sql.includes("pg_extension")) return { rows: [{ extversion: "0.8.1" }] };
        if (sql.includes("1 - (embedding")) return { rows: [] };
        if (sql.includes("ts_rank_cd")) return { rows: [] };
        return { rows: [] };
      },
    };
    await databaseRankings(client as never, "gbrain-webui", "question", 25, {
      embed: async () => [Array(EMBEDDING_DIMENSIONS).fill(0)],
    });
    expect(calls.some((call) => call.sql.includes("hnsw.iterative_scan = 'strict_order'"))).toBe(true);
    expect(calls.some((call) => call.sql.includes("hnsw.ef_search = 200"))).toBe(true);
    expect(calls.some((call) => call.sql.includes("hnsw.max_scan_tuples = 20000"))).toBe(true);
    const sortOff = calls.findIndex((call) => call.sql.includes("enable_sort = off"));
    const vectorQuery = calls.find((call) => call.sql.includes("1 - (embedding"))!;
    const vectorQueryIndex = calls.indexOf(vectorQuery);
    const sortOn = calls.findIndex((call) => call.sql.includes("enable_sort = on"));
    const ftsQuery = calls.findIndex((call) => call.sql.includes("ts_rank_cd"));
    expect(sortOff).toBeGreaterThan(-1);
    expect(sortOff).toBeLessThan(vectorQueryIndex);
    expect(sortOn).toBeGreaterThan(vectorQueryIndex);
    expect(sortOn).toBeLessThan(ftsQuery);
    expect(vectorQuery.sql).toContain("WHERE project = $1");
    expect(vectorQuery.values?.[0]).toBe("gbrain-webui");
    expect(vectorQuery.values?.[2]).toBe(25);
  });
});
