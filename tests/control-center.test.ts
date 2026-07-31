import { describe, expect, spyOn, test } from "bun:test";
import {
  ControlCenterService,
  decodeControlToolPayload,
  normalizeControlCenter,
  normalizeControlDreamRuns,
  normalizeControlPhase,
  type ControlReadResult,
  type ControlReader,
} from "../server/control-center";
import type { Config } from "../server/config";

const finishedAt = "2026-07-26T03:05:00.000Z";

const statusFixture = {
  version: "0.42.58.0",
  sync: {
    sources: [
      {
        source_id: "default",
        name: "Primary memory",
        sync_enabled: true,
        last_sync_at: "2026-07-26T03:00:00.000Z",
        staleness_hours: 0.1,
        staleness_class: "fresh",
        pages: 120,
        chunks_total: 360,
        chunks_unembedded: 18,
        embedding_coverage_pct: 95,
        backfill_queued: 2,
        backfill_active: 1,
      },
      {
        source_id: "private",
        name: "Not allowed",
        pages: 999,
        chunks_total: 999,
        embedding_coverage_pct: 100,
      },
    ],
  },
  cycle: {
    last_full: {
      name: "autopilot-cycle",
      status: "completed",
      finished_at: finishedAt,
      duration_ms: 4_200,
    },
  },
};

const jobsFixture = [
  {
    id: 101,
    name: "autopilot-cycle",
    queue: "maintenance",
    status: "completed",
    data: {
      source_id: "default",
      token: "must-never-reach-the-browser",
      repoPath: "/home/operator/private-brain",
    },
    attempts_made: 1,
    max_attempts: 3,
    created_at: "2026-07-26T03:00:00.000Z",
    started_at: "2026-07-26T03:04:55.800Z",
    finished_at: finishedAt,
    lock_token: "internal-lock",
    idempotency_key: "internal-idempotency",
    stacktrace: ["private stack"],
    result: {
      status: "partial",
      partial: true,
      report: {
        status: "partial",
        timestamp: "2026-07-26T03:04:55.800Z",
        duration_ms: 4_200,
        brain_dir: "/home/operator/private-brain",
        totals: {
          pages_embedded: 12,
          orphans_found: 2,
        },
        phases: [
          {
            phase: "lint",
            status: "ok",
            duration_ms: 800,
            summary: "문서 구조를 검사했습니다.",
            details: { fixed: 3, issues: 0 },
          },
          {
            phase: "embed",
            status: "warn",
            duration_ms: 3_400,
            summary: "token=must-never-reach-the-browser /home/operator/private-brain",
            details: {
              pages_embedded: 12,
              warnings: ["password=private-value"],
            },
          },
          {
            phase: "purge",
            status: "skipped",
            duration_ms: 0,
            details: { reason: "recovery window is active" },
          },
        ],
      },
    },
  },
  {
    id: 102,
    name: "autopilot-cycle",
    status: "failed",
    data: { source_id: "private" },
    created_at: "2026-07-26T03:06:00.000Z",
  },
  {
    id: 103,
    name: "child-orchestrator",
    status: "waiting-children",
    data: { sourceId: "default" },
    created_at: "2026-07-26T03:07:00.000Z",
  },
  {
    id: 104,
    name: "maintenance-window",
    status: "paused",
    data: { sourceId: "default" },
    created_at: "2026-07-26T03:08:00.000Z",
  },
];

const sourceDreamPhases = [
  "lint",
  "backlinks",
  "sync",
  "synthesize",
  "extract",
  "extract_facts",
  "extract_atoms",
  "patterns",
  "recompute_emotional_weight",
  "consolidate",
  "propose_takes",
  "conversation_facts_backfill",
  "enrich_thin",
  "schema-suggest",
] as const;

const globalDreamPhases = [
  "resolve_symbol_edges",
  "synthesize_concepts",
  "grade_takes",
  "calibration_profile",
  "skillopt",
  "embed",
  "orphans",
  "purge",
] as const;

