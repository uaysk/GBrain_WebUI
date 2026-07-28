import { afterEach, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, readdir, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  ControlActionError,
  ControlActionService,
  parseControlActionIdempotencyKey,
  parseControlActionRequest,
  type ControlActionConnector,
} from "../server/control-actions";
import type { Config } from "../server/config";

type ToolCall = { name: string; args: Record<string, unknown> };

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

async function ledgerPath(): Promise<{ directory: string; path: string }> {
  const directory = await mkdtemp(join(tmpdir(), "gbrain-control-actions-"));
  temporaryDirectories.push(directory);
  return { directory, path: join(directory, "actions.json") };
}

function config(path: string | null): Config["controlCenter"] & {
  mutationsEnabled: boolean;
  actionLedgerPath: string | null;
} {
  return {
    mcpUrl: "https://gbrain.example.test/mcp",
    mcpToken: "server-only-token",
    requestTimeoutMs: 10_000,
    cacheMs: 10_000,
    mutationsEnabled: true,
    actionLedgerPath: path,
  };
}

function source(id: string, remoteUrl: string | null = "https://git.example.test/brain.git") {
  return {
    id,
    name: id,
    remote_url: remoteUrl,
    local_path: `/private/${id}`,
    page_count: 10,
  };
}

function sourceStatus(id: string, remoteUrl: string | null = "https://git.example.test/brain.git") {
  return {
    id,
    name: id,
    archived: false,
    remote_url: remoteUrl,
    local_path: `/private/${id}`,
    clone_state: "healthy",
  };
}

function syncData(id: string, noPull = false): Record<string, unknown> {
  return {
    sourceId: id,
    noPull,
    noEmbed: true,
    noExtract: true,
    auto_embed_backfill: true,
    embed_reason: "webui_manual",
  };
}

function embedData(id: string): Record<string, unknown> {
  return { sourceId: id, stale: true };
}

class FakeConnector implements ControlActionConnector {
  calls: ToolCall[] = [];
  jobs = new Map<number, Record<string, unknown>>();
  nextJobId = 100;
  sources = [source("default"), source("secondary", null)];
  statuses = new Map([
    ["default", sourceStatus("default")],
    ["secondary", sourceStatus("secondary", null)],
  ]);
  recentJobs: unknown[] = [];
  beforeMutation?: (name: string, args: Record<string, unknown>) => Promise<void>;
  failMutation = false;
  holdMutation: Promise<void> | null = null;

  async callTool(name: Parameters<ControlActionConnector["callTool"]>[0], args: Record<string, unknown>): Promise<unknown> {
    this.calls.push({ name, args: structuredClone(args) });
    if (name === "sources_list") return { sources: this.sources };
    if (name === "sources_status") return this.statuses.get(String(args.id)) ?? {};
    if (name === "get_status_snapshot") {
      return {
        version: "0.42.58.0",
        sync: {
          sources: this.sources.map((entry) => ({
            source_id: entry.id,
            sync_enabled: true,
          })),
        },
      };
    }
    if (name === "list_jobs") return this.recentJobs;
    if (name === "get_job") return this.jobs.get(Number(args.id)) ?? {};
    await this.beforeMutation?.(name, args);
    if (this.holdMutation) await this.holdMutation;
    if (this.failMutation) throw new Error("token=secret /private/path");

    if (name === "submit_job") {
      const id = this.nextJobId++;
      const job = {
        id,
        name: args.name,
        queue: args.queue,
        priority: args.priority,
        max_attempts: args.max_attempts,
        timeout_ms: args.timeout_ms,
        status: "waiting",
        data: structuredClone(args.data),
        created_at: "2026-07-26T01:00:00.000Z",
        lock_token: "must-not-leak",
      };
      this.jobs.set(id, job);
      return job;
    }
    if (name === "retry_job") {
      const job = this.jobs.get(Number(args.id))!;
      job.status = "waiting";
      return job;
    }
    if (name === "cancel_job") {
      const job = this.jobs.get(Number(args.id))!;
      job.status = "cancelled";
      return job;
    }
    throw new Error(`unexpected tool ${name}`);
  }
}

