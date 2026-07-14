import { expect, test } from "bun:test";
import { NODE_RADIUS_SCALE, UNCLASSIFIED_NODE_COLOR, type GraphResponse } from "../src/types";
import { createMap2DLayout } from "../src/graph/layout-2d";
import { shapeForType } from "../server/style";

const base = process.env.SMOKE_BASE_URL ?? "http://127.0.0.1:3000";

async function authenticatedCookie(): Promise<string> {
  const password = process.env.APP_AUTH_PASSWORD;
  if (!password) throw new Error("APP_AUTH_PASSWORD is required for smoke tests");
  const response = await fetch(`${base}/auth/login`, {
    method: "POST",
    redirect: "manual",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Origin: new URL(base).origin },
    body: new URLSearchParams({ password, next: "/" }),
  });
  expect(response.status).toBe(303);
  const cookie = response.headers.get("set-cookie")?.split(";", 1)[0];
  if (!cookie) throw new Error("Login did not return a session cookie");
  return cookie;
}

test("live graph snapshot satisfies the MVP data contract", async () => {
  const unauthenticated = await fetch(`${base}/api/graph`);
  expect(unauthenticated.status).toBe(401);
  expect(JSON.stringify(await unauthenticated.json())).not.toContain("counts");
  const cookie = await authenticatedCookie();
  const response = await fetch(`${base}/api/graph`, { headers: { Cookie: cookie } });
  expect(response.status).toBe(200);
  const graph = await response.json() as GraphResponse;
  expect(graph.nodes.length).toBe(graph.counts.pages);
  expect(graph.counts.pages).toBeGreaterThan(0);
  expect(graph.counts.chunks).toBeGreaterThanOrEqual(graph.counts.embeddedPages);
  expect(graph.nodes.filter((n) => n.hasEmbedding).length).toBe(graph.counts.embeddedPages);
  expect(graph.nodes.filter((n) => !n.hasEmbedding).length).toBe(graph.counts.unembeddedPages);
  expect(graph.nodes.filter((node) => node.isUnclassified).every((node) => node.color === UNCLASSIFIED_NODE_COLOR)).toBe(true);
  expect(graph.communityDetection.engine).toBe("leiden");
  expect(graph.communityDetection.resolution).toBeGreaterThan(0);
  expect(graph.communityDetection.weightedEdgeCount).toBeGreaterThan(0);
  expect(graph.communityDetection.communityCount).toBeGreaterThan(0);
  expect(graph.nodes.filter((n) => n.isUnclassified).length).toBe(graph.communityDetection.isolatedCount);
  expect(graph.counts.unclassifiedPages).toBe(graph.communityDetection.isolatedCount);
  expect(graph.semanticGroups.filter((group) => group.kind === "community").length).toBe(graph.communityDetection.communityCount);
  expect(graph.semanticGroups.reduce((sum, group) => sum + group.count, 0)).toBe(graph.counts.pages);
  expect(graph.nodes.every((node) => node.communityStrength === null || (node.communityStrength >= 0 && node.communityStrength <= 1))).toBe(true);
  expect(new Set(graph.nodes.map((n) => n.id)).size).toBe(graph.nodes.length);
  expect(graph.nodes.every((n) => n.id === `${n.sourceId}::${n.slug}`)).toBe(true);
  expect(graph.nodes.every((n) => n.shape === shapeForType(n.type))).toBe(true);
  expect(graph.nodes.every((n) => !n.slug.startsWith("indexes/brain-map-") && !n.title.startsWith("GBrain Brain Map"))).toBe(true);
  const unclassifiedDistances = graph.nodes.filter((node) => node.isUnclassified).map((node) => Math.hypot(node.x, node.y, node.z));
  expect(Math.max(...unclassifiedDistances)).toBeLessThan(90);
  expect(Math.min(...unclassifiedDistances)).toBeGreaterThan(55);
  const nodeIds = new Set(graph.nodes.map((node) => node.id));
  expect([...graph.explicitEdges, ...graph.semanticEdges].every((edge) => nodeIds.has(String(edge.source)) && nodeIds.has(String(edge.target)))).toBe(true);
  let minimumSurfaceGap = Infinity;
  for (let left = 0; left < graph.nodes.length; left += 1) for (let right = left + 1; right < graph.nodes.length; right += 1) {
    const a = graph.nodes[left]!; const b = graph.nodes[right]!;
    const centerDistance = Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
    minimumSurfaceGap = Math.min(minimumSurfaceGap, centerDistance - NODE_RADIUS_SCALE * a.size - NODE_RADIUS_SCALE * b.size);
  }
  expect(minimumSurfaceGap).toBeGreaterThan(0.75);
  const map2D = createMap2DLayout(graph.nodes);
  expect(Object.keys(map2D.positions).length).toBe(graph.nodes.length);
  expect(Object.values(map2D.positions).every((point) => point.z === 0)).toBe(true);
  expect(map2D.minimumNodeGap).toBeGreaterThan(0.75);
  expect(map2D.minimumCommunityGap).toBeGreaterThan(13.5);
  expect(map2D.looseNodeIds.length).toBe(graph.nodes.filter((node) => node.isUnclassified || !node.hasEmbedding).length);
  expect(graph.semanticEdges.length).toBe(graph.counts.embeddedPages * 2);
  expect(graph.semanticEdges.every((e) => e.similarity !== null && e.kind === "semantic" && !e.directed)).toBe(true);
  expect(graph.explicitEdges.every((e) => e.kind === "explicit" && typeof e.linkType === "string")).toBe(true);
  const serialized = JSON.stringify(graph);
  expect(serialized).not.toContain("embedding_text");
  expect(serialized).not.toContain("compiled_truth");
  expect(serialized).not.toContain("GBRAIN_DB_PASSWORD");
  expect(serialized.toLowerCase()).not.toContain("hdbscan");
});
