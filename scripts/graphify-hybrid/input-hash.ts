#!/usr/bin/env bun
import path from "node:path";
import { buildRetrievalInput } from "./documents.js";
import { loadSecureEnvFile } from "./secure-env.js";
import { DEFAULT_PROJECT } from "./types.js";

const graphPath = process.argv[2] || "graphify-out/graph.json";
const root = process.argv[3] || ".";
const project = process.argv[4] || "gbrain-webui";
await loadSecureEnvFile(path.resolve(root, ".env.graphify"));
if (project !== DEFAULT_PROJECT) {
  throw new Error(`This repository index only supports project ${DEFAULT_PROJECT}`);
}
const embeddingModel = process.env.GRAPHIFY_EMBEDDING_MODEL?.trim() || "qwen3-embedding-4b";
const retrieval = await buildRetrievalInput({
  graphPath,
  root,
  project,
  embeddingModel,
});
console.log(retrieval.retrievalInputHash);
