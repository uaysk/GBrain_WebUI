# Graphify hybrid retrieval

GBrain WebUI combines Graphify's deterministic graph traversal with a persistent
hybrid retrieval layer:

1. Graphify lexical symbol/path matching.
2. Qwen3 Embedding 4B vectors stored as `halfvec(2560)`.
3. PostgreSQL full-text search.
4. Reciprocal-rank fusion.
5. Qwen3 Reranker 4B over a bounded candidate set.
6. Bidirectional BFS over real Graphify edges.
7. GPT-5.3 Codex Spark structured synthesis with source locations.

Secrets stay in `.env.graphify` and `pg/Secret/graphify-db`. The repository's
MCP configuration contains no credentials. The CNPG database is shared with
other Graphify-enabled repositories, while rows are isolated by the exact
project key `gbrain-webui`.

The launcher refuses symlinks, non-regular files, foreign ownership, and any
mode other than `0600` for `.env.graphify`; it also applies `umask 077` before
starting Bun. PostgreSQL TLS verifies the server certificate by default when
enabled. A private CA can be selected with `GRAPHIFY_PG_SSL_CA_FILE`; disabling
verification requires the explicit legacy-only
`GRAPHIFY_PG_TLS_LEGACY_INSECURE=1` opt-in.

## Commands

```bash
scripts/graphify-hybrid/run.sh setup
scripts/graphify-hybrid/run.sh index --project gbrain-webui
scripts/graphify-hybrid/run.sh query "한국어 또는 영어 코드 질문" --project gbrain-webui
scripts/graphify-hybrid/run.sh query "호출 관계" --project gbrain-webui --context call
scripts/graphify-hybrid/run.sh query "검색 근거만" --project gbrain-webui --no-synthesis
scripts/graphify-hybrid/run.sh status --project gbrain-webui
scripts/graphify-hybrid/run.sh benchmark --project gbrain-webui --out graphify-out/hybrid-benchmark.json
```

The indexer defines `graph_sha` as SHA-256 of the exact `graph.json` bytes. It
builds a second `retrieval_input_hash` from that graph hash, the embedding
model, and sorted retrieval-document content hashes. Node documents are
re-embedded only when their content changes, and stale rows are removed only
after a successful replacement-safety check. `status` reports old run rows
without `retrieval_input_hash` as stale until the next successful index.

Source snippets use a canonical-path Promise cache scoped to one document
build, so a shared, missing, oversized, or binary source is read and classified
once. API calls retry only network failures, 408, 429, and 5xx responses, at
most four attempts while respecting `Retry-After`; other 4xx failures are
immediate. Embedding dimensions/finiteness, reranker indexes, and structured
synthesis are validated before use.

The vector query requires pgvector 0.8 or newer and uses transaction-local
`hnsw.iterative_scan=strict_order`, `hnsw.ef_search=200`, and a bounded scan
with the project filter inside the query. Because the representative corpus's
cost estimate otherwise prefers the project/source B-tree plus an exact sort,
`enable_sort=off` is scoped to the vector query and restored before FTS. The
long-running MCP process uses a
four-connection pool; CLI/indexing connections are always closed.

The implementation is split into `config`, `database`, `documents`,
`api-client`, `indexer`, `ranking`, and `synthesis` modules. `core.ts` remains a
compatibility barrel for existing CLI/tests and integrations.

## Graph build and exports

The repository graph includes structural TypeScript/React code, semantically
extracted documentation, and a schema-only GBrain PostgreSQL overlay. Generated
artifacts live under the ignored `graphify-out/` directory:

- `graph.json`, `graph.html`, and `GRAPH_REPORT.md`
- `wiki/`
- `GRAPH_TREE.html`
- `gbrain-webui-callflow.html`
- `graph.graphml`

## Kubernetes resources

- CNPG cluster: `pg/Cluster/pg-prod-block`
- Database: `pg/Database/graphify`
- Login Secret: `pg/Secret/graphify-db`
- PostgreSQL database/owner: `graphify`
- Extension: `vector`

The same database resource is declared in `infra/graphify/cnpg-database.yaml`
for reproducibility. Applying it is idempotent; this repository does not need a
second database or a second credential.

## MCP

`.mcp.json` exposes:

- `graphify`: native graph navigation through the loopback-only
  `gbrain-webui-graphify-mcp.service`.
- `graphify-hybrid`: lexical/vector/FTS/reranking retrieval, bounded graph
  expansion, optional synthesis, and index status.

The native server uses stateless Streamable HTTP because the installed Python
MCP stdio transport currently stalls during initialization; the hybrid server
uses stdio and starts on demand.

## Scheduled indexing and benchmarks

`gbrain-webui-graphify-indexing.path` schedules a locked index refresh after
`graph.json` changes. The indexing oneshot records its marker only after index
verification and global graph registration succeed. Benchmarking is a separate
oneshot triggered by that marker; it runs only when the graph, embedding and
reranker models, or benchmark cases change. The units use owner-only umasks,
bounded start/stop limits, read-only system/home protection with explicit write
paths, private temporary/device views, and empty capability sets.
