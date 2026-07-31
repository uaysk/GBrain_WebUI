import { demoGraph, demoNodeDetails, demoStatus, demoTimeline } from "../demo/gbrain-demo-memory";
import type { ControlCenterResponse, GraphRebuildStatus } from "../shared/contracts";

const rebuildStatus: GraphRebuildStatus = {
  state: "idle",
  phase: "idle",
  startedAt: null,
  finishedAt: null,
  lastSuccessfulAt: demoGraph.generatedAt,
  snapshotAvailable: true,
  error: null,
};

const control: ControlCenterResponse = {
  generatedAt: demoGraph.generatedAt,
  availability: { configured: false, connected: false, message: "Hermetic fixture" },
  management: { enabled: false, confirmationRequired: true },
  version: null,
  sources: [],
  latestFullRun: null,
  latestTargetedRun: null,
  recentJobCounts: {
    sampleSize: 0,
    waiting: 0,
    waitingChildren: 0,
    paused: 0,
    active: 0,
    completed: 0,
    failed: 0,
    delayed: 0,
    dead: 0,
    cancelled: 0,
    unknown: 0,
  },
  jobs: [],
};

const json = (value: unknown, status = 200) => Response.json(value, {
  status,
  headers: { "Cache-Control": "no-store" },
});

Bun.serve({
  hostname: "127.0.0.1",
  port: Number(process.env.E2E_FIXTURE_PORT || 43_101),
  fetch(request) {
    const url = new URL(request.url);
    if (url.pathname === "/api/status") return json(demoStatus);
    if (url.pathname === "/api/graph") return json(demoGraph);
    if (url.pathname === "/api/graph/history") return json(demoTimeline);
    if (url.pathname === "/api/graph/rebuild/status") return json(rebuildStatus);
    if (url.pathname === "/api/graph/rebuild" && request.method === "POST") return json({ accepted: true, status: rebuildStatus }, 202);
    if (url.pathname === "/api/control-center") return json(control);
    if (url.pathname === "/api/node-detail") {
      const detail = demoNodeDetails[url.searchParams.get("id") ?? ""];
      return detail ? json(detail) : json({ error: "Not found" }, 404);
    }
    return json({ error: "Fixture route not found" }, 404);
  },
});
