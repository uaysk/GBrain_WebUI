export interface Config {
  db: { host: string; port: number; database: string; user: string; password: string; schema: string };
  community: { resolution: number; minSemanticSimilarity: number; seed: number };
  auth: { password: string; sessionSecret: string; sessionHours: number; maxAttempts: number; attemptWindowMinutes: number };
  controlCenter: {
    mcpUrl: string | null;
    mcpToken: string | null;
    requestTimeoutMs: number;
    cacheMs: number;
    mutationsEnabled: boolean;
    actionLedgerPath: string | null;
  };
  allowedSourceIds: string[];
  host: string;
  port: number;
  trustProxyHops: number;
  publicOrigin: string | null;
  rebuildMinIntervalSeconds: number;
  rebuildStatementTimeoutSeconds: number;
  semanticCandidateChunks: number;
  semanticHnswEfSearch: number;
  snapshotPath: string | null;
}

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

function safeIdentifier(value: string, name: string): string {
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(value)) throw new Error(`${name} must be a safe PostgreSQL identifier`);
  return value;
}

function optionalHttpUrl(name: string, allowInsecureHttp: boolean): string | null {
  const value = process.env[name]?.trim();
  if (!value) return null;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${name} must be a valid HTTP(S) URL`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error(`${name} must use HTTP or HTTPS`);
  if (url.username || url.password) throw new Error(`${name} must not contain credentials`);
  const loopback = ["localhost", "127.0.0.1", "::1", "[::1]"].includes(url.hostname);
  if (url.protocol === "http:" && !loopback && !allowInsecureHttp) {
    throw new Error(`${name} must use HTTPS outside loopback unless GBRAIN_CONTROL_ALLOW_INSECURE_HTTP=true`);
  }
  return url.toString();
}

export function loadConfig(): Config {
  const port = Number(process.env.GBRAIN_DB_PORT ?? "5432");
  const appPort = Number(process.env.APP_PORT ?? "3000");
  const trustProxyHops = Number(process.env.APP_TRUST_PROXY_HOPS ?? "0");
  const rebuildMinIntervalSeconds = Number(process.env.APP_REBUILD_MIN_INTERVAL_SECONDS ?? "15");
  const rebuildStatementTimeoutSeconds = Number(process.env.APP_REBUILD_STATEMENT_TIMEOUT_SECONDS ?? "600");
  const semanticCandidateChunks = Number(process.env.APP_SEMANTIC_CANDIDATE_CHUNKS ?? "64");
  const semanticHnswEfSearch = Number(process.env.APP_SEMANTIC_HNSW_EF_SEARCH ?? "80");
  const controlRequestTimeoutSeconds = Number(process.env.APP_CONTROL_CENTER_REQUEST_TIMEOUT_SECONDS ?? "10");
  const controlCacheSeconds = Number(process.env.APP_CONTROL_CENTER_CACHE_SECONDS ?? "10");
  const leidenResolution = Number(process.env.LEIDEN_RESOLUTION ?? "0.5");
  const leidenMinSemanticSimilarity = Number(process.env.LEIDEN_MIN_SEMANTIC_SIMILARITY ?? "0.65");
  const leidenSeed = Number(process.env.LEIDEN_SEED ?? "84");
  const sessionHours = Number(process.env.APP_AUTH_SESSION_HOURS ?? "12");
  const maxAttempts = Number(process.env.APP_AUTH_MAX_ATTEMPTS ?? "5");
  const attemptWindowMinutes = Number(process.env.APP_AUTH_ATTEMPT_WINDOW_MINUTES ?? "15");
  if (!Number.isInteger(port) || !Number.isInteger(appPort) || !Number.isFinite(rebuildMinIntervalSeconds) || rebuildMinIntervalSeconds < 0) throw new Error("Ports and rebuild interval must be valid numbers");
  if (!Number.isInteger(trustProxyHops) || trustProxyHops < 0 || trustProxyHops > 16) throw new Error("APP_TRUST_PROXY_HOPS must be an integer between 0 and 16");
  if (!Number.isFinite(rebuildStatementTimeoutSeconds) || rebuildStatementTimeoutSeconds <= 0 || rebuildStatementTimeoutSeconds > 3600) throw new Error("APP_REBUILD_STATEMENT_TIMEOUT_SECONDS must be greater than 0 and at most 3600");
  if (!Number.isInteger(semanticCandidateChunks) || semanticCandidateChunks < 8 || semanticCandidateChunks > 1024) throw new Error("APP_SEMANTIC_CANDIDATE_CHUNKS must be an integer between 8 and 1024");
  if (!Number.isInteger(semanticHnswEfSearch) || semanticHnswEfSearch < 8 || semanticHnswEfSearch > 1000) throw new Error("APP_SEMANTIC_HNSW_EF_SEARCH must be an integer between 8 and 1000");
  if (!Number.isFinite(controlRequestTimeoutSeconds) || controlRequestTimeoutSeconds < 1 || controlRequestTimeoutSeconds > 60) throw new Error("APP_CONTROL_CENTER_REQUEST_TIMEOUT_SECONDS must be between 1 and 60");
  if (!Number.isFinite(controlCacheSeconds) || controlCacheSeconds < 0 || controlCacheSeconds > 300) throw new Error("APP_CONTROL_CENTER_CACHE_SECONDS must be between 0 and 300");
  if (!Number.isFinite(leidenResolution) || leidenResolution <= 0) throw new Error("LEIDEN_RESOLUTION must be greater than zero");
  if (!Number.isFinite(leidenMinSemanticSimilarity) || leidenMinSemanticSimilarity < -1 || leidenMinSemanticSimilarity > 1) throw new Error("LEIDEN_MIN_SEMANTIC_SIMILARITY must be between -1 and 1");
  if (!Number.isInteger(leidenSeed)) throw new Error("LEIDEN_SEED must be an integer");
  if (!Number.isFinite(sessionHours) || sessionHours <= 0 || sessionHours > 168) throw new Error("APP_AUTH_SESSION_HOURS must be between 0 and 168");
  if (!Number.isInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > 100) throw new Error("APP_AUTH_MAX_ATTEMPTS must be an integer between 1 and 100");
  if (!Number.isFinite(attemptWindowMinutes) || attemptWindowMinutes <= 0 || attemptWindowMinutes > 1440) throw new Error("APP_AUTH_ATTEMPT_WINDOW_MINUTES must be between 0 and 1440");
  const authPassword = required("APP_AUTH_PASSWORD");
  const sessionSecret = required("APP_SESSION_SECRET");
  if (sessionSecret.length < 32) throw new Error("APP_SESSION_SECRET must contain at least 32 characters");
  const allowedSourceIds = (process.env.GBRAIN_ALLOWED_SOURCE_IDS ?? "default").split(",").map((v) => v.trim()).filter(Boolean);
  if (!allowedSourceIds.length) throw new Error("GBRAIN_ALLOWED_SOURCE_IDS cannot be empty");
  const insecureControlValue = process.env.GBRAIN_CONTROL_ALLOW_INSECURE_HTTP?.trim().toLowerCase();
  if (insecureControlValue && insecureControlValue !== "true" && insecureControlValue !== "false") {
    throw new Error("GBRAIN_CONTROL_ALLOW_INSECURE_HTTP must be true or false");
  }
  const controlMutationsValue = process.env.GBRAIN_CONTROL_MUTATIONS_ENABLED?.trim().toLowerCase();
  if (controlMutationsValue && controlMutationsValue !== "true" && controlMutationsValue !== "false") {
    throw new Error("GBRAIN_CONTROL_MUTATIONS_ENABLED must be true or false");
  }
  const controlMcpUrl = optionalHttpUrl("GBRAIN_CONTROL_MCP_URL", insecureControlValue === "true");
  const controlMcpToken = process.env.GBRAIN_CONTROL_MCP_TOKEN?.trim() || null;
  if (Boolean(controlMcpUrl) !== Boolean(controlMcpToken)) {
    throw new Error("GBRAIN_CONTROL_MCP_URL and GBRAIN_CONTROL_MCP_TOKEN must be configured together");
  }
  const controlMutationsEnabled = controlMutationsValue === "true";
  if (controlMutationsEnabled && (!controlMcpUrl || !controlMcpToken)) {
    throw new Error("GBRAIN_CONTROL_MUTATIONS_ENABLED requires the Control MCP URL and token");
  }
  const actionLedgerPath = controlMutationsEnabled
    ? process.env.APP_CONTROL_ACTION_LEDGER_PATH?.trim() || "data/control-actions.json"
    : null;
  return {
    db: {
      host: process.env.GBRAIN_DB_HOST?.trim() || "127.0.0.1",
      port,
      database: required("GBRAIN_DB_NAME"),
      user: required("GBRAIN_DB_USER"),
      password: required("GBRAIN_DB_PASSWORD"),
      schema: safeIdentifier(process.env.GBRAIN_DB_SCHEMA?.trim() || "public", "GBRAIN_DB_SCHEMA"),
    },
    community: { resolution: leidenResolution, minSemanticSimilarity: leidenMinSemanticSimilarity, seed: leidenSeed },
    auth: { password: authPassword, sessionSecret, sessionHours, maxAttempts, attemptWindowMinutes },
    controlCenter: {
      mcpUrl: controlMcpUrl,
      mcpToken: controlMcpToken,
      requestTimeoutMs: Math.round(controlRequestTimeoutSeconds * 1000),
      cacheMs: Math.round(controlCacheSeconds * 1000),
      mutationsEnabled: controlMutationsEnabled,
      actionLedgerPath,
    },
    allowedSourceIds,
    host: process.env.APP_HOST?.trim() || "127.0.0.1",
    port: appPort,
    trustProxyHops,
    publicOrigin: process.env.APP_PUBLIC_ORIGIN?.trim().replace(/\/$/, "") || null,
    rebuildMinIntervalSeconds,
    rebuildStatementTimeoutSeconds,
    semanticCandidateChunks,
    semanticHnswEfSearch,
    snapshotPath: process.env.APP_SNAPSHOT_PATH?.trim() || null,
  };
}
