import { useCallback, useEffect, useState } from "react";
import type { GraphResponse, RelationFamily } from "../api/types";
import { EXPLICIT_RELATION_FAMILIES } from "../graph/visual-spec";
import { parseMapUrlState } from "../graph/map-url-state";

export const GRAPH_EXPLORER_STORAGE_KEY = "gbrain-memory-map:explorer-state:v3";
export const LEGACY_GRAPH_EXPLORER_STORAGE_KEY = "gbrain-memory-map:explorer-state:v2";

export interface GraphExplorerState {
  selectedId: string | null;
  viewMode: "2d" | "3d";
  timelineOn: boolean;
  communityLabelsOn: boolean;
  semanticOn: boolean;
  explicitOn: boolean;
  semanticThreshold: number;
  explicitFamilies: RelationFamily[];
}

const defaults: GraphExplorerState = {
  selectedId: null,
  viewMode: "3d",
  timelineOn: true,
  communityLabelsOn: true,
  semanticOn: true,
  explicitOn: true,
  semanticThreshold: 0.65,
  explicitFamilies: [...EXPLICIT_RELATION_FAMILIES],
};

type ReadableStorage = Pick<Storage, "getItem">;
type WritableStorage = Pick<Storage, "setItem">;

export function readGraphExplorerState(storage: ReadableStorage | null, search = ""): GraphExplorerState {
  const url = parseMapUrlState(search);
  let value: Partial<GraphExplorerState> | null = null;
  try {
    for (const key of [GRAPH_EXPLORER_STORAGE_KEY, LEGACY_GRAPH_EXPLORER_STORAGE_KEY]) {
      const stored = storage?.getItem(key);
      if (!stored) continue;
      try {
        const parsed = JSON.parse(stored) as Partial<GraphExplorerState> | null;
        if (parsed && typeof parsed === "object") { value = parsed; break; }
      } catch { /* a corrupt v3 value must not block a valid v2 fallback */ }
    }
  } catch {
    // localStorage can be disabled or throw in privacy modes.
    value = null;
  }
  if (!value) {
    return { ...defaults, selectedId: url.node, viewMode: url.view ?? defaults.viewMode };
  }
  const families = Array.isArray(value.explicitFamilies)
    ? value.explicitFamilies.filter((family): family is RelationFamily => EXPLICIT_RELATION_FAMILIES.includes(family as typeof EXPLICIT_RELATION_FAMILIES[number]))
    : defaults.explicitFamilies;
  const threshold = Number(value.semanticThreshold ?? defaults.semanticThreshold);
  return {
    selectedId: url.community ? null : url.node ?? (typeof value.selectedId === "string" ? value.selectedId : null),
    viewMode: url.view ?? (value.viewMode === "2d" ? "2d" : "3d"),
    timelineOn: value.timelineOn !== false,
    communityLabelsOn: value.communityLabelsOn !== false,
    semanticOn: value.semanticOn !== false,
    explicitOn: value.explicitOn !== false,
    semanticThreshold: Number.isFinite(threshold) ? Math.max(-1, Math.min(1, threshold)) : defaults.semanticThreshold,
    explicitFamilies: families,
  };
}

export function persistGraphExplorerState(storage: WritableStorage | null, state: GraphExplorerState): boolean {
  try {
    storage?.setItem(GRAPH_EXPLORER_STORAGE_KEY, JSON.stringify(state));
    return Boolean(storage);
  } catch {
    return false;
  }
}

function loadState(): GraphExplorerState {
  if (typeof window === "undefined") return defaults;
  return readGraphExplorerState(window.localStorage, window.location.search);
}

export function useGraphExplorerState(graph: GraphResponse | null) {
  const [state, setState] = useState<GraphExplorerState>(loadState);
  useEffect(() => { persistGraphExplorerState(window.localStorage, state); }, [state]);
  useEffect(() => {
    if (!graph || !state.selectedId) return;
    if (!graph.nodes.some((node) => node.id === state.selectedId)) setState((current) => ({ ...current, selectedId: null }));
  }, [graph, state.selectedId]);
  const clearSelection = useCallback(() => setState((current) => ({ ...current, selectedId: null })), []);
  const patchState = useCallback((patch: Partial<GraphExplorerState> | ((current: GraphExplorerState) => Partial<GraphExplorerState>)) => {
    setState((current) => ({ ...current, ...(typeof patch === "function" ? patch(current) : patch) }));
  }, []);
  return { state, patchState, clearSelection };
}
