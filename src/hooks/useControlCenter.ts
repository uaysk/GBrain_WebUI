import { useCallback, useEffect, useRef, useState } from "react";
import type { ControlCenterResponse } from "../types";
import { parseControlCenterResponse } from "../api/control-validation";
import { LatestRequestCoordinator } from "./latest-request";

const POLL_MS = 15_000;
const ACTIVE_POLL_MS = 5_000;

async function loadControlCenter(force: boolean, signal: AbortSignal): Promise<ControlCenterResponse> {
  const response = await fetch(`/api/control-center${force ? "?refresh=1" : ""}`, { signal });
  if (!response.ok) throw new Error(`Control Center request failed (${response.status})`);
  return parseControlCenterResponse(await response.json());
}

export function useControlCenter() {
  const [data, setData] = useState<ControlCenterResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mounted = useRef(true);
  const coordinator = useRef(new LatestRequestCoordinator<ControlCenterResponse>());
  const pollDelay = useRef(POLL_MS);
  const hasInFlightJobs = Boolean(data && (
    data.recentJobCounts.active
    + data.recentJobCounts.waiting
    + data.recentJobCounts.waitingChildren
    + data.recentJobCounts.delayed
  ) > 0);
  const pollMs = hasInFlightJobs ? ACTIVE_POLL_MS : POLL_MS;
  pollDelay.current = pollMs;

  const refresh = useCallback(async (force = false) => {
    if (force) setRefreshing(true);
    setError(null);
    let currentRequestCompleted = false;
    try {
      const result = await coordinator.current.run(force, (signal) => loadControlCenter(force, signal));
      if (mounted.current && result.applied) {
        currentRequestCompleted = true;
        setData(result.value);
      }
    } catch (reason) {
      if (mounted.current) {
        currentRequestCompleted = true;
        setError(reason instanceof Error ? reason.message : "Control Center를 불러올 수 없습니다.");
      }
    } finally {
      if (mounted.current) {
        if (currentRequestCompleted) setLoading(false);
        if (force) setRefreshing(false);
      }
    }
  }, []);

  useEffect(() => {
    mounted.current = true;
    let timer: number | null = null;
    let stopped = false;
    const schedule = () => {
      if (stopped) return;
      if (timer !== null) window.clearTimeout(timer);
      timer = window.setTimeout(async () => {
        timer = null;
        if (document.visibilityState === "visible") await refresh();
        schedule();
      }, pollDelay.current);
    };
    void refresh().finally(schedule);
    const onVisibilityChange = () => {
      if (document.visibilityState !== "visible") return;
      if (timer !== null) window.clearTimeout(timer);
      timer = null;
      void refresh().finally(schedule);
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      stopped = true;
      mounted.current = false;
      coordinator.current.abort();
      if (timer !== null) window.clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [refresh]);

  return { data, loading, refreshing, error, refresh };
}
