import { apiConfigFromEnv, type ApiConfig } from "./config.js";
import { EMBEDDING_DIMENSIONS } from "./types.js";

export type ApiRequestOptions = {
  config?: ApiConfig;
  fetchImpl?: typeof fetch;
  sleep?: (milliseconds: number) => Promise<void>;
  random?: () => number;
  timeoutMs?: number;
};

function retryableStatus(status: number): boolean {
  return status === 408 || status === 429 || status >= 500;
}

function retryAfterMilliseconds(value: string | null, now = Date.now()): number | null {
  if (!value) return null;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.min(120_000, seconds * 1_000);
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return null;
  return Math.min(120_000, Math.max(0, timestamp - now));
}

function apiError(pathName: string, status: number, parsed: unknown, text: string): Error {
  const candidate = parsed as { error?: { message?: unknown } };
  const message = typeof candidate?.error?.message === "string"
    ? candidate.error.message
    : text.slice(0, 500);
  return new Error(`${pathName} returned HTTP ${status}: ${message}`);
}

export async function apiRequest<T>(
  pathName: string,
  body: Record<string, unknown>,
  options: ApiRequestOptions = {},
): Promise<T> {
  const config = options.config || apiConfigFromEnv({ cache: true });
  const fetchImpl = options.fetchImpl || fetch;
  const sleep = options.sleep || ((milliseconds: number) => new Promise<void>((resolve) => {
    setTimeout(resolve, milliseconds);
  }));
  const random = options.random || Math.random;
  const timeoutMs = options.timeoutMs ?? 120_000;
  let lastNetworkError: Error | undefined;

  for (let attempt = 0; attempt < 4; attempt += 1) {
    let response: Response;
    try {
      response = await fetchImpl(`${config.endpoint}${pathName}`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${config.apiKey}`,
          "content-type": "application/json",
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (error) {
      lastNetworkError = error instanceof Error ? error : new Error(String(error));
      if (attempt === 3) throw lastNetworkError;
      const delay = Math.round(500 * 2 ** attempt * (0.5 + random()));
      await sleep(delay);
      continue;
    }

    const text = await response.text();
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      const malformed = new Error(`${pathName} returned HTTP ${response.status} with non-JSON body`);
      if (!response.ok && retryableStatus(response.status) && attempt < 3) {
        const retryAfter = retryAfterMilliseconds(response.headers.get("retry-after"));
        await sleep(retryAfter ?? Math.round(500 * 2 ** attempt * (0.5 + random())));
        continue;
      }
      throw malformed;
    }

    if (response.ok) return parsed as T;
    const error = apiError(pathName, response.status, parsed, text);
    if (!retryableStatus(response.status) || attempt === 3) throw error;
    const retryAfter = retryAfterMilliseconds(response.headers.get("retry-after"));
    await sleep(retryAfter ?? Math.round(500 * 2 ** attempt * (0.5 + random())));
  }
  throw lastNetworkError || new Error(`${pathName} failed`);
}

export function validateEmbeddingResponse(
  value: unknown,
  expectedCount: number,
): number[][] {
  const data = (value as { data?: unknown })?.data;
  if (!Array.isArray(data) || data.length !== expectedCount) {
    throw new Error(`Embedding response shape mismatch: expected ${expectedCount}x${EMBEDDING_DIMENSIONS}`);
  }
  const ordered: Array<number[] | undefined> = Array(expectedCount);
  for (const item of data) {
    const index = (item as { index?: unknown }).index;
    const embedding = (item as { embedding?: unknown }).embedding;
    if (!Number.isInteger(index) || (index as number) < 0 || (index as number) >= expectedCount) {
      throw new Error("Embedding response contains an out-of-range index");
    }
    if (ordered[index as number]) throw new Error("Embedding response contains a duplicate index");
    if (
      !Array.isArray(embedding)
      || embedding.length !== EMBEDDING_DIMENSIONS
      || embedding.some((entry) => typeof entry !== "number" || !Number.isFinite(entry))
    ) {
      throw new Error(`Embedding response shape mismatch: expected ${expectedCount}x${EMBEDDING_DIMENSIONS}`);
    }
    ordered[index as number] = embedding as number[];
  }
  if (ordered.some((embedding) => !embedding)) {
    throw new Error("Embedding response is missing an index");
  }
  return ordered as number[][];
}

export async function embedTexts(
  texts: string[],
  options: ApiRequestOptions = {},
): Promise<number[][]> {
  const config = options.config || apiConfigFromEnv({ cache: true });
  const result = await apiRequest<unknown>("/embeddings", {
    model: config.embeddingModel,
    input: texts,
  }, { ...options, config });
  return validateEmbeddingResponse(result, texts.length);
}

export function validateRerankRows(value: unknown, candidateCount: number): Array<{
  index: number;
  score: number;
}> {
  const response = value as { results?: unknown; data?: unknown };
  const rows = response?.results ?? response?.data;
  if (!Array.isArray(rows)) throw new Error("Rerank response is missing results");
  const seen = new Set<number>();
  return rows.map((row) => {
    const candidate = row as { index?: unknown; relevance_score?: unknown; score?: unknown };
    const index = candidate.index;
    const score = candidate.relevance_score ?? candidate.score;
    if (!Number.isInteger(index) || (index as number) < 0 || (index as number) >= candidateCount) {
      throw new Error("Rerank response contains an out-of-range index");
    }
    if (seen.has(index as number)) throw new Error("Rerank response contains a duplicate index");
    if (typeof score !== "number" || !Number.isFinite(score)) {
      throw new Error("Rerank response contains a non-finite score");
    }
    seen.add(index as number);
    return { index: index as number, score };
  });
}
