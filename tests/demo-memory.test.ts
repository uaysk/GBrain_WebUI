import { describe, expect, test } from "bun:test";
import { demoGraph, demoNodeDetails, demoTimeline } from "../demo/gbrain-demo-memory";

describe("README demo memory", () => {
  test("contains a useful synthetic graph and timeline", () => {
    expect(demoGraph.nodes.length).toBeGreaterThanOrEqual(30);
    expect(demoGraph.communityDetection.communityCount).toBeGreaterThanOrEqual(5);
    expect(demoGraph.explicitEdges.length).toBeGreaterThan(0);
    expect(demoGraph.semanticEdges.length).toBeGreaterThan(0);
    expect(demoTimeline.versionedNodeCount).toBeGreaterThan(0);
    expect(demoTimeline.staticNodeCount).toBeGreaterThan(0);
    expect(Object.keys(demoNodeDetails)).toHaveLength(demoGraph.nodes.length);
    expect(demoGraph.nodes.every((node) => node.sourceId === "demo" && node.sourceName === "Synthetic Demo")).toBe(true);
  });

  test("does not contain direct identifiers, credentials, or known private labels", () => {
    const serialized = JSON.stringify({ graph: demoGraph, timeline: demoTimeline, details: demoNodeDetails });
    expect(serialized).not.toMatch(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
    expect(serialized).not.toMatch(/\b(?:\d{1,3}\.){3}\d{1,3}\b/);
    expect(serialized).not.toMatch(/https?:\/\//i);
    expect(serialized).not.toMatch(/password|session[_-]?secret|api[_-]?key|private[_-]?key|access[_-]?token/i);
    expect(serialized).not.toMatch(/uaysk|chungbuk|homelab|proxmox|dacon|sccp/i);
  });
});
