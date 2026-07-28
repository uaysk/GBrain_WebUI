import { useCallback, useEffect, useRef, useState } from "react";
import type { ControlCenterResponse } from "../types";

const POLL_MS = 15_000;
const ACTIVE_POLL_MS = 5_000;

async function loadControlCenter(force: boolean): Promise<ControlCenterResponse> {
  const response = await fetch(`/api/control-center${force ? "?refresh=1" : ""}`);
  if (!response.ok) throw new Error(`Control Center request failed (${response.status})`);
  return response.json() as Promise<ControlCenterResponse>;
}

export function useControlCenter() {
  const [data, setData] = useState<ControlCenterResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mounted = useRef(true);
  const hasInFlightJobs = Boolean(data && (
    data.recentJobCounts.active
    + data.recentJobCounts.waiting
    + data.recentJobCounts.waitingChildren
    + data.recentJobCounts.delayed
  ) > 0);
  const pollMs = hasInFlightJobs ? ACTIVE_POLL_MS : POLL_MS;

  const refresh = useCallback(async (force = false) => {
    if (force) setRefreshing(true);
    setError(null);
    try {
      const next = await loadControlCenter(force);
      if (mounted.current) setData(next);
    } catch (reason) {
      if (mounted.current) setError(reason instanceof Error ? reason.message : "Control Center를 불러올 수 없습니다.");
    } finally {
      if (mounted.current) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, []);

  useEffect(() => {
    mounted.current = true;
    void refresh();
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") void refresh();
    }, pollMs);
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      mounted.current = false;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [pollMs, refresh]);

  return { data, loading, refreshing, error, refresh };
}
