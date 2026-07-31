#!/usr/bin/env bun
import { readFile, writeFile } from "node:fs/promises";

type NodeRecord = {
  id: string;
  _origin?: string;
  source_file?: string;
  file_type?: string;
  [key: string]: unknown;
};

type LinkRecord = {
  source: string;
  target: string;
  _origin?: string;
  relation?: string;
  source_file?: string;
  [key: string]: unknown;
};

type HyperedgeRecord = { id: string; nodes?: string[]; [key: string]: unknown };

type GraphRecord = {
  directed?: boolean;
  multigraph?: boolean;
  graph?: Record<string, unknown>;
  nodes: NodeRecord[];
  links?: LinkRecord[];
  edges?: LinkRecord[];
  hyperedges?: HyperedgeRecord[];
};

function option(name: string, fallback?: string): string | undefined {
  const direct = process.argv.find((value) => value.startsWith(`--${name}=`));
  if (direct) return direct.slice(name.length + 3);
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

async function readGraph(file: string): Promise<GraphRecord> {
  const graph = JSON.parse(await readFile(file, "utf8")) as GraphRecord;
  if (!Array.isArray(graph.nodes)) throw new Error(`Invalid graph: ${file}`);
  return graph;
}

async function readOptionalGraph(file?: string): Promise<GraphRecord | null> {
  return file ? readGraph(file) : null;
}

function graphLinks(graph: GraphRecord | null): LinkRecord[] {
  return graph?.links || graph?.edges || [];
}

function edgeKey(edge: LinkRecord): string {
  return [
    edge.source,
    edge.target,
    edge.relation || "",
    edge.source_file || "",
    edge.source_location || "",
  ].join("\0");
}

const output = option("output", "graphify-out/graph.json")!;
const basePath = option("base", output)!;
const semanticPath = option("semantic");
const databasePath = option("database");
const cargoPath = option("cargo");
const databasePrefix = option("database-prefix", "gbrain")!;
const databaseLabel = option("database-label", "GBrain database")!;
const databaseSource = option("database-source", "database/gbrain/schema.sql")!;
const cargoSource = option("cargo-source", "Cargo.toml")!;

const [base, semantic, database, cargo] = await Promise.all([
  readGraph(basePath),
  readOptionalGraph(semanticPath),
  readOptionalGraph(databasePath),
  readOptionalGraph(cargoPath),
]);

const nodeById = new Map(base.nodes.map((node) => [node.id, node]));
const outputLinks = [...graphLinks(base)];
const seenEdges = new Set(outputLinks.map(edgeKey));

let semanticNodesAdded = 0;
for (const node of semantic?.nodes.filter((candidate) => candidate._origin !== "ast") || []) {
  if (!nodeById.has(node.id)) {
    nodeById.set(node.id, { ...node, _origin: "semantic" });
    semanticNodesAdded += 1;
  }
}

let semanticEdgesAdded = 0;
for (const edge of graphLinks(semantic).filter((candidate) => candidate._origin !== "ast")) {
  if (!nodeById.has(String(edge.source)) || !nodeById.has(String(edge.target))) continue;
  const added = { ...edge, _origin: "semantic" };
  const key = edgeKey(added);
  if (!seenEdges.has(key)) {
    seenEdges.add(key);
    outputLinks.push(added);
    semanticEdgesAdded += 1;
  }
}

const dbId = (id: string) => `db:${databasePrefix}:${id}`;
let databaseNodesAdded = 0;
for (const node of database?.nodes || []) {
  const id = dbId(node.id);
  if (nodeById.has(id)) continue;
  nodeById.set(id, {
    ...node,
    id,
    label: node.id === "schema" ? databaseLabel : node.label,
    file_type: "database",
    source_file: databaseSource,
    community_name: "PostgreSQL Schema",
    _origin: "database_schema",
  });
  databaseNodesAdded += 1;
}

let databaseEdgesAdded = 0;
for (const edge of graphLinks(database)) {
  const added = {
    ...edge,
    source: dbId(String(edge.source)),
    target: dbId(String(edge.target)),
    source_file: databaseSource,
    _origin: "database_schema",
  };
  if (!nodeById.has(added.source) || !nodeById.has(added.target)) continue;
  const key = edgeKey(added);
  if (!seenEdges.has(key)) {
    seenEdges.add(key);
    outputLinks.push(added);
    databaseEdgesAdded += 1;
  }
}

let cargoNodesAdded = 0;
for (const node of cargo?.nodes.filter((candidate) => candidate.id.startsWith("crate:")) || []) {
  if (!nodeById.has(node.id)) {
    nodeById.set(node.id, {
      ...node,
      source_file: cargoSource,
      community_name: "Rust Workspace",
      _origin: "cargo",
    });
    cargoNodesAdded += 1;
  }
}

let cargoEdgesAdded = 0;
for (const edge of graphLinks(cargo)) {
  if (!nodeById.has(String(edge.source)) || !nodeById.has(String(edge.target))) continue;
  const added = { ...edge, source_file: cargoSource, _origin: "cargo" };
  const key = edgeKey(added);
  if (!seenEdges.has(key)) {
    seenEdges.add(key);
    outputLinks.push(added);
    cargoEdgesAdded += 1;
  }
}

const hyperedgeById = new Map<string, HyperedgeRecord>();
for (const hyperedge of [
  ...(base.hyperedges || []),
  ...(semantic?.hyperedges || []),
]) {
  if (!hyperedge.id) continue;
  if ((hyperedge.nodes || []).every((id) => nodeById.has(id))) {
    hyperedgeById.set(hyperedge.id, hyperedge);
  }
}

const overlaySources = Object.fromEntries(
  Object.entries({
    semantic_source: semanticPath,
    database_source: databasePath,
    cargo_source: cargoPath,
  }).filter((entry): entry is [string, string] => Boolean(entry[1])),
);

const result: GraphRecord = {
  ...base,
  directed: true,
  multigraph: false,
  graph: {
    ...(base.graph || {}),
    hybrid_overlay: overlaySources,
  },
  nodes: [...nodeById.values()],
  links: outputLinks,
  hyperedges: [...hyperedgeById.values()],
};
delete result.edges;

await writeFile(output, `${JSON.stringify(result, null, 2)}\n`);
console.log(JSON.stringify({
  nodes: result.nodes.length,
  edges: result.links?.length || 0,
  hyperedges: result.hyperedges?.length || 0,
  semanticNodesAdded,
  semanticEdgesAdded,
  databaseNodesAdded,
  databaseEdgesAdded,
  cargoNodesAdded,
  cargoEdgesAdded,
  directed: result.directed,
  overlaySources,
}, null, 2));
