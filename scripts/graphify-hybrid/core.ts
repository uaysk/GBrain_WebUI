// Compatibility barrel. Keep existing imports stable while implementation lives in
// focused modules with explicit configuration, persistence, retrieval, and API boundaries.
export * from "./types.js";
export * from "./config.js";
export * from "./database.js";
export * from "./documents.js";
export * from "./api-client.js";
export * from "./indexer.js";
export * from "./ranking.js";
export * from "./synthesis.js";
