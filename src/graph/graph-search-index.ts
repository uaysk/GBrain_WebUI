import type { GraphNode, GraphResponse, SemanticGroup } from "../api/types";

export const GRAPH_SEARCH_RESULT_LIMIT = 20;
export const GRAPH_SEARCH_RECENT_LIMIT = 8;

export type GraphSearchMatch = "exact" | "prefix" | "all-token" | "substring" | "recent";

interface GraphSearchResultBase {
  key: string;
  id: string;
  label: string;
  match: GraphSearchMatch;
}

export interface GraphNodeSearchResult extends GraphSearchResultBase {
  kind: "node";
  node: GraphNode;
}

export interface GraphCommunitySearchResult extends GraphSearchResultBase {
  kind: "community";
  community: SemanticGroup;
}

export type GraphSearchResult = GraphNodeSearchResult | GraphCommunitySearchResult;

type SearchEntity =
  | Omit<GraphNodeSearchResult, "match">
  | Omit<GraphCommunitySearchResult, "match">;

interface SearchEntry {
  entity: SearchEntity;
  fields: readonly string[];
  fieldTokens: readonly (readonly string[])[];
  sortLabel: string;
}

interface RankedEntry {
  entry: SearchEntry;
  match: Exclude<GraphSearchMatch, "recent">;
  tier: number;
  fieldRank: number;
}

const indexBySnapshot = new WeakMap<GraphResponse, GraphSearchIndex>();

/** Normalize user-visible graph metadata without losing Korean or other Unicode text. */
export function normalizeGraphSearchText(value: string): string {
  return value.normalize("NFKC").toLowerCase().trim().replace(/\s+/gu, " ");
}

function tokenize(value: string): string[] {
  return value.match(/[\p{L}\p{N}]+/gu) ?? [];
}

function uniqueNormalizedFields(values: readonly string[]): string[] {
  const seen = new Set<string>();
  const fields: string[] = [];
  for (const value of values) {
    const normalized = normalizeGraphSearchText(value);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    fields.push(normalized);
  }
  return fields;
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function classify(entry: SearchEntry, query: string, queryTokens: readonly string[]): RankedEntry | null {
  const exactField = entry.fields.findIndex((field) => field === query);
  if (exactField >= 0) return { entry, match: "exact", tier: 0, fieldRank: exactField };

  const prefixField = entry.fields.findIndex((field) => field.startsWith(query));
  if (prefixField >= 0) return { entry, match: "prefix", tier: 1, fieldRank: prefixField };

  if (queryTokens.length) {
    const matchedFields = queryTokens.map((queryToken) => entry.fieldTokens.findIndex((tokens) =>
      tokens.some((token) => token === queryToken || token.startsWith(queryToken)),
    ));
    if (matchedFields.every((field) => field >= 0)) {
      return {
        entry,
        match: "all-token",
        tier: 2,
        fieldRank: matchedFields.reduce((total, field) => total + field, 0),
      };
    }
  }

  const substringField = entry.fields.findIndex((field) => field.includes(query));
  return substringField >= 0
    ? { entry, match: "substring", tier: 3, fieldRank: substringField }
    : null;
}

function entryForNode(node: GraphNode): SearchEntry {
  // Field order is also the deterministic tie-break priority within a match tier.
  const fields = uniqueNormalizedFields([
    node.title,
    node.slug,
    node.sourceName,
    node.sourceId,
    node.type,
    node.groupLabel,
    node.groupId,
  ]);
  return {
    entity: { kind: "node", key: `node:${node.id}`, id: node.id, label: node.title, node },
    fields,
    fieldTokens: fields.map(tokenize),
    sortLabel: normalizeGraphSearchText(node.title),
  };
}

function entryForCommunity(community: SemanticGroup): SearchEntry {
  const fields = uniqueNormalizedFields([community.label, community.id]);
  return {
    entity: {
      kind: "community",
      key: `community:${community.id}`,
      id: community.id,
      label: community.label,
      community,
    },
    fields,
    fieldTokens: fields.map(tokenize),
    sortLabel: normalizeGraphSearchText(community.label),
  };
}

/**
 * Immutable, pre-normalized search data for one graph snapshot.
 * Prefer `getGraphSearchIndex` so the same snapshot object reuses one index.
 */
export class GraphSearchIndex {
  readonly snapshotGeneratedAt: string;
  private readonly entries: readonly SearchEntry[];
  private readonly recentNodes: readonly GraphNode[];

  constructor(readonly snapshot: GraphResponse) {
    this.snapshotGeneratedAt = snapshot.generatedAt;
    this.entries = [
      ...snapshot.nodes.map(entryForNode),
      ...snapshot.semanticGroups.map(entryForCommunity),
    ];
    this.recentNodes = [...snapshot.nodes].sort((left, right) =>
      right.dbId - left.dbId
      || compareText(normalizeGraphSearchText(left.title), normalizeGraphSearchText(right.title))
      || compareText(left.id, right.id),
    );
  }

  search(rawQuery: string, requestedLimit = GRAPH_SEARCH_RESULT_LIMIT): GraphSearchResult[] {
    const limit = Math.max(0, Math.min(GRAPH_SEARCH_RESULT_LIMIT, Math.trunc(requestedLimit)));
    if (!limit) return [];

    const query = normalizeGraphSearchText(rawQuery);
    if (!query) {
      return this.recentNodes.slice(0, Math.min(limit, GRAPH_SEARCH_RECENT_LIMIT)).map((node) => ({
        kind: "node" as const,
        key: `node:${node.id}`,
        id: node.id,
        label: node.title,
        match: "recent" as const,
        node,
      }));
    }

    const queryTokens = tokenize(query);
    return this.entries
      .map((entry) => classify(entry, query, queryTokens))
      .filter((entry): entry is RankedEntry => entry !== null)
      .sort((left, right) =>
        left.tier - right.tier
        || left.fieldRank - right.fieldRank
        || compareText(left.entry.sortLabel, right.entry.sortLabel)
        || (left.entry.entity.kind === right.entry.entity.kind ? 0 : left.entry.entity.kind === "node" ? -1 : 1)
        || compareText(left.entry.entity.id, right.entry.entity.id),
      )
      .slice(0, limit)
      .map(({ entry, match }) => ({ ...entry.entity, match } as GraphSearchResult));
  }
}

/** Return the stable search index associated with a graph snapshot object. */
export function getGraphSearchIndex(snapshot: GraphResponse): GraphSearchIndex {
  const existing = indexBySnapshot.get(snapshot);
  if (existing) return existing;
  const created = new GraphSearchIndex(snapshot);
  indexBySnapshot.set(snapshot, created);
  return created;
}
