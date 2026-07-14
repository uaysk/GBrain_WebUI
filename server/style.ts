import type { RelationFamily } from "../src/types";
import { RELATION_VISUALS, shapeForType } from "../src/graph/visual-spec";

export { shapeForType };

export const GROUP_COLORS = [
  "#5DA9E9", "#E07A7A", "#72B89A", "#D5A75E", "#9B83D4", "#72B7C7", "#D687B8", "#A7B565", "#9AABBF", "#C88962",
  "#7E9FDB", "#B88DC7", "#6FA6A0", "#B39A66", "#8FA36B", "#C27C91", "#7896B4", "#AA856E", "#7B9A7C", "#9C83A8",
];

export const RELATION_STYLE = RELATION_VISUALS;

const normalize = (value: string) => value.trim().toLowerCase().replace(/[\s-]+/g, "_");
const mentions = new Set(["mention", "mentions", "reference", "references", "markdown", "wikilink"]);
const associations = new Set(["association", "associated_with", "related", "related_to", "relates_to"]);
const hierarchy = new Set(["catalogs", "child_of", "composition", "contains", "depends_on", "parent_of", "part_of"]);
const provenance = new Set(["based_on", "citation", "cites", "derived_from", "provenance", "source", "has_patch"]);
const temporal = new Set(["evolves_from", "followed_by", "follows", "precedes", "superseded_by", "supersedes"]);

export function familyForType(linkType: string | null): RelationFamily {
  if (!linkType?.trim()) return "association";
  const value = normalize(linkType);
  if (mentions.has(value)) return "mention";
  if (associations.has(value)) return "association";
  if (hierarchy.has(value) || value.startsWith("has_")) return "hierarchy";
  if (provenance.has(value)) return "provenance";
  if (temporal.has(value)) return "temporal";
  return "association";
}

export interface EdgeIdentity { id: string; source: string; target: string; family: RelationFamily }
export function assignCurvatures<T extends EdgeIdentity>(edges: T[]): Array<T & { curvature: number; parallelIndex: number; selfLink: boolean }> {
  const groups = new Map<string, T[]>();
  for (const edge of edges) {
    const key = [edge.source, edge.target].sort().join("\u0000");
    groups.set(key, [...(groups.get(key) ?? []), edge]);
  }
  const placement = new Map<string, { curvature: number; parallelIndex: number; selfLink: boolean }>();
  for (const group of groups.values()) {
    group.sort((a, b) => a.family.localeCompare(b.family) || a.id.localeCompare(b.id));
    const count = group.length;
    group.forEach((edge, index) => {
      const selfLink = edge.source === edge.target;
      let curvature = 0;
      if (selfLink) curvature = 0;
      else if (count === 1) curvature = 0;
      else curvature = 0;
      placement.set(edge.id, { curvature, parallelIndex: index, selfLink });
    });
  }
  return edges.map((edge) => ({ ...edge, ...(placement.get(edge.id)!) }));
}