function dreamPhase(phase: string, overrides: Record<string, unknown> = {}) {
  return {
    phase,
    status: "ok",
    duration_ms: 100,
    summary: `${phase} completed`,
    details: {},
    ...overrides,
  };
}

function dreamJob({
  id,
  name = "autopilot-cycle",
  sourceId = "default",
  finishedAt: jobFinishedAt,
  totals = {},
  phases,
  affectedPages,
}: {
  id: number;
  name?: "autopilot-cycle" | "autopilot-global-maintenance";
  sourceId?: string | null;
  finishedAt: string;
  totals?: Record<string, unknown>;
  phases: unknown[];
  affectedPages?: unknown;
}) {
  return {
    id,
    name,
    queue: "maintenance",
    status: "completed",
    data: sourceId === null
      ? { credential: "raw-data-secret", path: "/home/operator/raw" }
      : { source_id: sourceId, credential: "raw-data-secret", path: "/home/operator/raw" },
    created_at: jobFinishedAt,
    started_at: new Date(new Date(jobFinishedAt).getTime() - 2_000).toISOString(),
    finished_at: jobFinishedAt,
    stacktrace: ["raw-stacktrace-secret"],
    logs: "raw-log-secret",
    result: {
      status: "ok",
      report: {
        schema_version: "1",
        status: "ok",
        duration_ms: 2_000,
        totals,
        phases,
        ...(affectedPages === undefined ? {} : { affected_pages: affectedPages }),
        brain_dir: "/srv/gbrain/private",
        raw_result_secret: "must-not-be-exposed",
      },
    },
  };
}

function dreamReadFixture() {
  const previous = dreamJob({
    id: 501,
    finishedAt: "2026-07-25T03:05:00.000Z",
    totals: { pages_embedded: 10, orphans_found: 0, pages_synced: 7 },
    phases: sourceDreamPhases.map((phase) => dreamPhase(phase)),
    affectedPages: { items: [], total: 0, truncated: false },
  });
  const current = dreamJob({
    id: 502,
    finishedAt: "2026-07-26T03:05:00.000Z",
    totals: { pages_embedded: 12, orphans_found: 2 },
    phases: sourceDreamPhases.map((phase) => {
      if (phase === "sync") return dreamPhase(phase, {
        status: "fail",
        duration_ms: 800,
        summary: "sync failed safely",
        details: { failed_files: 2, warnings: ["raw-warning-secret"] },
        error: {
          code: "SYNC_FAIL",
          message: "raw-error-secret",
          hint: "raw-hint-secret",
        },
      });
      if (phase === "propose_takes") return dreamPhase(phase, {
        status: "warn",
        duration_ms: 500,
        summary: "proposal budget reached",
        details: { proposals_inserted: 3, budget_exhausted: true },
      });
      return dreamPhase(phase);
    }),
    affectedPages: {
      items: [
        { source_id: "default", slug: "projects/alpha", phases: ["sync"] },
        { sourceId: "default", slug: "projects/alpha", phases: ["extract", "sync"] },
      ],
      total: 1,
      truncated: false,
    },
  });
  const global = dreamJob({
    id: 601,
    name: "autopilot-global-maintenance",
    sourceId: null,
    finishedAt: "2026-07-26T04:05:00.000Z",
    totals: { pages_embedded: 4, orphans_found: 1 },
    phases: globalDreamPhases.map((phase) => dreamPhase(phase)),
    affectedPages: {
      items: [{ source_id: "default", slug: "notes/global", phases: ["embed"] }],
      total: 1,
      truncated: false,
    },
  });
  return { current, previous, global };
}

const controlConfig: Config["controlCenter"] = {
  mcpUrl: "http://127.0.0.1:3131/mcp",
  mcpToken: "server-only-test-token",
  requestTimeoutMs: 10_000,
  cacheMs: 60_000,
  mutationsEnabled: true,
  actionLedgerPath: null,
};

class FixtureReader implements ControlReader {
  calls = 0;

  constructor(private readonly result: ControlReadResult) {}

