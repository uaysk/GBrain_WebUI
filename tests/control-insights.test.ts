import { describe, expect, test } from "bun:test";
import type {
  ControlCenterResponse,
  ControlJob,
  ControlSourceStatus,
} from "../src/types";
import {
  accumulateControlHistory,
  buildControlActionPreview,
  buildControlInbox,
  createControlHistoryPoint,
  diffControlMetrics,
  summarizeControlHistory,
  type ControlHistoryPoint,
} from "../server/control-insights";

const baseAt = "2026-07-26T12:00:00.000Z";

function source(overrides: Partial<ControlSourceStatus> = {}): ControlSourceStatus {
  return {
    id: "default",
    name: "Primary memory",
    syncEnabled: true,
    lastSyncAt: "2026-07-26T11:00:00.000Z",
    stalenessHours: 1,
    stalenessClass: "fresh",
    pages: 100,
    chunksTotal: 400,
    chunksUnembedded: 40,
    embeddingCoveragePct: 90,
    backfillQueued: 0,
    backfillActive: 0,
    ...overrides,
  };
}

function job(overrides: Partial<ControlJob> = {}): ControlJob {
  return {
    id: 10,
    name: "sync",
    label: "소스 동기화",
    queue: "default",
    status: "completed",
    sourceId: "default",
    createdAt: "2026-07-26T11:50:00.000Z",
    startedAt: "2026-07-26T11:51:00.000Z",
    finishedAt: "2026-07-26T11:52:00.000Z",
    durationMs: 60_000,
    attemptsMade: 1,
    maxAttempts: 2,
    error: null,
    progress: null,
    run: null,
    ...overrides,
  };
}

function snapshot(overrides: Partial<ControlCenterResponse> = {}): ControlCenterResponse {
  const jobs = overrides.jobs ?? [job()];
  const recentJobCounts = {
    sampleSize: jobs.length,
    waiting: jobs.filter((item) => item.status === "waiting").length,
    waitingChildren: jobs.filter((item) => item.status === "waiting-children").length,
    paused: jobs.filter((item) => item.status === "paused").length,
    active: jobs.filter((item) => item.status === "active").length,
    completed: jobs.filter((item) => item.status === "completed").length,
    failed: jobs.filter((item) => item.status === "failed").length,
    delayed: jobs.filter((item) => item.status === "delayed").length,
    dead: jobs.filter((item) => item.status === "dead").length,
    cancelled: jobs.filter((item) => item.status === "cancelled").length,
    unknown: jobs.filter((item) => item.status === "unknown").length,
  };
  return {
    generatedAt: baseAt,
    availability: { configured: true, connected: true, message: null },
    management: { enabled: true, confirmationRequired: true },
    version: "test",
    sources: [source()],
    latestFullRun: null,
    latestTargetedRun: null,
    recentJobCounts,
    jobs,
    ...overrides,
  };
}

describe("control operations inbox", () => {
  test("prioritizes normalized failures, pending verification, stale sources, low embedding, and long waits", () => {
    const jobs = [
      job({
        id: 21,
        status: "dead",
        error: "Bearer private-token /home/operator/private",
        attemptsMade: 3,
        maxAttempts: 3,
      }),
      job({
        id: 22,
        name: "embed",
        label: "Embedding",
        status: "waiting",
        createdAt: "2026-07-26T10:00:00.000Z",
        startedAt: null,
        finishedAt: null,
        durationMs: 0,
      }),
    ];
    const data = snapshot({
      sources: [source({
        lastSyncAt: "2026-07-23T12:00:00.000Z",
        stalenessHours: 72,
        stalenessClass: "stale",
        chunksUnembedded: 200,
        embeddingCoveragePct: 50,
      })],
      jobs,
    });
    const items = buildControlInbox(data, {
      now: baseAt,
      pendingVerifications: [{
        actionId: "safe-action-id",
        action: "source-sync",
        sourceId: "default",
        createdAt: "2026-07-26T11:40:00.000Z",
      }],
    });

    expect(items.map((item) => item.kind)).toEqual([
      "failed-job",
      "pending-verification",
      "stale-source",
      "low-embedding",
      "long-waiting",
    ]);
    expect(items[0]).toMatchObject({
      jobId: 21,
      severity: "critical",
      action: "job-retry",
    });
    expect(items.find((item) => item.kind === "long-waiting")?.ageMs).toBe(2 * 60 * 60_000);
    const serialized = JSON.stringify(items);
    expect(serialized).not.toContain("private-token");
    expect(serialized).not.toContain("/home/operator");
  });

  test("uses inclusive thresholds, skips invalid pending timestamps, and supports a deterministic limit", () => {
    const data = snapshot({
      sources: [source({
        stalenessHours: 24,
        stalenessClass: "aging",
        chunksTotal: 0,
        chunksUnembedded: 0,
        embeddingCoveragePct: 0,
      })],
      jobs: [job({
        id: 30,
        status: "delayed",
        createdAt: "2026-07-26T11:45:00.000Z",
        startedAt: null,
        finishedAt: null,
        durationMs: 0,
      })],
    });

    const items = buildControlInbox(data, {
      limit: 1,
      pendingVerifications: [{
        actionId: "invalid",
        action: "quick-dream",
        createdAt: "not-a-date",
      }],
    });

    expect(items).toHaveLength(1);
    expect(items[0].kind).toBe("stale-source");
    expect(() => buildControlInbox(data, { now: "invalid" })).toThrow(RangeError);
  });
});

