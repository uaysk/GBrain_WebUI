import { useCallback, useEffect, useState } from "react";
import type { GraphResponse, RelationFamily } from "../api/types";
import { EXPLICIT_RELATION_FAMILIES } from "../graph/visual-spec";
import { isSelectionClearKey } from "../graph/selection";

const STORAGE_KEY = "gbrain-memory-map:explorer-state:v2";

export interface GraphExplorerState {
  selectedId: string | null;
  viewMode: "2d" | "3d";
  communityLabelsOn: boolean;
  semanticOn: boolean;
  explicitOn: boolean;
  semanticThreshold: number;
  explicitFamilies: RelationFamily[];
}

const defaults: GraphExplorerState = {
  selectedId: null,
  viewMode: "3d",
  communityLabelsOn: true,
  semanticOn: true,
  explicitOn: true,
  semanticThreshold: 0.65,
  explicitFamilies: [...EXPLICIT_RELATION_FAMILIES],
};

function loadState(): GraphExplorerState {
  if (typeof window === "undefined") return defaults;
  try {
    const value = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? "null") as Partial<GraphExplorerState> | null;
    if (!value) return defaults;
    const families = Array.isArray(value.explicitFamilies)
      ? value.explicitFamilies.filter((family): family is RelationFamily => EXPLICIT_RELATION_FAMILIES.includes(family as typeof EXPLICIT_RELATION_FAMILIES[number]))
      : defaults.explicitFamilies;
    const threshold = Number(value.semanticThreshold ?? defaults.semanticThreshold);
    return {
      ...defaults,
      ...value,
      selectedId: typeof value.selectedId === "string" ? value.selectedId : null,
      viewMode: value.viewMode === "2d" ? "2d" : "3d",
      semanticThreshold: Number.isFinite(threshold) ? Math.max(-1, Math.min(1, threshold)) : defaults.semanticThreshold,
      explicitFamilies: families,
    };
  } catch {
    return defaults;
  }
}

export function useGraphExplorerState(graph: GraphResponse | null) {
  const [state, setState] = useState<GraphExplorerState>(loadState);
  useEffect(() => { window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); }, [state]);
  useEffect(() => {
    if (!graph || !state.selectedId) return;
    if (!graph.nodes.some((node) => node.id === state.selectedId)) setState((current) => ({ ...current, selectedId: null }));
  }, [graph, state.selectedId]);
  const clearSelection = useCallback(() => setState((current) => ({ ...current, selectedId: null })), []);
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!isSelectionClearKey(event.key)) return;
      event.preventDefault();
      clearSelection();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [clearSelection]);
  const patchState = useCallback((patch: Partial<GraphExplorerState> | ((current: GraphExplorerState) => Partial<GraphExplorerState>)) => {
    setState((current) => ({ ...current, ...(typeof patch === "function" ? patch(current) : patch) }));
  }, []);
  return { state, patchState, clearSelection };
}
