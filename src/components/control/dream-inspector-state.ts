export const DREAM_INSPECTOR_TABS = ["overview", "phases", "comparison", "affected"] as const;

export type DreamInspectorTab = (typeof DREAM_INSPECTOR_TABS)[number];

export interface DreamInspectorUrlState {
  runId: number | null;
  tab: DreamInspectorTab;
  phase: string | null;
}

function cloneParams(value: URLSearchParams | string): URLSearchParams {
  return new URLSearchParams(typeof value === "string" ? value : value.toString());
}

function positiveJobId(value: string | null): number | null {
  if (!value || !/^[1-9]\d{0,15}$/u.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

function phaseName(value: string | null): string | null {
  const normalized = value?.trim();
  return normalized && normalized.length <= 128 ? normalized : null;
}

/** Parse only Dream Inspector's public URL keys and fail closed for invalid values. */
export function parseDreamInspectorUrlState(
  value: URLSearchParams | string,
): DreamInspectorUrlState {
  const params = cloneParams(value);
  const tab = params.get("tab");
  return {
    runId: positiveJobId(params.get("run")),
    tab: DREAM_INSPECTOR_TABS.includes(tab as DreamInspectorTab)
      ? tab as DreamInspectorTab
      : "overview",
    phase: phaseName(params.get("phase")),
  };
}

/** Serialize Dream state without dropping filters or other unrelated Control query state. */
export function serializeDreamInspectorUrlState(
  state: DreamInspectorUrlState,
  base: URLSearchParams | string = new URLSearchParams(),
): URLSearchParams {
  const params = cloneParams(base);
  if (state.runId === null || !Number.isSafeInteger(state.runId) || state.runId <= 0) {
    params.delete("run");
    params.delete("tab");
    params.delete("phase");
    return params;
  }
  params.set("run", String(state.runId));
  params.set("tab", DREAM_INSPECTOR_TABS.includes(state.tab) ? state.tab : "overview");
  const phase = phaseName(state.phase);
  if (phase) params.set("phase", phase);
  else params.delete("phase");
  return params;
}

/**
 * Link to the Map using only its known public selectors. Control filters and
 * arbitrary query values are intentionally not copied into the destination.
 */
export function dreamRunMapHref(
  jobId: number,
  base: URLSearchParams | string = new URLSearchParams(),
): string {
  const source = cloneParams(base);
  const params = new URLSearchParams();
  const node = phaseName(source.get("node"));
  const community = node ? null : phaseName(source.get("community"));
  const view = source.get("view");
  if (node) params.set("node", node);
  else if (community) params.set("community", community);
  if (view === "2d" || view === "3d") params.set("view", view);
  if (source.get("graphDiagnostics") === "1") params.set("graphDiagnostics", "1");
  if (Number.isSafeInteger(jobId) && jobId > 0) params.set("dreamRun", String(jobId));
  const encoded = params.toString();
  return encoded ? `/?${encoded}` : "/";
}