describe("compact Control Center history", () => {
  test("creates a compact point without raw job fields and computes weighted totals", () => {
    const data = snapshot({
      sources: [
        source({ id: "a", name: "A", chunksTotal: 100, chunksUnembedded: 10, embeddingCoveragePct: 90 }),
        source({ id: "b", name: "B", pages: 50, chunksTotal: 300, chunksUnembedded: 150, embeddingCoveragePct: 50 }),
      ],
      jobs: [
        job({ id: 1, durationMs: 60_000 }),
        job({ id: 2, durationMs: 120_000 }),
        job({
          id: 3,
          status: "failed",
          error: "password=secret",
          startedAt: null,
          finishedAt: null,
          durationMs: 0,
        }),
      ],
    });

    const point = createControlHistoryPoint(data);

    expect(point.totals).toEqual({
      pages: 150,
      chunks: 400,
      unembeddedChunks: 160,
      embeddingCoveragePct: 60,
      staleSources: 0,
    });
    expect(point.jobs).toMatchObject({
      completed: 2,
      failed: 1,
      successRatePct: 66.67,
      averageDurationMs: 90_000,
    });
    expect(JSON.stringify(point)).not.toContain("secret");
  });

  test("accumulates immutably, replaces duplicate instants, prunes old/future points, and caps size", () => {
    const initial = createControlHistoryPoint(snapshot({
      generatedAt: "2026-07-25T12:00:00.000Z",
      sources: [source({ pages: 80 })],
    }));
    const old = { ...initial, at: "2026-06-01T12:00:00.000Z" };
    const future = { ...initial, at: "2026-07-27T12:00:00.000Z" };
    const duplicate = { ...initial, at: baseAt };
    const original = [old, initial, future, duplicate];

    const accumulated = accumulateControlHistory(original, snapshot(), {
      maxAgeDays: 30,
      maxPoints: 2,
    });

    expect(accumulated.map((point) => point.at)).toEqual([
      "2026-07-25T12:00:00.000Z",
      baseAt,
    ]);
    expect(accumulated[1].totals.pages).toBe(100);
    expect(original).toHaveLength(4);
  });

  test("summarizes 7-day and 30-day source/job trends and ignores invalid or future points", () => {
    const makePoint = (at: string, pages: number, coverage: number, failed: number): ControlHistoryPoint => ({
      at,
      totals: {
        pages,
        chunks: 100,
        unembeddedChunks: 100 - coverage,
        embeddingCoveragePct: coverage,
        staleSources: 0,
      },
      jobs: {
        queued: 0,
        active: 0,
        completed: 10,
        failed,
        dead: 0,
        cancelled: 0,
        successRatePct: 90 - failed,
        averageDurationMs: 60_000,
      },
      sources: [{
        id: "default",
        pages,
        chunks: 100,
        unembeddedChunks: 100 - coverage,
        embeddingCoveragePct: coverage,
        stalenessHours: 1,
      }],
    });
    const history = [
      makePoint("2026-07-01T12:00:00.000Z", 70, 70, 3),
      makePoint("2026-07-20T12:00:00.000Z", 90, 80, 2),
      makePoint(baseAt, 100, 90, 1),
      { ...makePoint("2026-07-27T12:00:00.000Z", 999, 1, 99) },
      { ...makePoint("2026-07-22T12:00:00.000Z", 1, 1, 1), at: "invalid" },
    ];

    const summary = summarizeControlHistory(history, baseAt);

    expect(summary.sevenDays.samples).toBe(2);
    expect(summary.sevenDays.totals.pages).toMatchObject({ first: 90, latest: 100, delta: 10 });
    expect(summary.sevenDays.sources[0].embeddingCoveragePct.delta).toBe(10);
    expect(summary.thirtyDays.samples).toBe(3);
    expect(summary.thirtyDays.totals.pages?.delta).toBe(30);
    expect(summarizeControlHistory([], baseAt).sevenDays.totals.pages).toBeNull();
  });
});

