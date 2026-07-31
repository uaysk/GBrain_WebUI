import { useCallback, useEffect, useRef, useState } from "react";
import type {
  GraphRebuildAccepted,
  GraphRebuildStatus,
  GraphResponse,
  GraphTimelineResponse,
  StatusResponse,
} from "../../shared/contracts";

async function json<T>(url: string, signal: AbortSignal, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { ...init, signal });
  if (!response.ok) throw new Error(`Request failed (${response.status})`);
  return response.json() as Promise<T>;
}

function message(reason: unknown, fallback: string): string {
  return reason instanceof Error && reason.name !== "AbortError" ? reason.message : fallback;
}

export function useGraphData(active: boolean) {
  const [graph, setGraph] = useState<GraphResponse | null>(null);
  const [timeline, setTimeline] = useState<GraphTimelineResponse | null>(null);
  const [status, setStatus] = useState<StatusResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [rebuildError, setRebuildError] = useState<string | null>(null);
  const [rebuildStatus, setRebuildStatus] = useState<GraphRebuildStatus | null>(null);
  const [timelineError, setTimelineError] = useState(false);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const loadController = useRef<AbortController | null>(null);
  const requestId = useRef(0);

  const load = useCallback(async () => {
    loadController.current?.abort();
    const controller = new AbortController();
    loadController.current = controller;
    const id = ++requestId.current;
    setError(null);
    setTimelineError(false);
    const rebuildStatusRequest = json<GraphRebuildStatus>("/api/graph/rebuild/status", controller.signal).catch(() => null);
    const historyRequest = json<GraphTimelineResponse>("/api/graph/history", controller.signal).then(
      (value) => ({ ok: true as const, value }),
      () => ({ ok: false as const }),
    );
    try {
      const [nextStatus, nextGraph] = await Promise.all([
        json<StatusResponse>("/api/status", controller.signal),
        json<GraphResponse>("/api/graph", controller.signal),
      ]);
      if (id !== requestId.current || controller.signal.aborted) return;
      setStatus(nextStatus);
      setGraph(nextGraph);
      const nextRebuildStatus = await rebuildStatusRequest;
      if (id !== requestId.current || controller.signal.aborted) return;
      if (nextRebuildStatus) {
        setRebuildStatus(nextRebuildStatus);
        if (nextRebuildStatus.state === "running") setRefreshing(true);
      }
      const historyResult = await historyRequest;
      if (id !== requestId.current || controller.signal.aborted) return;
      if (historyResult.ok && historyResult.value.graphGeneratedAt === nextGraph.generatedAt) {
        setTimeline(historyResult.value);
      } else {
        setTimeline(null);
        setTimelineError(true);
      }
    } catch (reason) {
      if (!controller.signal.aborted && id === requestId.current) setError(message(reason, "데이터를 불러올 수 없습니다."));
    } finally {
      if (!controller.signal.aborted && id === requestId.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (active) void load();
    return () => {
      if (!active) return;
      requestId.current += 1;
      loadController.current?.abort();
    };
  }, [active, load]);

  const rebuild = useCallback(async () => {
    const controller = new AbortController();
    setRefreshing(true);
    setRebuildError(null);
    setTimelineError(false);
    try {
      const accepted = await json<GraphRebuildAccepted>("/api/graph/rebuild", controller.signal, { method: "POST" });
      setRebuildStatus(accepted.status);
    } catch (reason) {
      setRebuildError(message(reason, "새로고침 시작에 실패했습니다."));
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    if (!active || !refreshing) return;
    const controller = new AbortController();
    let timer: number | null = null;
    const poll = async () => {
      try {
        const next = await json<GraphRebuildStatus>("/api/graph/rebuild/status", controller.signal);
        if (controller.signal.aborted) return;
        setRebuildStatus(next);
        if (next.state === "running" || next.state === "idle") {
          timer = window.setTimeout(() => { void poll(); }, 800);
          return;
        }
        if (next.state === "failed") {
          setRebuildError(next.error ?? "새로고침에 실패했습니다. 기존 snapshot을 유지합니다.");
          setRefreshing(false);
          return;
        }
        await load();
        if (!controller.signal.aborted) setRefreshing(false);
      } catch (reason) {
        if (controller.signal.aborted) return;
        setRebuildError(message(reason, "새로고침 상태를 확인할 수 없습니다."));
        setRefreshing(false);
      }
    };
    void poll();
    return () => {
      controller.abort();
      if (timer !== null) window.clearTimeout(timer);
    };
  }, [active, load, refreshing]);

  return {
    graph,
    timeline,
    status,
    error,
    rebuildError,
    rebuildStatus,
    timelineError,
    loading,
    refreshing,
    rebuild,
  };
}
