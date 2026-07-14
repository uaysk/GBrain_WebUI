import type { GraphTimelineNode, GraphTimelineResponse } from "../src/types";

export interface HistoryPageRow {
  id: number;
  created_at: Date | string;
  current_content_hash: string;
  current_content_length: number;
}

export interface HistoryVersionRow {
  id: number;
  page_id: number;
  snapshot_at: Date | string;
  content_hash: string;
  content_length: number;
}

interface HistoricalContentState {
  at: string;
  hash: string;
  length: number;
}

function iso(value: Date | string): string {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) throw new Error("Invalid graph history timestamp");
  return date.toISOString();
}

function sizeScale(length: number, currentLength: number): number {
  const ratio = Math.sqrt((Math.max(0, length) + 256) / (Math.max(0, currentLength) + 256));
  return Math.max(0.72, Math.min(1.18, ratio));
}

export function buildTimelineNode(
  id: string,
  page: HistoryPageRow,
  rawVersions: HistoryVersionRow[],
): GraphTimelineNode {
  const createdAt = iso(page.created_at);
  const versions = rawVersions
    .filter((version) => version.page_id === page.id)
    .map((version) => ({ ...version, at: iso(version.snapshot_at) }))
    .sort((left, right) => left.at.localeCompare(right.at) || left.id - right.id);
  if (!versions.length) return { id, static: true, createdAt, states: [] };

  const historical: HistoricalContentState[] = [{
    at: createdAt,
    hash: versions[0]!.content_hash,
    length: versions[0]!.content_length,
  }];
  let activeHash = versions[0]!.content_hash;
  for (let index = 1; index < versions.length; index += 1) {
    const next = versions[index]!;
    if (next.content_hash === activeHash) continue;
    historical.push({
      at: versions[index - 1]!.at,
      hash: next.content_hash,
      length: next.content_length,
    });
    activeHash = next.content_hash;
  }
  if (page.current_content_hash !== activeHash) {
    historical.push({
      at: versions.at(-1)!.at,
      hash: page.current_content_hash,
      length: page.current_content_length,
    });
  }

  const normalized: HistoricalContentState[] = [];
  for (const state of historical) {
    const previous = normalized.at(-1);
    if (previous?.at === state.at) normalized[normalized.length - 1] = state;
    else normalized.push(state);
  }
  return {
    id,
    static: false,
    createdAt,
    states: normalized.map((state, revision) => ({
      at: state.at,
      revision,
      sizeScale: sizeScale(state.length, page.current_content_length),
    })),
  };
}

export function buildGraphTimeline(
  graphGeneratedAt: string,
  stableIdByPageId: ReadonlyMap<number, string>,
  pages: HistoryPageRow[],
  versions: HistoryVersionRow[],
): GraphTimelineResponse {
  const versionsByPage = new Map<number, HistoryVersionRow[]>();
  for (const version of versions) {
    const existing = versionsByPage.get(version.page_id) ?? [];
    existing.push(version);
    versionsByPage.set(version.page_id, existing);
  }
  const nodes = pages.flatMap((page) => {
    const id = stableIdByPageId.get(page.id);
    return id ? [buildTimelineNode(id, page, versionsByPage.get(page.id) ?? [])] : [];
  }).sort((left, right) => left.id.localeCompare(right.id));
  const versioned = nodes.filter((node) => !node.static);
  const startAt = versioned
    .map((node) => node.states[0]?.at)
    .filter((value): value is string => Boolean(value))
    .sort()[0] ?? graphGeneratedAt;
  return {
    graphGeneratedAt,
    startAt,
    endAt: graphGeneratedAt,
    versionedNodeCount: versioned.length,
    staticNodeCount: nodes.length - versioned.length,
    stateCount: versioned.reduce((sum, node) => sum + node.states.length, 0),
    transitionCount: versioned.reduce((sum, node) => sum + Math.max(0, node.states.length - 1), 0),
    nodes,
  };
}
