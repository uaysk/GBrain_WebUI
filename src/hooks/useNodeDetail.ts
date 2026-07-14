import { useEffect, useState } from "react";
import type { NodeDetailResponse } from "../api/types";

export type NodeDetailState =
  | { nodeId: null; status: "idle"; detail: null; error: null }
  | { nodeId: string; status: "loading"; detail: null; error: null }
  | { nodeId: string; status: "ready"; detail: NodeDetailResponse; error: null }
  | { nodeId: string; status: "failed"; detail: null; error: string };

const idleState: NodeDetailState = { nodeId: null, status: "idle", detail: null, error: null };

export function useNodeDetail(nodeId: string | null, graphGeneratedAt?: string): NodeDetailState {
  const [state, setState] = useState<NodeDetailState>(idleState);
  useEffect(() => {
    if (!nodeId) {
      setState(idleState);
      return;
    }
    const controller = new AbortController();
    setState({ nodeId, status: "loading", detail: null, error: null });
    void fetch(`/api/node-detail?id=${encodeURIComponent(nodeId)}`, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error(`Request failed (${response.status})`);
        return response.json() as Promise<NodeDetailResponse>;
      })
      .then((detail) => setState({ nodeId, status: "ready", detail, error: null }))
      .catch((reason: unknown) => {
        if (controller.signal.aborted) return;
        setState({ nodeId, status: "failed", detail: null, error: reason instanceof Error ? reason.message : "내용을 불러올 수 없습니다." });
      });
    return () => controller.abort();
  }, [graphGeneratedAt, nodeId]);
  return state;
}