describe("action impact preview", () => {
  test("estimates workload and duration from recent matching jobs, and surfaces conflicts", () => {
    const data = snapshot({
      sources: [source({ pages: 120, chunksTotal: 500, chunksUnembedded: 25 })],
      jobs: [
        job({ id: 1, name: "embed", label: "Embedding", durationMs: 100_000 }),
        job({
          id: 2,
          name: "embed",
          label: "Embedding",
          status: "active",
          startedAt: "2026-07-26T11:59:00.000Z",
          finishedAt: null,
          durationMs: 60_000,
        }),
      ],
    });

    const preview = buildControlActionPreview(data, {
      action: "embedding-refresh",
      sourceId: "default",
    });

    expect(preview).toMatchObject({
      isEstimate: true,
      workload: { pages: 25, chunks: 25, qualifier: "minimum" },
      duration: {
        minMs: 80_000,
        maxMs: 125_000,
        basis: "recent-jobs",
        sampleSize: 1,
      },
      conflicts: [{ jobId: 2, status: "active" }],
    });
    expect(preview?.estimateNotice).toContain("실제 dry-run 결과가 아닙니다");
  });

  test("uses safe defaults, supports job actions, and returns null for absent targets", () => {
    const retry = buildControlActionPreview(snapshot({
      jobs: [job({ id: 44, status: "failed", finishedAt: baseAt })],
    }), {
      action: "job-retry",
      jobId: 44,
    });
    const cancel = buildControlActionPreview(snapshot({
      jobs: [job({ id: 45, status: "waiting", finishedAt: null })],
    }), {
      action: "job-cancel",
      jobId: 45,
    });

    expect(retry?.duration.basis).toBe("default-range");
    expect(retry?.targetLabel).toBe("소스 동기화 #44");
    expect(cancel?.workload.qualifier).toBe("not-applicable");
    expect(buildControlActionPreview(snapshot(), {
      action: "source-sync",
      sourceId: "missing",
    })).toBeNull();
    expect(buildControlActionPreview(snapshot(), {
      action: "job-cancel",
      jobId: 999,
    })).toBeNull();
  });
});

describe("before/after metric diff", () => {
  test("marks improvements according to metric semantics", () => {
    const before = snapshot({
      generatedAt: "2026-07-26T11:00:00.000Z",
      sources: [source({
        pages: 100,
        chunksTotal: 400,
        chunksUnembedded: 40,
        embeddingCoveragePct: 90,
        stalenessHours: 20,
      })],
    });
    const after = snapshot({
      generatedAt: baseAt,
      sources: [source({
        pages: 105,
        chunksTotal: 420,
        chunksUnembedded: 10,
        embeddingCoveragePct: 97.6,
        stalenessHours: 0,
      })],
    });

    const diff = diffControlMetrics(before, after, "default");

    expect(diff.metrics.find((metric) => metric.key === "pages")).toMatchObject({
      before: 100,
      after: 105,
      delta: 5,
      direction: "up",
      tone: "good",
    });
    expect(diff.metrics.find((metric) => metric.key === "unembedded")).toMatchObject({
      delta: -30,
      direction: "down",
      lowerIsBetter: true,
      tone: "good",
    });
    expect(diff.metrics.find((metric) => metric.key === "staleness")?.tone).toBe("good");
  });

  test("returns a safe empty source diff when either snapshot lacks the target", () => {
    const result = diffControlMetrics(
      snapshot({ sources: [] }),
      snapshot({ generatedAt: "2026-07-26T13:00:00.000Z" }),
      "default",
    );

    expect(result.metrics).toEqual([]);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain("변경 전 snapshot");
    expect(() => diffControlMetrics(
      snapshot({ generatedAt: "invalid" }),
      snapshot(),
    )).toThrow(RangeError);
  });
});
