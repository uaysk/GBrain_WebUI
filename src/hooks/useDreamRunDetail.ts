import { useCallback, useEffect, useRef, useState } from "react";
import { parseControlDreamRunDetail } from "../api/control-validation";
import type { ControlDreamRunDetail } from "../types";
import { LatestRequestCoordinator } from "./latest-request";

const DETAIL_CACHE_LIMIT = 64;
const detailCache = new Map<string, ControlDreamRunDetail>();

export class DreamRunDetailRequestError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
    this.name = "DreamRunDetailRequestError";
  }
}

export type DreamRunDetailFetcher = (input: string, init?: RequestInit) => Promise<Response>;

export function dreamRunDetailCacheKey(snapshotGeneratedAt: string, jobId: number): string | null {
  if (!snapshotGeneratedAt || !Number.isSafeInteger(jobId) || jobId <= 0) return null;
  return `${snapshotGeneratedAt}\u0000${jobId}`;
}

function rememberDetail(key: string, detail: ControlDreamRunDetail): void {
  detailCache.delete(key);
  detailCache.set(key, detail);
  while (detailCache.size > DETAIL_CACHE_LIMIT) {
    const oldest = detailCache.keys().next().value as string | undefined;
    if (oldest === undefined) break;
    detailCache.delete(oldest);
  }
}

export function clearDreamRunDetailCache(): void {
  detailCache.clear();
}

function requestErrorMessage(status: number): string {
  if (status === 400) return "Dream 실행 ID가 올바르지 않습니다.";
  if (status === 401 || status === 403) return "Dream 상세 정보를 보려면 다시 인증해 주세요.";
  if (status === 404) return "선택한 Dream 실행은 현재 스냅샷에 없습니다.";
  if (status === 503) return "Dream 상세 정보를 지금 불러올 수 없습니다.";
  return "Dream 상세 정보를 불러오지 못했습니다.";
}

/** Fetch and allowlist-validate one cached Control snapshot detail. */
export async function fetchDreamRunDetail(
  jobId: number,
  signal: AbortSignal,
  fetcher: DreamRunDetailFetcher = (input, init) => fetch(input, init),
): Promise<ControlDreamRunDetail> {
  if (!Number.isSafeInteger(jobId) || jobId <= 0) {
    throw new DreamRunDetailRequestError(400, requestErrorMessage(400));
  }
  const response = await fetcher(`/api/control-center/dream-runs/${jobId}`, {
    method: "GET",
    headers: { Accept: "application/json" },
    signal,
  });
  if (!response.ok) {
    throw new DreamRunDetailRequestError(response.status, requestErrorMessage(response.status));
  }
  const detail = parseControlDreamRunDetail(await response.json());
  if (detail.run.id !== jobId) {
    throw new DreamRunDetailRequestError(502, "Dream 상세 응답이 선택한 실행과 일치하지 않습니다.");
  }
  return detail;
}

interface DreamRunDetailState {
  key: string | null;
  detail: ControlDreamRunDetail | null;
  loading: boolean;
  error: string | null;
}

export interface DreamRunDetailResult {
  detail: ControlDreamRunDetail | null;
  loading: boolean;
  error: string | null;
  reload: () => Promise<void>;
}

/**
 * Reads detail independently of overview polling. A generation change produces a
 * new cache key, and every overlapping request is aborted/latest-wins guarded.
 */
export function useDreamRunDetail(
  jobId: number | null,
  snapshotGeneratedAt: string | null,
): DreamRunDetailResult {
  const cacheKey = jobId === null || snapshotGeneratedAt === null
    ? null
    : dreamRunDetailCacheKey(snapshotGeneratedAt, jobId);
  // Map deep links intentionally have no Control polling generation in their
  // public URL contract. They fetch without sharing the generation cache.
  const key = jobId === null ? null : cacheKey ?? `uncached\u0000${jobId}`;
  const [state, setState] = useState<DreamRunDetailState>({
    key: null,
    detail: null,
    loading: false,
    error: null,
  });
  const mounted = useRef(true);
  const coordinator = useRef(new LatestRequestCoordinator<ControlDreamRunDetail>());

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      coordinator.current.abort();
    };
  }, []);

  const load = useCallback(async (force: boolean) => {
    if (jobId === null || key === null) {
      coordinator.current.abort();
      if (mounted.current) setState({ key: null, detail: null, loading: false, error: null });
      return;
    }
    const cached = cacheKey === null ? null : detailCache.get(cacheKey) ?? null;
    if (!force && cached) {
      coordinator.current.abort();
      if (mounted.current) setState({ key, detail: cached, loading: false, error: null });
      return;
    }

    if (mounted.current) {
      setState((current) => ({
        key,
        detail: current.key === key ? current.detail : cached,
        loading: true,
        error: null,
      }));
    }
    try {
      const result = await coordinator.current.run(true, (signal) => fetchDreamRunDetail(jobId, signal));
      if (!mounted.current || !result.applied) return;
      if (cacheKey !== null) rememberDetail(cacheKey, result.value);
      setState({ key, detail: result.value, loading: false, error: null });
    } catch (reason) {
      if (!mounted.current) return;
      const message = reason instanceof DreamRunDetailRequestError
        ? reason.message
        : "Dream 상세 정보를 불러오지 못했습니다.";
      setState((current) => ({
        key,
        detail: current.key === key ? current.detail : cached,
        loading: false,
        error: message,
      }));
    }
  }, [cacheKey, jobId, key]);

  useEffect(() => {
    void load(false);
    return () => coordinator.current.abort();
  }, [load]);

  const reload = useCallback(() => load(true), [load]);
  const cached = cacheKey === null ? null : detailCache.get(cacheKey) ?? null;
  const current = state.key === key;
  return {
    detail: current ? state.detail : cached,
    loading: key !== null && (current ? state.loading : !cached),
    error: current ? state.error : null,
    reload,
  };
}
