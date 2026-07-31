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

export interface ScreenRect { left: number; top: number; width: number; height: number }
export interface CommunityLabelCandidate {
  id: string;
  anchor: { x: number; y: number };
  size: { width: number; height: number };
  priority?: number;
}
export interface CommunityLabelPlacement extends ScreenRect { id: string; visible: boolean }

function overlaps(left: ScreenRect, right: ScreenRect, gap = 6): boolean {
  return left.left < right.left + right.width + gap
    && left.left + left.width + gap > right.left
    && left.top < right.top + right.height + gap
    && left.top + left.height + gap > right.top;
}

/** Deterministic screen-space label placement used for both 2D and 3D views. */
export function placeCommunityLabels(
  candidates: readonly CommunityLabelCandidate[],
  viewport: { width: number; height: number },
  reserved: readonly ScreenRect[] = [],
): CommunityLabelPlacement[] {
  const margin = 8;
  const placed: CommunityLabelPlacement[] = [];
  const ordered = [...candidates].sort((left, right) =>
    (right.priority ?? 0) - (left.priority ?? 0) || left.id.localeCompare(right.id));
  for (const candidate of ordered) {
    const { width, height } = candidate.size;
    const origins = [
      pixelAlignedLabelOrigin(candidate.anchor, candidate.size),
      { left: Math.round(candidate.anchor.x + 10), top: Math.round(candidate.anchor.y - height / 2) },
      { left: Math.round(candidate.anchor.x - width / 2), top: Math.round(candidate.anchor.y + 10) },
      { left: Math.round(candidate.anchor.x - width - 10), top: Math.round(candidate.anchor.y - height / 2) },
    ];
    let placement: CommunityLabelPlacement | null = null;
    for (const origin of origins) {
      const rect: CommunityLabelPlacement = {
        id: candidate.id,
        left: Math.max(margin, Math.min(viewport.width - width - margin, origin.left)),
        top: Math.max(margin, Math.min(viewport.height - height - margin, origin.top)),
        width,
        height,
        visible: true,
      };
      if (![...reserved, ...placed.filter((item) => item.visible)].some((item) => overlaps(rect, item))) {
        placement = rect;
        break;
      }
    }
    placed.push(placement ?? {
      id: candidate.id,
      left: Math.max(margin, Math.min(viewport.width - width - margin, origins[0]!.left)),
      top: Math.max(margin, Math.min(viewport.height - height - margin, origins[0]!.top)),
      width,
      height,
      visible: (candidate.priority ?? 0) > 0,
    });
  }
  return placed;
}

export { connectedNodeIdsForGroup } from "./graph-layers";
