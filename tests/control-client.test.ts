import { describe, expect, test } from "bun:test";
import { parseControlCenterResponse } from "../src/api/control-validation";
import { LatestRequestCoordinator } from "../src/hooks/latest-request";
import { normalizeControlCenter } from "../server/control-center";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((nextResolve, nextReject) => {
    resolve = nextResolve;
    reject = nextReject;
  });
  return { promise, resolve, reject };
}

describe("Control Center client request ordering", () => {
  test("applies only the latest response when polling requests finish in reverse order", async () => {
    const coordinator = new LatestRequestCoordinator<string>();
    const first = deferred<string>();
    const second = deferred<string>();
    const firstRun = coordinator.run(false, () => first.promise);
    const secondRun = coordinator.run(false, () => second.promise);

    second.resolve("fresh");
    expect(await secondRun).toEqual({ applied: true, value: "fresh" });
    first.resolve("stale");
    expect(await firstRun).toEqual({ applied: false, reason: "superseded" });
  });

  test("a forced refresh aborts the previous request", async () => {
    const coordinator = new LatestRequestCoordinator<string>();
    let previousSignal: AbortSignal | null = null;
    const firstRun = coordinator.run(false, (signal) => {
      previousSignal = signal;
      return new Promise<string>((_resolve, reject) => {
        signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true });
      });
    });
    const forced = coordinator.run(true, async () => "forced");
    expect(previousSignal!.aborted).toBe(true);
    expect(await firstRun).toEqual({ applied: false, reason: "aborted" });
    expect(await forced).toEqual({ applied: true, value: "forced" });
  });
});

describe("Control Center network validation", () => {
  test("maps newly introduced server statuses to unknown", () => {
    const payload = normalizeControlCenter({}, [{
      id: 1,
      name: "future-job",
      status: "completed",
      created_at: "2026-07-31T00:00:00.000Z",
    }]);
    (payload.jobs[0] as { status: string }).status = "future-running-state";
    expect(parseControlCenterResponse(payload).jobs[0]?.status).toBe("unknown");
  });

  test("rejects malformed numeric state before it reaches the UI", () => {
    const payload = normalizeControlCenter({ sync: { sources: [{ source_id: "default" }] } }, []);
    (payload.sources[0] as { pages: unknown }).pages = Number.NaN;
    expect(() => parseControlCenterResponse(payload)).toThrow();
  });
});