function idempotencyKey(suffix: string): string {
  const hex = createHash("sha256").update(suffix).digest("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

async function expectControlError(
  promise: Promise<unknown> | (() => unknown),
  status: number,
  code: string,
): Promise<void> {
  try {
    if (typeof promise === "function") promise();
    else await promise;
    throw new Error("expected ControlActionError");
  } catch (error) {
    expect(error).toBeInstanceOf(ControlActionError);
    expect((error as ControlActionError).status).toBe(status);
    expect((error as ControlActionError).code).toBe(code);
  }
}

describe("strict control action parsing", () => {
  test("accepts only exact action-specific bodies and confirmations", () => {
    expect(parseControlActionRequest(JSON.stringify({
      action: "quick-dream",
      sourceId: "default",
      confirmation: "RUN default",
    }))).toEqual({
      action: "quick-dream",
      sourceId: "default",
      confirmation: "RUN default",
    });
    expect(parseControlActionRequest(JSON.stringify({
      action: "source-sync",
      sourceId: "default",
      confirmation: "SYNC default",
    })).action).toBe("source-sync");
    expect(parseControlActionRequest(JSON.stringify({
      action: "embedding-refresh",
      sourceId: "default",
      confirmation: "EMBED default",
    })).action).toBe("embedding-refresh");
    expect(parseControlActionRequest(JSON.stringify({
      action: "job-retry",
      jobId: 42,
      expectedStatus: "failed",
      confirmation: "RETRY #42",
    })).action).toBe("job-retry");
    expect(parseControlActionRequest(JSON.stringify({
      action: "job-cancel",
      jobId: 42,
      expectedStatus: "delayed",
      confirmation: "CANCEL #42",
    })).action).toBe("job-cancel");
  });

  test("rejects malformed JSON, extra arguments, stale status classes, and near-match confirmations", async () => {
    await expectControlError(() => parseControlActionRequest("{"), 400, "invalid_json");
    await expectControlError(() => parseControlActionRequest(JSON.stringify({
      action: "source-sync",
      sourceId: "default",
      confirmation: "SYNC default",
      repoPath: "/etc",
    })), 400, "invalid_request");
    await expectControlError(() => parseControlActionRequest(JSON.stringify({
      action: "job-cancel",
      jobId: 2,
      expectedStatus: "active",
      confirmation: "CANCEL #2",
    })), 400, "invalid_expected_status");
    await expectControlError(() => parseControlActionRequest(JSON.stringify({
      action: "quick-dream",
      sourceId: "default",
      confirmation: "run default",
    })), 400, "invalid_confirmation");
    await expectControlError(() => parseControlActionIdempotencyKey("short"), 400, "invalid_idempotency_key");
  });
});

describe("fixed GBrain action plans", () => {
  test("submits quick Dream with only the three fixed phases and pull disabled", async () => {
    const { path } = await ledgerPath();
    const connector = new FakeConnector();
    const service = new ControlActionService(config(path), ["default", "secondary"], connector);

    const result = await service.execute({
      action: "quick-dream",
      sourceId: "default",
      confirmation: "RUN default",
    }, idempotencyKey("dream"));

    const mutation = connector.calls.find((call) => call.name === "submit_job");
    expect(mutation?.args).toEqual({
      name: "autopilot-cycle",
      data: {
        source_id: "default",
        phases: ["sync", "extract", "embed"],
        pull: false,
      },
      queue: "default",
      priority: 0,
      max_attempts: 2,
      timeout_ms: 600_000,
    });
    expect(connector.calls).toContainEqual({ name: "sources_list", args: { include_archived: true } });
    expect(connector.calls).toContainEqual({ name: "sources_status", args: { id: "default" } });
    expect(connector.calls).toContainEqual({ name: "get_status_snapshot", args: {} });
    for (const status of ["waiting", "waiting-children", "paused", "active", "delayed"]) {
      expect(connector.calls).toContainEqual({ name: "list_jobs", args: { status, limit: 500 } });
    }
    expect(result).toMatchObject({
      action: "quick-dream",
      outcome: "accepted",
      replayed: false,
      job: { id: 100, name: "autopilot-cycle", sourceId: "default", status: "waiting" },
    });
    expect(JSON.stringify(result)).not.toContain("lock_token");
    expect(JSON.stringify(result)).not.toContain("/private");
  });

  test("derives sync noPull from remote_url and fixes all other sync switches", async () => {
    const remote = new FakeConnector();
    const remoteService = new ControlActionService(config(null), ["default", "secondary"], remote);
    await remoteService.execute({
      action: "source-sync",
      sourceId: "default",
      confirmation: "SYNC default",
    }, idempotencyKey("remote-sync"));
    expect(remote.calls.find((call) => call.name === "submit_job")?.args).toEqual({
      name: "sync",
      data: syncData("default", false),
      queue: "default",
      priority: 0,
      max_attempts: 2,
      timeout_ms: 600_000,
    });

    const local = new FakeConnector();
    const localService = new ControlActionService(config(null), ["default", "secondary"], local);
    await localService.execute({
      action: "source-sync",
      sourceId: "secondary",
      confirmation: "SYNC secondary",
    }, idempotencyKey("local-sync"));
    expect(local.calls.find((call) => call.name === "submit_job")?.args).toEqual({
      name: "sync",
      data: syncData("secondary", true),
      queue: "default",
      priority: 0,
      max_attempts: 2,
      timeout_ms: 600_000,
    });
  });

  test("submits embedding refresh in stale-only mode", async () => {
    const connector = new FakeConnector();
    const service = new ControlActionService(config(null), ["default"], connector);
    await service.execute({
      action: "embedding-refresh",
      sourceId: "default",
      confirmation: "EMBED default",
    }, idempotencyKey("embed"));

    expect(connector.calls.find((call) => call.name === "submit_job")?.args).toEqual({
      name: "embed",
      data: embedData("default"),
      queue: "default",
      priority: 5,
      max_attempts: 3,
      timeout_ms: 1_800_000,
    });
  });

  test("fails closed for disallowed, archived, unsyncable, and busy sources", async () => {
    const disallowed = new FakeConnector();
    const disallowedService = new ControlActionService(config(null), ["default"], disallowed);
    await expectControlError(disallowedService.execute({
      action: "embedding-refresh",
      sourceId: "secondary",
      confirmation: "EMBED secondary",
    }, idempotencyKey("disallowed")), 403, "source_not_allowed");
    expect(disallowed.calls).toHaveLength(0);

    const archived = new FakeConnector();
    archived.statuses.set("default", { ...sourceStatus("default"), archived: true });
    const archivedService = new ControlActionService(config(null), ["default"], archived);
    await expectControlError(archivedService.execute({
      action: "quick-dream",
      sourceId: "default",
      confirmation: "RUN default",
    }, idempotencyKey("archived")), 409, "source_unavailable");

    const broken = new FakeConnector();
    broken.statuses.set("default", { ...sourceStatus("default"), clone_state: "corrupted" });
    const brokenService = new ControlActionService(config(null), ["default"], broken);
    await expectControlError(brokenService.execute({
      action: "source-sync",
      sourceId: "default",
      confirmation: "SYNC default",
    }, idempotencyKey("broken")), 409, "source_not_syncable");

    const busy = new FakeConnector();
    busy.recentJobs = [{
      id: 9,
      name: "embed",
      status: "active",
      data: embedData("default"),
    }];
    const busyService = new ControlActionService(config(null), ["default"], busy);
    await expectControlError(busyService.execute({
      action: "embedding-refresh",
      sourceId: "default",
      confirmation: "EMBED default",
    }, idempotencyKey("busy")), 409, "source_busy");
    expect(busy.calls.some((call) => call.name === "submit_job")).toBe(false);
  });
});

describe("safe job retry and cancellation", () => {
  test("retries only a current failed/dead sync or stale embed job", async () => {
    const connector = new FakeConnector();
    connector.jobs.set(21, {
      id: 21,
      name: "sync",
      queue: "default",
      priority: 0,
      max_attempts: 2,
      timeout_ms: 600_000,
      status: "failed",
      data: syncData("default", false),
      created_at: "2026-07-26T01:00:00.000Z",
    });
    const service = new ControlActionService(config(null), ["default"], connector);

    const result = await service.execute({
      action: "job-retry",
      jobId: 21,
      expectedStatus: "failed",
      confirmation: "RETRY #21",
    }, idempotencyKey("retry"));

    expect(connector.calls).toContainEqual({ name: "get_job", args: { id: 21 } });
    expect(connector.calls).toContainEqual({ name: "retry_job", args: { id: 21 } });
    expect(result).toMatchObject({
      outcome: "accepted",
      job: { id: 21, name: "sync", status: "waiting", sourceId: "default" },
    });
  });

  test("cancels only waiting/delayed fixed jobs", async () => {
    const connector = new FakeConnector();
    connector.jobs.set(22, {
      id: 22,
      name: "embed",
      queue: "default",
      priority: 5,
      max_attempts: 3,
      timeout_ms: 1_800_000,
      status: "delayed",
      data: embedData("default"),
      created_at: "2026-07-26T01:00:00.000Z",
    });
    const service = new ControlActionService(config(null), ["default"], connector);

    const result = await service.execute({
      action: "job-cancel",
      jobId: 22,
      expectedStatus: "delayed",
      confirmation: "CANCEL #22",
    }, idempotencyKey("cancel"));
    expect(connector.calls).toContainEqual({ name: "cancel_job", args: { id: 22 } });
    expect(result.job?.status).toBe("cancelled");
  });

  test("cancels a waiting Quick Dream only when it matches the fixed safe plan", async () => {
    const connector = new FakeConnector();
    connector.jobs.set(23, {
      id: 23,
      name: "autopilot-cycle",
      queue: "default",
      priority: 0,
      max_attempts: 2,
      timeout_ms: 600_000,
      status: "waiting",
      data: {
        source_id: "default",
        phases: ["sync", "extract", "embed"],
        pull: false,
      },
      created_at: "2026-07-26T01:00:00.000Z",
    });
    const service = new ControlActionService(config(null), ["default"], connector);

    const result = await service.execute({
      action: "job-cancel",
      jobId: 23,
      expectedStatus: "waiting",
      confirmation: "CANCEL #23",
    }, idempotencyKey("cancel-dream"));

    expect(connector.calls).toContainEqual({ name: "cancel_job", args: { id: 23 } });
    expect(result.job).toMatchObject({ id: 23, name: "autopilot-cycle", status: "cancelled" });
  });

  test("rejects stale UI state and arbitrary or widened stored payloads before mutation", async () => {
    const stale = new FakeConnector();
    stale.jobs.set(30, {
      id: 30,
      name: "embed",
      queue: "default",
      priority: 5,
      max_attempts: 3,
      timeout_ms: 1_800_000,
      status: "dead",
      data: embedData("default"),
      created_at: "2026-07-26T01:00:00.000Z",
    });
    const staleService = new ControlActionService(config(null), ["default"], stale);
    await expectControlError(staleService.execute({
      action: "job-retry",
      jobId: 30,
      expectedStatus: "failed",
      confirmation: "RETRY #30",
    }, idempotencyKey("stale")), 409, "stale_job_status");

    const unsafe = new FakeConnector();
    unsafe.jobs.set(31, {
      id: 31,
      name: "sync",
      queue: "default",
      priority: 0,
      max_attempts: 2,
      timeout_ms: 600_000,
      status: "failed",
      data: { ...syncData("default", false), repoPath: "/etc" },
      created_at: "2026-07-26T01:00:00.000Z",
    });
    const unsafeService = new ControlActionService(config(null), ["default"], unsafe);
    await expectControlError(unsafeService.execute({
      action: "job-retry",
      jobId: 31,
      expectedStatus: "failed",
      confirmation: "RETRY #31",
    }, idempotencyKey("unsafe")), 409, "unsafe_job_payload");
    expect(unsafe.calls.some((call) => call.name === "retry_job")).toBe(false);

    const widened = new FakeConnector();
    widened.jobs.set(32, {
      id: 32,
      name: "embed",
      queue: "default",
      priority: 5,
      max_attempts: 3,
      timeout_ms: 1_800_000,
      status: "failed",
      data: { sourceId: "default", stale: false },
      created_at: "2026-07-26T01:00:00.000Z",
    });
    const widenedService = new ControlActionService(config(null), ["default"], widened);
    await expectControlError(widenedService.execute({
      action: "job-retry",
      jobId: 32,
      expectedStatus: "failed",
      confirmation: "RETRY #32",
    }, idempotencyKey("widened")), 409, "unsafe_job_payload");
  });
});

describe("durable idempotency and concurrency", () => {
  test("writes a mode-0600 atomic ledger and replays the same key/body for 24 hours", async () => {
    const { directory, path } = await ledgerPath();
    const connector = new FakeConnector();
    const service = new ControlActionService(config(path), ["default"], connector);
    const request = {
      action: "embedding-refresh" as const,
      sourceId: "default",
      confirmation: "EMBED default",
    };
    const key = idempotencyKey("replay");

    const first = await service.execute(request, key, "actor-hash-123456");
    const replay = await service.execute(request, key, "actor-hash-123456");

    expect(first.replayed).toBe(false);
    expect(replay).toEqual({ ...first, replayed: true });
    expect(connector.calls.filter((call) => call.name === "submit_job")).toHaveLength(1);
    expect((await stat(path)).mode & 0o777).toBe(0o600);
    expect((await readdir(directory)).filter((name) => name.endsWith(".tmp"))).toEqual([]);
    const ledger = JSON.parse(await readFile(path, "utf8"));
    expect(ledger.records).toHaveLength(1);
    expect(ledger.records[0]).toMatchObject({
      idempotencyKey: key,
      actorHash: "actor-hash-123456",
      result: { outcome: "accepted", replayed: false },
    });
    expect(JSON.stringify(ledger)).not.toContain("server-only-token");
    expect(JSON.stringify(ledger)).not.toContain("/private");
  });

  test("returns 409 when the same key is reused for a different body", async () => {
    const { path } = await ledgerPath();
    const connector = new FakeConnector();
    const service = new ControlActionService(config(path), ["default", "secondary"], connector);
    const key = idempotencyKey("conflict");
    await service.execute({
      action: "embedding-refresh",
      sourceId: "default",
      confirmation: "EMBED default",
    }, key);
    await expectControlError(service.execute({
      action: "embedding-refresh",
      sourceId: "secondary",
      confirmation: "EMBED secondary",
    }, key), 409, "idempotency_conflict");
    expect(connector.calls.filter((call) => call.name === "submit_job")).toHaveLength(1);
  });

  test("persists pending-verification before mutation and never auto-retries an ambiguous call", async () => {
    const { path } = await ledgerPath();
    const connector = new FakeConnector();
    connector.failMutation = true;
    connector.beforeMutation = async () => {
      const ledger = JSON.parse(await readFile(path, "utf8"));
      expect(ledger.records[0].result.outcome).toBe("pending-verification");
    };
    const key = idempotencyKey("pending");
    const request = {
      action: "quick-dream" as const,
      sourceId: "default",
      confirmation: "RUN default",
    };
    const service = new ControlActionService(config(path), ["default"], connector);
    const result = await service.execute(request, key);
    expect(result).toMatchObject({ outcome: "pending-verification", replayed: false, job: null });

    const replacement = new FakeConnector();
    const restartedService = new ControlActionService(config(path), ["default"], replacement);
    const replay = await restartedService.execute(request, key);
    expect(replay).toMatchObject({ outcome: "pending-verification", replayed: true });
    expect(replacement.calls).toHaveLength(0);
  });

  test("serializes a target in memory and applies an action-target cooldown", async () => {
    const connector = new FakeConnector();
    let release!: () => void;
    connector.holdMutation = new Promise<void>((resolve) => {
      release = resolve;
    });
    const service = new ControlActionService(config(null), ["default"], connector, { cooldownMs: 30_000 });
    const first = service.execute({
      action: "embedding-refresh",
      sourceId: "default",
      confirmation: "EMBED default",
    }, idempotencyKey("mutex-one"));
    while (!connector.calls.some((call) => call.name === "submit_job")) await Bun.sleep(1);

    await expectControlError(service.execute({
      action: "quick-dream",
      sourceId: "default",
      confirmation: "RUN default",
    }, idempotencyKey("mutex-two")), 409, "action_in_progress");
    release();
    await first;

    await expectControlError(service.execute({
      action: "embedding-refresh",
      sourceId: "default",
      confirmation: "EMBED default",
    }, idempotencyKey("cooldown")), 429, "action_cooldown");
  });

  test("fails closed when the persistent ledger is corrupt", async () => {
    const { path } = await ledgerPath();
    await Bun.write(path, "{\"version\":1,\"records\":[{\"token\":\"secret\"}]}");
    const connector = new FakeConnector();
    const service = new ControlActionService(config(path), ["default"], connector);
    await expectControlError(service.execute({
      action: "embedding-refresh",
      sourceId: "default",
      confirmation: "EMBED default",
    }, idempotencyKey("corrupt")), 503, "ledger_corrupt");
    expect(connector.calls).toHaveLength(0);
  });

  test("honors the mutation kill switch before any GBrain call", async () => {
    const connector = new FakeConnector();
    const disabled = { ...config(null), mutationsEnabled: false };
    const service = new ControlActionService(disabled, ["default"], connector);
    await expectControlError(service.execute({
      action: "quick-dream",
      sourceId: "default",
      confirmation: "RUN default",
    }, idempotencyKey("disabled")), 403, "management_disabled");
    expect(connector.calls).toHaveLength(0);
  });
});
