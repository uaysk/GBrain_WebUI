export const COMMUNITY_LABEL_STYLE = {
  color: "rgba(255,255,255,0.30)",
  hoverColor: "rgba(255,255,255,1)",
  dimColor: "rgba(255,255,255,0.09)",
  backgroundColor: "rgba(0,0,0,0.40)",
  hoverBackgroundColor: "rgba(0,0,0,0.58)",
  dimBackgroundColor: "rgba(0,0,0,0.16)",
} as const;

export function communityLabelTitle(label: string): string {
  return label.replace(/^Leiden\s+\d+\s*·\s*/i, "");
}

export function pixelAlignedLabelOrigin(anchor: { x: number; y: number }, size: { width: number; height: number }): { left: number; top: number } {
  return { left: Math.round(anchor.x - size.width / 2), top: Math.round(anchor.y - size.height) };
}

export { connectedNodeIdsForGroup } from "./graph-layers";
