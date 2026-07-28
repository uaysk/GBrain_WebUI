import { describe, expect, test } from "bun:test";
import {
  DEFAULT_CONTROL_JOB_FILTERS,
  filterControlJobs,
  parseControlJobFilters,
  serializeControlJobFilters,
} from "../src/components/control/ControlJobFilters";
import type { ControlJob } from "../src/types";

function job(overrides: Partial<ControlJob>): ControlJob {
  return {
    id: 1,
    name: "sync",
    label: "소스 동기화",
    queue: "default",
    status: "completed",
    sourceId: "default",
    createdAt: "2026-07-26T10:00:00.000Z",
    startedAt: "2026-07-26T10:00:00.000Z",
    finishedAt: "2026-07-26T10:01:00.000Z",
    durationMs: 60_000,
    attemptsMade: 1,
    maxAttempts: 3,
    error: null,
    progress: null,
    run: null,
    ...overrides,
  };
}

describe("Control Center job filters", () => {
  test("combines source, failure, date, and UI-origin predicates", () => {
    const jobs = [
      job({ id: 1, status: "failed", sourceId: "default" }),
      job({ id: 2, status: "failed", sourceId: "notes" }),
      job({ id: 3, status: "completed", sourceId: "default" }),
    ];
    const filtered = filterControlJobs(jobs, {
      ...DEFAULT_CONTROL_JOB_FILTERS,
      sourceId: "default",
      failedOnly: true,
      uiLaunchedOnly: true,
      dateRange: "24h",
    }, [1, 3], Date.parse("2026-07-26T12:00:00.000Z"));

    expect(filtered.map((item) => item.id)).toEqual([1]);
  });

  test("round-trips known filters while preserving unrelated URL state", () => {
    const value = {
      ...DEFAULT_CONTROL_JOB_FILTERS,
      sourceId: "notes",
      status: "active" as const,
      jobType: "embed",
      dateRange: "7d" as const,
      uiLaunchedOnly: true,
    };
    const params = serializeControlJobFilters(value, new URLSearchParams("surface=control"));

    expect(params.get("surface")).toBe("control");
    expect(parseControlJobFilters(params)).toEqual(value);
  });
});
