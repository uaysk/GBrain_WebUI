import type { NodeShape, RelationFamily } from "../api/types";

export const NODE_RADIUS_SCALE = 0.675;
export const NODE_SELECTED_SCALE = 1.12;
export const NODE_COLLISION_GAP = 0.8;
export const UNCLASSIFIED_NODE_COLOR = "#E8A838";
export const RELATION_DIRECTION_ARROW_LENGTH = 0;

export const NODE_SHAPE_LEGEND: ReadonlyArray<{ shape: NodeShape; label: string; types: string }> = [
  { shape: "circle", label: "Concept", types: "concept" },
  { shape: "square", label: "Project", types: "project" },
  { shape: "diamond", label: "Note / analysis", types: "note, analysis" },
  { shape: "triangle", label: "Incident", types: "incident" },
  { shape: "hexagon", label: "Log / snapshot", types: "project log, snapshot" },
  { shape: "octagon", label: "Extract receipt", types: "extract receipt" },
  { shape: "pentagon", label: "Other", types: "other page types" },
];

export const RELATION_VISUALS: Record<RelationFamily, {
  label: string;
  color: string;
  dash: number[];
  width: number;
  directed: boolean;
  priority: number;
}> = {
  semantic: { label: "Semantic similarity", color: "#4CC9D9", dash: [], width: 0.6, directed: false, priority: 1 },
  mention: { label: "Mention / reference", color: "#4F8FE8", dash: [1, 3], width: 1.1, directed: true, priority: 2 },
  association: { label: "Association", color: "#4FAF79", dash: [], width: 1.6, directed: false, priority: 3 },
  hierarchy: { label: "Structure / dependency", color: "#D98A42", dash: [], width: 2.6, directed: true, priority: 5 },
  provenance: { label: "Provenance / evidence", color: "#9B72D7", dash: [4, 3], width: 2, directed: true, priority: 4 },
  temporal: { label: "Temporal", color: "#D45C5C", dash: [9, 5], width: 3, directed: true, priority: 6 },
  custom: { label: "Other relation", color: "#4FAF79", dash: [], width: 1.6, directed: false, priority: 0 },
};

export const EXPLICIT_RELATION_FAMILIES = ["mention", "association", "hierarchy", "provenance", "temporal", "custom"] as const satisfies readonly RelationFamily[];

export function shapeForType(type: string): NodeShape {
  if (type === "concept") return "circle";
  if (["project", "project_note"].includes(type)) return "square";
  if (["note", "analysis", "guide"].includes(type)) return "diamond";
  if (["incident", "incident-followup"].includes(type)) return "triangle";
  if (["project-log", "ops-snapshot", "infrastructure-snapshot"].includes(type)) return "hexagon";
  if (type === "extract_receipt") return "octagon";
  return "pentagon";
}
