export interface Config {
  db: { host: string; port: number; database: string; user: string; password: string; schema: string };
  community: { resolution: number; minSemanticSimilarity: number; seed: number };
  auth: { password: string; sessionSecret: string; sessionHours: number; maxAttempts: number; attemptWindowMinutes: number };
  allowedSourceIds: string[];
  host: string;
  port: number;
  publicOrigin: string | null;
  rebuildMinIntervalSeconds: number;
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

export function loadConfig(): Config {
  const port = Number(process.env.GBRAIN_DB_PORT ?? "5432");
  const appPort = Number(process.env.APP_PORT ?? "3000");
  const rebuildMinIntervalSeconds = Number(process.env.APP_REBUILD_MIN_INTERVAL_SECONDS ?? "15");
  const leidenResolution = Number(process.env.LEIDEN_RESOLUTION ?? "0.5");
  const leidenMinSemanticSimilarity = Number(process.env.LEIDEN_MIN_SEMANTIC_SIMILARITY ?? "0.65");
  const leidenSeed = Number(process.env.LEIDEN_SEED ?? "84");
  const sessionHours = Number(process.env.APP_AUTH_SESSION_HOURS ?? "12");
  const maxAttempts = Number(process.env.APP_AUTH_MAX_ATTEMPTS ?? "5");
  const attemptWindowMinutes = Number(process.env.APP_AUTH_ATTEMPT_WINDOW_MINUTES ?? "15");
  if (!Number.isInteger(port) || !Number.isInteger(appPort) || !Number.isFinite(rebuildMinIntervalSeconds) || rebuildMinIntervalSeconds < 0) throw new Error("Ports and rebuild interval must be valid numbers");
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
    allowedSourceIds,
    host: process.env.APP_HOST?.trim() || "127.0.0.1",
    port: appPort,
    publicOrigin: process.env.APP_PUBLIC_ORIGIN?.trim().replace(/\/$/, "") || null,
    rebuildMinIntervalSeconds,
  };
}
