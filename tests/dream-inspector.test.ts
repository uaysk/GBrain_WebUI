import { describe, expect, test } from "bun:test";
import {
  parseControlCenterResponse,
  parseControlDreamRunDetail,
} from "../src/api/control-validation";
import {
  dreamRunMapHref,
  parseDreamInspectorUrlState,
  serializeDreamInspectorUrlState,
} from "../src/components/control/dream-inspector-state";
import {
  DreamRunDetailRequestError,
  dreamRunDetailCacheKey,
  fetchDreamRunDetail,
} from "../src/hooks/useDreamRunDetail";

function run(id = 7) {
  return {
    id,
    name: "autopilot-cycle",
    label: "Dream · Source cycle",
    jobStatus: "completed",
    reportStatus: "warn",
    sourceId: "default",
    startedAt: "2026-07-31T00:00:00.000Z",
    finishedAt: "2026-07-31T00:00:02.000Z",
    durationMs: 2_000,
    partial: false,
    phases: [{
      name: "propose_takes",
      label: "제안",
      status: "warn",
      durationMs: 500,
      summary: "집계 결과",
      metrics: [{ key: "proposals", label: "제안", value: 3, tone: "warning" }],
      warnings: [],
      codes: ["budget_exhausted"],
      stacktrace: "must-not-copy",
    }],
    impacts: [{ key: "pages", label: "페이지", value: 2, tone: "good" }],
    warnings: [],
    result: { credential: "must-not-copy" },
  };
}

function detailPayload() {
  return {
    snapshotGeneratedAt: "2026-07-31T00:00:03.000Z",
    stale: false,
    run: run(),
    previousRun: run(6),
    comparison: {
      metrics: [{ key: "pages", label: "페이지", current: 2, previous: 1, delta: 1 }],
      raw: "must-not-copy",
    },
    findings: [{
      id: "warning:propose_takes:0",
      kind: "warning",
      phase: "propose_takes",
      label: "제안 경고",
      detail: "집계 결과",
      raw: "must-not-copy",
    }],
    affectedPages: {
      items: [{ sourceId: "default", slug: "projects/alpha", phases: ["sync"], path: "/srv/private" }],
      total: 1,
      truncated: false,
      coverage: "complete",
    },
    stacktrace: ["must-not-copy"],
    data: { token: "must-not-copy" },
  };
}

function overviewPayload() {
  return {
    generatedAt: "2026-07-31T00:00:03.000Z",
    availability: { configured: true, connected: true, message: null },
    management: { enabled: true, confirmationRequired: true },
    version: "test",
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
    dreamRuns: [run()],
    quality: {
      status: "fresh",
      recentJobs: "fresh",
      sourceDreamRuns: "stale",
      globalDreamRuns: "unavailable",
    },
    rawJob: { token: "must-not-copy" },
  };
}

describe("Dream Inspector network contracts", () => {
  test("retains additive overview history, quality, and allowlisted phase codes", () => {
    const parsed = parseControlCenterResponse(overviewPayload());
    expect(parsed.dreamRuns?.[0]?.phases[0]?.codes).toEqual(["budget_exhausted"]);
    expect(parsed.quality).toMatchObject({ sourceDreamRuns: "stale", globalDreamRuns: "unavailable" });
    expect(JSON.stringify(parsed)).not.toContain("must-not-copy");
  });

  test("strips raw detail fields at every allowlisted boundary", () => {
    const parsed = parseControlDreamRunDetail(detailPayload());
    expect(parsed).toMatchObject({
      run: { id: 7 },
      comparison: { metrics: [{ delta: 1 }] },
      affectedPages: { items: [{ slug: "projects/alpha" }], coverage: "complete" },
    });
    const serialized = JSON.stringify(parsed);
    expect(serialized).not.toContain("must-not-copy");
    expect(serialized).not.toContain("/srv/private");
    expect(serialized).not.toContain("stacktrace");
  });

  test("rejects detail payloads that exceed the five-finding browser contract", () => {
    const payload = detailPayload();
    payload.findings = Array.from({ length: 6 }, (_, index) => ({
      id: `warning:${index}`,
      kind: "warning",
      phase: "sync",
      label: "경고",
      detail: "집계 결과",
      raw: "ignored",
    }));
    expect(() => parseControlDreamRunDetail(payload)).toThrow();
  });

  test("uses the exact job endpoint and never exposes server error bodies", async () => {
    const controller = new AbortController();
    let requestUrl = "";
    const captured: { signal?: AbortSignal } = {};
    const okFetcher = async (input: string, init?: RequestInit) => {
      requestUrl = String(input);
      captured.signal = init?.signal as AbortSignal;
      return new Response(JSON.stringify(detailPayload()), { status: 200 });
    };
    expect((await fetchDreamRunDetail(7, controller.signal, okFetcher)).run.id).toBe(7);
    expect(requestUrl).toBe("/api/control-center/dream-runs/7");
    expect(captured.signal).toBe(controller.signal);

    const failedFetcher = async () => new Response(JSON.stringify({
      error: "Bearer private-token /home/operator/private",
    }), { status: 404 });
    try {
      await fetchDreamRunDetail(7, controller.signal, failedFetcher);
      throw new Error("expected request to fail");
    } catch (error) {
      expect(error).toBeInstanceOf(DreamRunDetailRequestError);
      expect((error as Error).message).toBe("선택한 Dream 실행은 현재 스냅샷에 없습니다.");
      expect((error as Error).message).not.toContain("private-token");
    }
  });

  test("keys cache identity by both overview generation and job id", () => {
    expect(dreamRunDetailCacheKey("generation-a", 7)).not.toBe(dreamRunDetailCacheKey("generation-b", 7));
    expect(dreamRunDetailCacheKey("generation-a", 7)).not.toBe(dreamRunDetailCacheKey("generation-a", 8));
    expect(dreamRunDetailCacheKey("", 7)).toBeNull();
  });
});

describe("Dream Inspector URL state", () => {
  test("round-trips run, tab, and phase while preserving unrelated Control filters", () => {
    const params = serializeDreamInspectorUrlState({
      runId: 502,
      tab: "phases",
      phase: "extract_facts",
    }, "source=default&status=failed&utm=ops");
    expect(params.get("source")).toBe("default");
    expect(params.get("status")).toBe("failed");
    expect(params.get("utm")).toBe("ops");
    expect(parseDreamInspectorUrlState(params)).toEqual({
      runId: 502,
      tab: "phases",
      phase: "extract_facts",
    });
  });

  test("fails closed for invalid public state", () => {
    expect(parseDreamInspectorUrlState("run=-1&tab=raw&phase=")).toEqual({
      runId: null,
      tab: "overview",
      phase: null,
    });
  });

  test("creates a Map deep link without copying Control or arbitrary sensitive params", () => {
    const href = dreamRunMapHref(502, "run=501&tab=affected&source=default&token=private&view=2d&node=default%3Aalpha");
    expect(href).toBe("/?node=default%3Aalpha&view=2d&dreamRun=502");
    expect(href).not.toContain("token");
    expect(href).not.toContain("source");
  });
});
