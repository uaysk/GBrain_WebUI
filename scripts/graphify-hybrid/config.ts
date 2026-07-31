import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

export type DatabaseCredentials = {
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
  ssl: false | { rejectUnauthorized: boolean; ca?: string };
};

export type ApiConfig = {
  endpoint: string;
  apiKey: string;
  embeddingModel: string;
  rerankerModel: string;
  synthesisModel: string;
};

let cachedDatabaseCredentials: DatabaseCredentials | undefined;
let cachedApiConfig: ApiConfig | undefined;

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

export function apiConfigFromEnv(options: { cache?: boolean } = {}): ApiConfig {
  if (options.cache && cachedApiConfig) return cachedApiConfig;
  const config = {
    endpoint: requiredEnv("OPENAI_API_ENDPOINT").replace(/\/+$/, ""),
    apiKey: requiredEnv("OPENAI_API_KEY"),
    embeddingModel: process.env.GRAPHIFY_EMBEDDING_MODEL?.trim() || "qwen3-embedding-4b",
    rerankerModel: process.env.GRAPHIFY_RERANKER_MODEL?.trim() || "qwen3-reranker-4b",
    synthesisModel: process.env.GRAPHIFY_SYNTHESIS_MODEL?.trim() || "gpt-5.3-codex-spark",
  } satisfies ApiConfig;
  if (options.cache) cachedApiConfig = config;
  return config;
}

function kubernetesSecretCredentials(): Pick<DatabaseCredentials, "user" | "password"> {
  const namespace = process.env.GRAPHIFY_PG_NAMESPACE?.trim() || "pg";
  const secret = process.env.GRAPHIFY_PG_SECRET?.trim() || "graphify-db";
  const raw = execFileSync(
    "kubectl",
    ["-n", namespace, "get", "secret", secret, "-o", "json"],
    { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
  );
  const parsed = JSON.parse(raw) as { data?: { username?: string; password?: string } };
  const username = parsed.data?.username;
  const password = parsed.data?.password;
  if (!username || !password) {
    throw new Error(`Kubernetes Secret ${namespace}/${secret} is missing username or password`);
  }
  return {
    user: Buffer.from(username, "base64").toString("utf8"),
    password: Buffer.from(password, "base64").toString("utf8"),
  };
}

function tlsConfig(enabled: boolean): DatabaseCredentials["ssl"] {
  if (!enabled) return false;
  const caPath = process.env.GRAPHIFY_PG_SSL_CA_FILE?.trim();
  const legacyInsecure = process.env.GRAPHIFY_PG_TLS_LEGACY_INSECURE === "1";
  return {
    rejectUnauthorized: !legacyInsecure,
    ...(caPath ? { ca: readFileSync(caPath, "utf8") } : {}),
  };
}

function parsePort(value: string | undefined): number {
  const port = Number(value || 5_432);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error("GRAPHIFY_PG_PORT must be an integer between 1 and 65535");
  }
  return port;
}

export function databaseCredentialsFromEnv(options: { cache?: boolean } = {}): DatabaseCredentials {
  if (options.cache && cachedDatabaseCredentials) return cachedDatabaseCredentials;
  const url = process.env.GRAPHIFY_DATABASE_URL?.trim();
  let config: DatabaseCredentials;
  if (url) {
    const parsed = new URL(url);
    const sslMode = parsed.searchParams.get("sslmode")?.toLowerCase();
    config = {
      host: parsed.hostname,
      port: parsePort(parsed.port),
      database: parsed.pathname.replace(/^\//, ""),
      user: decodeURIComponent(parsed.username),
      password: decodeURIComponent(parsed.password),
      ssl: tlsConfig(Boolean(sslMode && sslMode !== "disable")),
    };
  } else {
    const secret = kubernetesSecretCredentials();
    config = {
      host: process.env.GRAPHIFY_PG_HOST?.trim() || "172.30.1.36",
      port: parsePort(process.env.GRAPHIFY_PG_PORT),
      database: process.env.GRAPHIFY_PG_DATABASE?.trim() || "graphify",
      user: secret.user,
      password: secret.password,
      ssl: tlsConfig(process.env.GRAPHIFY_PG_SSL === "require"),
    };
  }
  if (!config.database || !config.user) throw new Error("Graphify PostgreSQL credentials are incomplete");
  if (options.cache) cachedDatabaseCredentials = config;
  return config;
}

export function resetConfigCachesForTests(): void {
  cachedApiConfig = undefined;
  cachedDatabaseCredentials = undefined;
}