  async read(): Promise<ControlReadResult> {
    this.calls += 1;
    return this.result;
  }
}

function controlReadResult(overrides: Partial<ControlReadResult> = {}): ControlReadResult {
  return {
    status: statusFixture,
    recentJobs: jobsFixture,
    fullRuns: [],
    globalRuns: [],
    partial: false,
    ...overrides,
  };
}

describe("Control Center normalization", () => {
  test("builds visual summaries while preserving job and report status separately", () => {
    const result = normalizeControlCenter(statusFixture, jobsFixture, ["default"]);

    expect(result.version).toBe("0.42.58.0");
    expect(result.sources).toHaveLength(1);
    expect(result.sources[0]).toMatchObject({
      id: "default",
      pages: 120,
      embeddingCoveragePct: 95,
      chunksUnembedded: 18,
    });
    expect(result.latestFullRun).toMatchObject({
      id: 101,
      jobStatus: "completed",
      reportStatus: "warn",
      partial: true,
      durationMs: 4_200,
    });
    expect(result.latestFullRun?.phases.map((phase) => phase.status)).toEqual(["ok", "warn", "skipped"]);
    expect(result.latestFullRun?.impacts).toEqual([
      { key: "orphans_found", label: "고립 페이지", value: 2, tone: "warning" },
      { key: "pages_embedded", label: "Embedding 페이지", value: 12, tone: "good" },
    ]);
    expect(result.recentJobCounts).toMatchObject({
      sampleSize: 3,
      completed: 1,
      waitingChildren: 1,
      paused: 1,
      failed: 0,
    });
    expect(result.jobs.map((job) => job.id)).toEqual([104, 103, 101]);
  });

  test("exposes only the normalized parent Job identifier for dependency visualization", () => {
    const result = normalizeControlCenter(statusFixture, [{
      ...jobsFixture[0],
      id: 120,
      parent_job_id: 101,
      data: { source_id: "default", parentSecret: "must-not-copy" },
    }], ["default"]);

    expect(result.jobs[0].parentId).toBe(101);
    expect(JSON.stringify(result.jobs[0])).not.toContain("parentSecret");
  });

  test("never includes raw job payloads, credentials, local paths, or disallowed sources", () => {
    const serialized = JSON.stringify(normalizeControlCenter(statusFixture, [
      ...jobsFixture,
      {
        id: 199,
        name: "sync",
        status: "failed",
        data: { source_id: "default" },
        error_text: "failure\n    at run (/home/operator/private.ts:1:2)\n    at C:\\Users\\operator\\private.ts:2:3 postgres://user:pass@db/gbrain password=raw-password",
        error: { message: "raw-nested-error-secret" },
        created_at: "2026-07-26T03:09:00.000Z",
      },
    ], ["default"]));

    expect(serialized).not.toContain("must-never-reach-the-browser");
    expect(serialized).not.toContain("private-value");
    expect(serialized).not.toContain("/home/operator");
    expect(serialized).not.toContain("internal-lock");
    expect(serialized).not.toContain("internal-idempotency");
    expect(serialized).not.toContain("private stack");
    expect(serialized).not.toContain("raw-nested-error-secret");
    expect(serialized).not.toContain("raw-password");
    expect(serialized).not.toContain("postgres://");
    expect(serialized).not.toContain("C:\\Users");
    expect(serialized).not.toContain("\n    at ");
    expect(serialized).not.toContain("Not allowed");
    expect(serialized).toContain("<redacted>");
    expect(serialized).toContain("<local-path>");
  });

  test("handles malformed and future phase values without exposing raw structures", () => {
    expect(normalizeControlPhase(null)).toEqual({
      name: "unknown",
      label: "unknown",
      status: "unknown",
      durationMs: 0,
      summary: "단계 결과가 제공되지 않았습니다.",
      metrics: [],
      warnings: [],
      codes: [],
    });
    expect(normalizeControlPhase({
      phase: "future_phase",
      status: "new-state",
      details: { arbitrary_payload: "not copied" },
    })).toMatchObject({
      name: "future_phase",
      label: "future phase",
      status: "unknown",
      metrics: [],
    });
  });

  test("uses phase registries to canonicalize aliases and emits only allowlisted remediation codes", () => {
    const migration = normalizeControlPhase({
      phase: "extract_facts",
      status: "warn",
      details: {
        pagesScanned: 9,
        legacy_rows_pending: 3,
        warnings: ["raw-warning-secret"],
        hint: "raw-hint-secret",
        arbitrary_count: 999,
      },
      error: { message: "raw-error-secret", hint: "raw-error-hint-secret" },
    });
    expect(migration).toMatchObject({
      metrics: [
        { key: "legacyRowsPending", value: 3 },
        { key: "pages_scanned", value: 9 },
      ],
      codes: ["migration_required"],
    });
    const migrationSerialized = JSON.stringify(migration);
    for (const secret of ["raw-error-secret", "raw-error-hint-secret", "raw-warning-secret", "raw-hint-secret", "999"]) {
      expect(migrationSerialized).not.toContain(secret);
    }

    const serialized = JSON.stringify(normalizeControlPhase({
      phase: "extract_atoms",
      status: "skipped",
      details: { reason: "not_in_active_pack", pack_gated: true },
      error: { message: "raw-message-secret", hint: "raw-hint-secret" },
    }));
    expect(serialized).toContain("pack_gated");
    for (const secret of ["raw-message-secret", "raw-hint-secret"]) {
      expect(serialized).not.toContain(secret);
    }
  });

  test("caps the recent-job visualization at 30 while retaining detailed cycle lookup", () => {
    const oldCycle = {
      ...jobsFixture[0],
      id: 50,
      created_at: "2026-07-24T03:00:00.000Z",
      finished_at: finishedAt,
    };
    const recentJobs = Array.from({ length: 32 }, (_, index) => ({
      id: 1_000 + index,
      name: "sync",
      status: "completed",
      data: { sourceId: "default" },
      created_at: new Date(Date.UTC(2026, 6, 26, 4, index)).toISOString(),
    }));
    const result = normalizeControlCenter(statusFixture, [...recentJobs, oldCycle], ["default"]);

    expect(result.jobs).toHaveLength(30);
    expect(result.recentJobCounts.sampleSize).toBe(30);
    expect(result.latestFullRun?.id).toBe(50);
  });

  test("does not use a source-ambiguous full-cycle snapshot as an allowlisted result", () => {
    const result = normalizeControlCenter(statusFixture, [
      { ...jobsFixture[0], data: {} },
    ], ["default"]);

    expect(result.latestFullRun).toBeNull();
  });

  test("fails closed for source-less global summaries when only part of the source set is allowed", () => {
    const result = normalizeControlCenter({
      ...statusFixture,
      cycle: {
        ...statusFixture.cycle,
        last_targeted: {
          name: "autopilot-global-maintenance",
          status: "completed",
          finished_at: finishedAt,
          totals: { pages_embedded: 999 },
        },
      },
    }, [{
      ...jobsFixture[0],
      id: 105,
      name: "autopilot-global-maintenance",
      data: {},
    }], ["default"]);

    expect(result.latestTargetedRun).toBeNull();
    expect(result.jobs).toHaveLength(0);
    expect(JSON.stringify(result)).not.toContain("999");
  });

  test("visualizes root-level sync metrics and elapsed time for active jobs", () => {
    const startedAt = new Date(Date.now() - 2_000).toISOString();
    const result = normalizeControlCenter(null, [
      {
        id: 201,
        name: "sync",
        status: "completed",
        data: { sourceId: "default" },
        result: { status: "ok", added: 4, chunksCreated: 12, pagesAffected: 3 },
        created_at: startedAt,
        started_at: startedAt,
        finished_at: new Date().toISOString(),
      },
      {
        id: 202,
        name: "embed-backfill",
        status: "active",
        data: { sourceId: "default" },
        created_at: startedAt,
        started_at: startedAt,
      },
    ], ["default"]);

    expect(result.jobs.find((job) => job.id === 201)?.run?.impacts).toEqual(expect.arrayContaining([
      { key: "added", label: "추가", value: 4, tone: "good" },
      { key: "chunksCreated", label: "생성 Chunk", value: 12, tone: "good" },
      { key: "pagesAffected", label: "영향받은 페이지", value: 3, tone: "good" },
    ]));
    expect(result.jobs.find((job) => job.id === 202)?.durationMs).toBeGreaterThanOrEqual(1_500);
  });

  test("sanitizes arbitrary metadata and Unix or Windows paths before serialization", () => {
    const result = normalizeControlCenter(statusFixture, [{
      id: 301,
      name: "token=job-secret",
      queue: "password=queue-secret",
      status: "completed",
      data: { sourceId: "default" },
      result: {
        status: "success",
        report: {
          status: "success",
          phases: [{
            phase: "api_key=phase-secret",
            status: "ok",
            summary: "/root/.gbrain/private /srv/gbrain/private C:\\Users\\operator\\private",
          }],
        },
      },
    }], ["default"]);
    const serialized = JSON.stringify(result);

    expect(result.jobs[0]).toMatchObject({ name: "unknown", queue: "default" });
    expect(result.jobs[0]?.run?.phases[0]?.name).toBe("unknown");
    for (const secret of ["job-secret", "queue-secret", "phase-secret", "/root/", "/srv/", "C:\\Users\\operator"]) {
      expect(serialized).not.toContain(secret);
    }
    expect(serialized).toContain("<local-path>");
  });

  test("decodes MCP text results and rejects tool errors or invalid JSON", () => {
    expect(decodeControlToolPayload({
      content: [{ type: "text", text: JSON.stringify({ version: "test" }) }],
    })).toEqual({ version: "test" });
    expect(() => decodeControlToolPayload({ isError: true })).toThrow();
    expect(() => decodeControlToolPayload({
      content: [{ type: "text", text: "not-json" }],
    })).toThrow();
  });
});

