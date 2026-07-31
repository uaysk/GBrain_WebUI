import type { MapViewMode } from "./layout-2d";

export interface MapUrlState {
  node: string | null;
  community: string | null;
  view: MapViewMode | null;
  dreamRun: number | null;
}

export type MapUrlStatePatch = Partial<MapUrlState>;
export type MapUrlHistoryMode = "push" | "replace";

export interface MapUrlTransition {
  state: MapUrlState;
  params: URLSearchParams;
  search: string;
  historyMode: MapUrlHistoryMode;
}

export const EMPTY_MAP_URL_STATE: Readonly<MapUrlState> = Object.freeze({
  node: null,
  community: null,
  view: null,
  dreamRun: null,
});

function cloneParams(value: URLSearchParams | string): URLSearchParams {
  return new URLSearchParams(typeof value === "string" ? value : value.toString());
}

function nonEmpty(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function parseDreamRun(value: string | null): number | null {
  if (!value || !/^[1-9]\d*$/u.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

function canonicalize(state: MapUrlState): MapUrlState {
  const node = nonEmpty(state.node);
  return {
    node,
    // A precise node selection wins if an invalid URL contains both selectors.
    community: node ? null : nonEmpty(state.community),
    view: state.view === "2d" || state.view === "3d" ? state.view : null,
    dreamRun: Number.isSafeInteger(state.dreamRun) && (state.dreamRun ?? 0) > 0 ? state.dreamRun : null,
  };
}

/** Parse only the public Map query keys. Invalid values fail closed to `null`. */
export function parseMapUrlState(value: URLSearchParams | string): MapUrlState {
  const params = cloneParams(value);
  const node = nonEmpty(params.get("node"));
  const view = params.get("view");
  return {
    node,
    community: node ? null : nonEmpty(params.get("community")),
    view: view === "2d" || view === "3d" ? view : null,
    dreamRun: parseDreamRun(params.get("dreamRun")),
  };
}

/** Serialize canonical Map state while preserving all unrelated query parameters. */
export function serializeMapUrlState(
  state: MapUrlState,
  base: URLSearchParams | string = new URLSearchParams(),
): URLSearchParams {
  const params = cloneParams(base);
  const next = canonicalize(state);
  const setOrDelete = (key: string, value: string | null) => {
    if (value === null) params.delete(key);
    else params.set(key, value);
  };
  setOrDelete("node", next.node);
  setOrDelete("community", next.community);
  setOrDelete("view", next.view);
  setOrDelete("dreamRun", next.dreamRun === null ? null : String(next.dreamRun));
  return params;
}

/** Apply a partial state change; selecting a node or community clears the other selector. */
export function patchMapUrlState(
  base: URLSearchParams | string,
  patch: MapUrlStatePatch,
): URLSearchParams {
  const current = parseMapUrlState(base);
  const next: MapUrlState = { ...current, ...patch };

  // If malformed runtime input sets both, node has the same precedence as parsing.
  if (patch.community !== undefined && nonEmpty(patch.community)) next.node = null;
  if (patch.node !== undefined && nonEmpty(patch.node)) next.community = null;

  return serializeMapUrlState(next, base);
}

/**
 * Build a pure transition descriptor. The caller remains responsible for invoking
 * `history.pushState` or `history.replaceState` according to `historyMode`.
 */
export function createMapUrlTransition(
  base: URLSearchParams | string,
  patch: MapUrlStatePatch,
  historyMode: MapUrlHistoryMode,
): MapUrlTransition {
  const params = patchMapUrlState(base, patch);
  const encoded = params.toString();
  return {
    state: parseMapUrlState(params),
    params,
    search: encoded ? `?${encoded}` : "",
    historyMode,
  };
}
