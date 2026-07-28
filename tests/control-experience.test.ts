import { describe, expect, test } from "bun:test";
import {
  appendTrendSnapshot,
  parseStoredActivity,
  parseStoredTrendPoints,
} from "../src/hooks/useControlExperience";
import { controlActionRecoveryFor } from "../src/hooks/useControlActions";
import type { ControlCenterResponse } from "../src/types";

function snapshot(at: string, pages = 10, unembedded = 4): ControlCenterResponse {
  return {
    generatedAt: at,
    availability: { configured: true, connected: true, message: null },
    management: { enabled: true, confirmationRequired: true },
    version: "test",
    sources: [{
      id: "default",
      name: "Primary",
      syncEnabled: true,
      lastSyncAt: at,
      stalenessHours: 0,
      stalenessClass: "fresh",
      pages,
      chunksTotal: 20,
      chunksUnembedded: unembedded,
      embeddingCoveragePct: ((20 - unembedded) / 20) * 100,
      backfillQueued: 0,
      backfillActive: 0,
    }],
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
}

describe("Control Center browser experience state", () => {
  test("keeps only normalized action receipt and metric fields", () => {
    const parsed = parseStoredActivity([{
      id: "action-1",
      recordedAt: "2026-07-26T10:00:00.000Z",
      sourceId: "default",
      result: {
        actionId: "action-1",
        action: "source-sync",
        outcome: "accepted",
        replayed: false,
        message: "동기화가 접수되었습니다.",
        generatedAt: "2026-07-26T10:00:00.000Z",
        secret: "must-not-copy",
        job: {
          id: 42,
          name: "sync",
          label: "소스 동기화",
          status: "waiting",
          sourceId: "default",
          createdAt: "2026-07-26T10:00:00.000Z",
          payload: { token: "must-not-copy" },
        },
      },
      before: {
        sourceId: "default",
        sourceName: "Primary",
        capturedAt: "2026-07-26T09:59:00.000Z",
        pages: 10,
        chunksTotal: 20,
        chunksUnembedded: 4,
        embeddingCoveragePct: 80,
        lastSyncAt: "2026-07-26T09:00:00.000Z",
        raw: "must-not-copy",
      },
      after: null,
      observedJobStatus: "waiting",
      extra: "must-not-copy",
    }]);

    expect(parsed).toHaveLength(1);
    expect(parsed[0].result.job).toMatchObject({ id: 42, status: "waiting" });
    expect(JSON.stringify(parsed)).not.toContain("must-not-copy");
  });

  test("adds changed snapshots, suppresses identical polling noise, and adds hourly heartbeats", () => {
    const first = appendTrendSnapshot([], snapshot("2026-07-26T10:00:00.000Z"), Date.parse("2026-07-26T10:00:00.000Z"));
    const duplicate = appendTrendSnapshot(first, snapshot("2026-07-26T10:10:00.000Z"), Date.parse("2026-07-26T10:10:00.000Z"));
    const changed = appendTrendSnapshot(duplicate, snapshot("2026-07-26T10:20:00.000Z", 11), Date.parse("2026-07-26T10:20:00.000Z"));
    const heartbeat = appendTrendSnapshot(changed, snapshot("2026-07-26T11:20:00.000Z", 11), Date.parse("2026-07-26T11:20:00.000Z"));

    expect(first).toHaveLength(1);
    expect(duplicate).toHaveLength(1);
    expect(changed).toHaveLength(2);
    expect(heartbeat).toHaveLength(3);
  });

  test("rejects malformed trend records", () => {
    const parsed = parseStoredTrendPoints([
      { at: new Date().toISOString(), sourceId: "default", pages: 1, chunksTotal: 2, chunksUnembedded: 0, embeddingCoveragePct: 100 },
      { at: "invalid", sourceId: "default", pages: 1, chunksTotal: 2, chunksUnembedded: 0, embeddingCoveragePct: 100 },
      { at: new Date().toISOString(), sourceId: "default", pages: "1", chunksTotal: 2, chunksUnembedded: 0, embeddingCoveragePct: 100 },
    ]);
    expect(parsed).toHaveLength(1);
  });

  test("maps server action errors to an explicit recovery path", () => {
    expect(controlActionRecoveryFor("stale_job_status", 409)).toMatchObject({
      recoveryAction: "refresh",
      recoveryLabel: "최신 상태로 갱신",
    });
    expect(controlActionRecoveryFor("source_busy", 409)).toMatchObject({
      recoveryAction: "inspect-jobs",
    });
    expect(controlActionRecoveryFor("action_cooldown", 429)).toMatchObject({
      recoveryAction: "wait",
    });
    expect(controlActionRecoveryFor("invalid_csrf", 403)).toMatchObject({
      recoveryAction: "reauthenticate",
    });
  });
});