describe("ControlCenterService", () => {
  test("returns an explicit setup state when MCP is not configured", async () => {
    const service = new ControlCenterService(
      {
        mcpUrl: null,
        mcpToken: null,
        requestTimeoutMs: 10_000,
        cacheMs: 10_000,
        mutationsEnabled: false,
        actionLedgerPath: null,
      },
      ["default"],
    );

    expect(await service.getOverview()).toMatchObject({
      availability: { configured: false, connected: false },
      sources: [],
      jobs: [],
    });
  });

  test("caches polling reads and rate-limits repeated forced refreshes", async () => {
    const reader = new FixtureReader(controlReadResult());
    const service = new ControlCenterService(controlConfig, ["default"], reader);

    await service.getOverview();
    await service.getOverview();
    expect(reader.calls).toBe(1);

    await service.getOverview(true);
    await service.getOverview(true);
    expect(reader.calls).toBe(2);
  });

  test("builds source/global Dream history and cached-only secure Inspector details", async () => {
    const { current, previous, global } = dreamReadFixture();
    const allowedStatus = {
      ...statusFixture,
      sync: { sources: [statusFixture.sync.sources[0]] },
    };
    const reader = new FixtureReader(controlReadResult({
      status: allowedStatus,
      fullRuns: [previous, current],
      globalRuns: [global],
    }));
    const service = new ControlCenterService(controlConfig, ["default"], reader);

    const overview = await service.getOverview();
    expect(overview.dreamRuns?.map((run) => run.id)).toEqual([601, 502, 501]);
    expect(overview.dreamRuns?.find((run) => run.id === 502)?.phases).toHaveLength(14);
    expect(overview.dreamRuns?.find((run) => run.id === 601)?.phases).toHaveLength(8);
    expect(overview.quality).toEqual({
      status: "fresh",
      recentJobs: "fresh",
      sourceDreamRuns: "fresh",
      globalDreamRuns: "fresh",
    });

    const lookup = service.getDreamRunDetail(502);
    expect(lookup.status).toBe("ok");
    if (lookup.status !== "ok") throw new Error("expected detail");
    expect(lookup.detail.snapshotGeneratedAt).toBe(overview.generatedAt);
    expect(lookup.detail.previousRun?.id).toBe(501);
    expect(lookup.detail.comparison.metrics).toEqual([
      {
        key: "orphans_found",
        label: "고립 페이지",
        current: 2,
        previous: 0,
        delta: 2,
      },
      {
        key: "pages_embedded",
        label: "Embedding 페이지",
        current: 12,
        previous: 10,
        delta: 2,
      },
    ]);
    expect(lookup.detail.comparison.metrics.some((metric) => metric.key === "pages_synced")).toBe(false);
    expect(lookup.detail.findings).toHaveLength(5);
    expect(lookup.detail.findings.map((finding) => finding.kind)).toEqual([
      "failure",
      "warning",
      "remediation",
      "metric",
      "duration",
    ]);
    expect(lookup.detail.affectedPages).toEqual({
      items: [{ sourceId: "default", slug: "projects/alpha", phases: ["sync", "extract"] }],
      total: 1,
      truncated: false,
      coverage: "complete",
    });
    expect(reader.calls).toBe(1);

    const serialized = JSON.stringify(lookup.detail);
    for (const secret of [
      "raw-data-secret",
      "raw-stacktrace-secret",
      "raw-log-secret",
      "raw-warning-secret",
      "raw-error-secret",
      "raw-hint-secret",
      "must-not-be-exposed",
      "/home/operator",
      "/srv/gbrain",
      "private/secret",
    ]) expect(serialized).not.toContain(secret);
  });

  test("extracts only fixed legacy sync and synthesize ref fields without exposing raw report data", () => {
    const legacy = dreamJob({
      id: 710,
      finishedAt: "2026-07-27T03:05:00.000Z",
      phases: [
        dreamPhase("sync", {
          pagesAffected: ["projects/alpha", "projects/alpha"],
          status: "ok",
          details: { dryRun: false, syncStatus: "synced", nested: { pagesAffected: ["must/not/be-recursed"] } },
        }),
        dreamPhase("synthesize", {
          details: {
            pages_written: 1,
            written_slugs: ["wiki/reflection"],
            summary_slug: "dream-cycle-summaries/2026-07-27",
            nested: { written_slugs: ["must/not/be-recursed"] },
          },
        }),
        dreamPhase("patterns", {
          details: { written_slugs: ["must/not/be-inferred"], patterns_written: 1 },
        }),
      ],
    });

    const [entry] = normalizeControlDreamRuns([legacy], ["default"]);
    expect(entry.affectedPages).toEqual({
      items: [
        { sourceId: "default", slug: "dream-cycle-summaries/2026-07-27", phases: ["synthesize"] },
        { sourceId: "default", slug: "projects/alpha", phases: ["sync"] },
        { sourceId: "default", slug: "wiki/reflection", phases: ["synthesize"] },
      ],
      total: 3,
      truncated: false,
      coverage: "partial",
    });
    const serialized = JSON.stringify(entry.affectedPages);
    expect(serialized).not.toContain("must/not");
  });

  test("fails closed for malformed legacy refs and does not downgrade malformed producer aggregates", () => {
    const invalidLegacy = dreamJob({
      id: 713,
      finishedAt: "2026-07-27T06:05:00.000Z",
      phases: [dreamPhase("sync", {
        status: "ok",
        pagesAffected: ["projects/valid", "/home/operator/private", "token=must-not-copy"],
        details: { dryRun: false, syncStatus: "synced" },
      })],
    });
    const malformedProducer = dreamJob({
      id: 714,
      finishedAt: "2026-07-27T07:05:00.000Z",
      phases: [dreamPhase("sync", {
        status: "ok",
        pagesAffected: ["projects/fallback-must-not-run"],
        details: { dryRun: false, syncStatus: "synced" },
      })],
      affectedPages: {
        items: [{ source_id: "private", slug: "projects/foreign", phases: ["sync"] }],
        total: 1,
        truncated: false,
      },
    });

    for (const entry of normalizeControlDreamRuns([invalidLegacy, malformedProducer], ["default"])) {
      expect(entry.affectedPages).toEqual({ items: [], total: 0, truncated: false, coverage: "unavailable" });
      const serialized = JSON.stringify(entry.affectedPages);
      expect(serialized).not.toContain("operator");
      expect(serialized).not.toContain("token=");
      expect(serialized).not.toContain("foreign");
      expect(serialized).not.toContain("fallback-must-not-run");
    }
  });

  test("caps legacy refs at 200 and refuses to bind sourceless global refs", () => {
    const refs = Array.from({ length: 201 }, (_, index) => `topics/page-${String(index).padStart(3, "0")}`);
    const source = dreamJob({
      id: 711,
      finishedAt: "2026-07-27T04:05:00.000Z",
      phases: [dreamPhase("sync", {
        status: "ok",
        pages_affected: refs,
        details: { dry_run: false, sync_status: "synced" },
      })],
    });
    const global = dreamJob({
      id: 712,
      name: "autopilot-global-maintenance",
      sourceId: null,
      finishedAt: "2026-07-27T05:05:00.000Z",
      phases: [dreamPhase("synthesize", { details: { written_slugs: ["topics/global"] } })],
    });
    const nonDefaultSynth = dreamJob({
      id: 715,
      sourceId: "notes",
      finishedAt: "2026-07-27T05:15:00.000Z",
      phases: [dreamPhase("synthesize", {
        status: "ok",
        details: {
          pages_written: 1,
          written_slugs: ["topics/ambiguous-source"],
          summary_slug: "dream-cycle-summaries/2026-07-27",
        },
      })],
    });

    const [sourceEntry] = normalizeControlDreamRuns([source], ["default"]);
    expect(sourceEntry.affectedPages).toMatchObject({ total: 201, truncated: true, coverage: "partial" });
    expect(sourceEntry.affectedPages.items).toHaveLength(200);
    const [globalEntry] = normalizeControlDreamRuns([global], ["default"], true);
    expect(globalEntry.affectedPages).toEqual({ items: [], total: 0, truncated: false, coverage: "unavailable" });
    const [nonDefaultEntry] = normalizeControlDreamRuns([nonDefaultSynth], ["default", "notes"]);
    expect(nonDefaultEntry.affectedPages).toEqual({ items: [], total: 0, truncated: false, coverage: "unavailable" });
  });

  test("retains a failed Dream detail section as stale without disabling overview mutations", async () => {
    const { current, previous, global } = dreamReadFixture();
    const allowedStatus = { ...statusFixture, sync: { sources: [statusFixture.sync.sources[0]] } };
    let result = controlReadResult({
      status: allowedStatus,
      fullRuns: [current, previous],
      globalRuns: [global],
    });
    const reader: ControlReader = { read: async () => result };
    const service = new ControlCenterService({ ...controlConfig, cacheMs: 0 }, ["default"], reader);
    await service.getOverview();

    result = controlReadResult({
      status: allowedStatus,
      fullRuns: null,
      globalRuns: [global],
      partial: true,
    });
    const partial = await service.getOverview();
    expect(partial.availability.message).toBeNull();
    expect(partial.management.enabled).toBe(true);
    expect(partial.quality?.sourceDreamRuns).toBe("stale");
    const retained = service.getDreamRunDetail(502);
    expect(retained.status).toBe("ok");
    if (retained.status === "ok") {
      expect(retained.detail.stale).toBe(true);
      expect(retained.detail.snapshotGeneratedAt).toBe(partial.generatedAt);
    }
  });

  test("isolates malformed Dream detail normalization from overview and management", async () => {
    const malformed = {
      id: 900,
      name: "autopilot-cycle",
      status: "completed",
      data: { source_id: "default" },
      get result(): unknown {
        throw new Error("raw-detail-normalization-secret");
      },
    };
    const reader = new FixtureReader(controlReadResult({ fullRuns: [malformed] }));
    const service = new ControlCenterService(controlConfig, ["default"], reader);
    const errorLog = spyOn(console, "error").mockImplementation(() => undefined);
    const overview = await service.getOverview();
    errorLog.mockRestore();

    expect(overview.availability).toMatchObject({ connected: true, message: null });
    expect(overview.management.enabled).toBe(true);
    expect(overview.quality?.sourceDreamRuns).toBe("unavailable");
    expect(service.getDreamRunDetail(900)).toEqual({ status: "unavailable" });
  });

  test("marks partial MCP reads without discarding safe visual data", async () => {
    const reader = new FixtureReader(controlReadResult({ partial: true }));
    const service = new ControlCenterService(controlConfig, ["default"], reader);

    expect(await service.getOverview()).toMatchObject({
      availability: {
        configured: true,
        connected: true,
        message: "일부 GBrain 운영 데이터를 불러오지 못했습니다.",
      },
      recentJobCounts: { sampleSize: 3 },
    });
  });

  test("merges missing partial sections with the last complete response", async () => {
    let result = controlReadResult();
    const reader: ControlReader = { read: async () => result };
    const service = new ControlCenterService({ ...controlConfig, cacheMs: 0 }, ["default"], reader);
    const initial = await service.getOverview();

    result = controlReadResult({ status: null, recentJobs: null, partial: true });
    const partial = await service.getOverview();

    expect(partial.version).toBe(initial.version);
    expect(partial.sources).toEqual(initial.sources);
    expect(partial.jobs.map((job) => job.id)).toEqual(initial.jobs.map((job) => job.id));
    expect(partial.availability.message).toBe("일부 GBrain 운영 데이터를 불러오지 못했습니다.");
  });

  test("rate-limits forced retries even before a successful snapshot exists", async () => {
    let calls = 0;
    const reader: ControlReader = {
      async read() {
        calls += 1;
        throw new Error("simulated outage");
      },
    };
    const service = new ControlCenterService(controlConfig, ["default"], reader);
    const errorLog = spyOn(console, "error").mockImplementation(() => undefined);
    await service.getOverview(true);
    const limited = await service.getOverview(true);
    errorLog.mockRestore();

    expect(calls).toBe(1);
    expect(limited.availability.message).toContain("갱신 요청이 너무 잦습니다");
  });

  test("serves the last safe snapshot when a later refresh fails", async () => {
    let shouldFail = false;
    const reader: ControlReader = {
      async read() {
        if (shouldFail) throw new Error("Bearer secret-token connection failed");
        return controlReadResult();
      },
    };
    const service = new ControlCenterService({ ...controlConfig, cacheMs: 0 }, ["default"], reader);
    const initial = await service.getOverview();
    shouldFail = true;
    const errorLog = spyOn(console, "error").mockImplementation(() => undefined);
    const stale = await service.getOverview();
    errorLog.mockRestore();

    expect(stale.availability).toMatchObject({ configured: true, connected: false });
    expect(stale.generatedAt).toBe(initial.generatedAt);
    expect(stale.jobs).toHaveLength(3);
  });

  test("does not let a pre-invalidation request overwrite the new cache generation", async () => {
    const resolvers: Array<(value: ControlReadResult) => void> = [];
    const reader: ControlReader = {
      read: () => new Promise<ControlReadResult>((resolve) => { resolvers.push(resolve); }),
    };
    const service = new ControlCenterService({ ...controlConfig, cacheMs: 60_000 }, ["default"], reader);

    const oldRequest = service.getOverview();
    service.invalidate();
    const newRequest = service.getOverview();
    resolvers[1]!(controlReadResult({ status: { ...statusFixture, version: "new-generation" } }));
    const fresh = await newRequest;
    resolvers[0]!(controlReadResult({ status: { ...statusFixture, version: "old-generation" } }));
    await oldRequest;

    expect(fresh.version).toBe("new-generation");
    expect((await service.getOverview()).version).toBe("new-generation");
    expect(resolvers).toHaveLength(2);
  });
});
