import type {
  ControlCenterQuality,
  ControlCenterResponse,
  ControlDreamRunDetail,
  ControlSectionFreshness,
} from "../shared/contracts";
import type { Config } from "./config";
import { McpControlReader, type ControlReader } from "./control-reader";
import {
  buildControlDreamDetails,
  controlAllSourcesVisible,
  DREAM_JOB_NAMES,
  normalizeControlCenter,
  normalizeControlDreamRuns,
  unavailableControlResponse,
} from "./control-normalizer";

export {
  normalizeControlCenter,
  normalizeControlDreamRuns,
  normalizeControlJob,
  normalizeControlPhase,
  normalizeControlProgress,
  normalizeControlRun,
  normalizeControlSource,
} from "./control-normalizer";
export { decodeControlToolPayload } from "./control-reader";
export type { ControlReadResult, ControlReader } from "./control-reader";

function safeServerError(error: unknown): string {
  return (error instanceof Error ? error.message : "Unknown error")
    .replace(/Bearer\s+\S+/gi, "Bearer <redacted>")
    .replace(/postgres(?:ql)?:\/\/[^\s]+/gi, "<redacted-database-url>")
    .slice(0, 600);
}

export interface ControlPollingBundle {
  overview: ControlCenterResponse;
  detailByJobId: ReadonlyMap<number, ControlDreamRunDetail>;
  quality: ControlCenterQuality;
}

export type ControlDreamRunLookup =
  | { status: "ok"; detail: ControlDreamRunDetail }
  | { status: "not-found" }
  | { status: "unavailable" };

function priorFreshness(
  value: unknown[] | null,
  previous: ControlSectionFreshness | undefined,
): ControlSectionFreshness {
  if (value !== null) return "fresh";
  return previous && previous !== "unavailable" ? "stale" : "unavailable";
}

function priorStatusFreshness(
  value: unknown | null,
  previous: ControlSectionFreshness | undefined,
): ControlSectionFreshness {
  if (value !== null) return "fresh";
  return previous && previous !== "unavailable" ? "stale" : "unavailable";
}

function detailName(detail: ControlDreamRunDetail): string {
  return detail.run.name;
}

function retainedDetails(
  previous: ControlPollingBundle | null,
  name: string,
  snapshotGeneratedAt: string,
): Map<number, ControlDreamRunDetail> {
  const retained = new Map<number, ControlDreamRunDetail>();
  for (const [jobId, detail] of previous?.detailByJobId ?? []) {
    if (detailName(detail) !== name) continue;
    retained.set(jobId, { ...detail, snapshotGeneratedAt, stale: true });
  }
  return retained;
}

function mergeDetails(...maps: ReadonlyMap<number, ControlDreamRunDetail>[]): Map<number, ControlDreamRunDetail> {
  const merged = new Map<number, ControlDreamRunDetail>();
  for (const map of maps) for (const [jobId, detail] of map) merged.set(jobId, detail);
  return merged;
}

export class ControlCenterService {
  private cached: { at: number; value: ControlPollingBundle } | null = null;
  private inFlight: { generation: number; promise: Promise<ControlPollingBundle> } | null = null;
  private generation = 0;
  private lastForcedAt = 0;
  private readonly reader: ControlReader | null;

  constructor(
    private readonly config: Config["controlCenter"],
    private readonly allowedSourceIds: readonly string[],
    reader?: ControlReader,
  ) {
    this.reader = reader ?? (config.mcpUrl && config.mcpToken
      ? new McpControlReader(config.mcpUrl, config.mcpToken, config.requestTimeoutMs)
      : null);
  }

  invalidate(): void {
    this.generation += 1;
    this.cached = null;
  }

  async close(): Promise<void> {
    await this.reader?.close?.();
  }

  async getOverview(force = false): Promise<ControlCenterResponse> {
    if (!this.reader) {
      return unavailableControlResponse(false, "GBrain Control MCP 연결이 설정되지 않았습니다.");
    }
    const generation = this.generation;
    if (this.inFlight?.generation === generation) return (await this.inFlight.promise).overview;
    if (!force && this.cached && Date.now() - this.cached.at < this.config.cacheMs) return this.cached.value.overview;
    if (force && Date.now() - this.lastForcedAt < 5_000) {
      return this.cached?.value.overview
        ?? unavailableControlResponse(true, "갱신 요청이 너무 잦습니다. 잠시 후 다시 시도하세요.");
    }
    if (force) this.lastForcedAt = Date.now();
    const promise = this.load(generation).finally(() => {
      if (this.inFlight?.promise === promise) this.inFlight = null;
    });
    this.inFlight = { generation, promise };
    return (await promise).overview;
  }

  getDreamRunDetail(jobId: number): ControlDreamRunLookup {
    if (!this.reader || !this.cached) return { status: "unavailable" };
    const detail = this.cached.value.detailByJobId.get(jobId);
    if (detail) return { status: "ok", detail };

    const known = [
      ...(this.cached.value.overview.dreamRuns ?? []),
      ...this.cached.value.overview.jobs.map((job) => job.run).filter((run) => run !== null),
    ].find((run) => run?.id === jobId);
    if (known && !DREAM_JOB_NAMES.includes(known.name as typeof DREAM_JOB_NAMES[number])) {
      return { status: "not-found" };
    }
    const relevant = known?.name === "autopilot-cycle"
      ? this.cached.value.quality.sourceDreamRuns
      : known?.name === "autopilot-global-maintenance"
        ? this.cached.value.quality.globalDreamRuns
        : null;
    if (relevant && relevant !== "fresh") return { status: "unavailable" };
    if (!relevant && (
      this.cached.value.quality.sourceDreamRuns !== "fresh"
      || this.cached.value.quality.globalDreamRuns !== "fresh"
    )) return { status: "unavailable" };
    return { status: "not-found" };
  }

  private async load(generation: number): Promise<ControlPollingBundle> {
    try {
      const result = await this.reader!.read();
      const previous = this.cached?.value ?? null;
      const generatedAt = new Date().toISOString();
      const base = normalizeControlCenter(
        result.status,
        result.recentJobs ?? [],
        this.allowedSourceIds,
        [],
      );
      const previousQuality = previous?.quality;
      const quality: ControlCenterQuality = {
        status: priorStatusFreshness(result.status, previousQuality?.status),
        recentJobs: priorFreshness(result.recentJobs, previousQuality?.recentJobs),
        sourceDreamRuns: priorFreshness(result.fullRuns, previousQuality?.sourceDreamRuns),
        globalDreamRuns: priorFreshness(result.globalRuns, previousQuality?.globalDreamRuns),
      };

      base.generatedAt = generatedAt;
      if (previous) {
        if (result.status === null) {
          base.version = previous.overview.version;
          base.sources = previous.overview.sources;
        }
        if (result.recentJobs === null) {
          base.jobs = previous.overview.jobs;
          base.recentJobCounts = previous.overview.recentJobCounts;
        }
      }

      const canShowSourcelessGlobal = result.status !== null
        && controlAllSourcesVisible(result.status, this.allowedSourceIds);
      let sourceEntries = [] as ReturnType<typeof normalizeControlDreamRuns>;
      let globalEntries = [] as ReturnType<typeof normalizeControlDreamRuns>;
      let sourceDetails: ReadonlyMap<number, ControlDreamRunDetail>;
      let globalDetails: ReadonlyMap<number, ControlDreamRunDetail>;
      if (result.fullRuns === null) {
        sourceDetails = retainedDetails(previous, "autopilot-cycle", generatedAt);
      } else {
        try {
          let failed = false;
          sourceEntries = normalizeControlDreamRuns(result.fullRuns, this.allowedSourceIds, false, () => { failed = true; });
          if (failed) throw new Error("source Dream detail normalization failed");
          sourceDetails = buildControlDreamDetails(sourceEntries, generatedAt);
        } catch {
          sourceEntries = [];
          quality.sourceDreamRuns = previous ? "stale" : "unavailable";
          sourceDetails = retainedDetails(previous, "autopilot-cycle", generatedAt);
        }
      }
      if (result.globalRuns === null) {
        globalDetails = retainedDetails(previous, "autopilot-global-maintenance", generatedAt);
      } else {
        try {
          let failed = false;
          globalEntries = normalizeControlDreamRuns(
            result.globalRuns,
            this.allowedSourceIds,
            canShowSourcelessGlobal,
            () => { failed = true; },
          );
          if (failed) throw new Error("global Dream detail normalization failed");
          globalDetails = buildControlDreamDetails(globalEntries, generatedAt);
        } catch {
          globalEntries = [];
          quality.globalDreamRuns = previous ? "stale" : "unavailable";
          globalDetails = retainedDetails(previous, "autopilot-global-maintenance", generatedAt);
        }
      }

      const sourceRuns = result.fullRuns === null || quality.sourceDreamRuns === "stale"
        ? (previous?.overview.dreamRuns ?? []).filter((run) => run.name === "autopilot-cycle")
        : sourceEntries.map((entry) => entry.run);
      const globalRuns = result.globalRuns === null || quality.globalDreamRuns === "stale"
        ? (previous?.overview.dreamRuns ?? []).filter((run) => run.name === "autopilot-global-maintenance")
        : globalEntries.map((entry) => entry.run);
      base.dreamRuns = [...sourceRuns, ...globalRuns].sort((left, right) => {
        const leftTime = new Date(left.finishedAt ?? left.startedAt ?? 0).getTime();
        const rightTime = new Date(right.finishedAt ?? right.startedAt ?? 0).getTime();
        return rightTime - leftTime || (right.id ?? 0) - (left.id ?? 0);
      });
      base.latestFullRun = sourceRuns[0]
        ?? (quality.sourceDreamRuns === "fresh" ? base.latestFullRun : previous?.overview.latestFullRun)
        ?? null;
      base.latestTargetedRun = globalRuns[0]
        ?? (quality.globalDreamRuns === "fresh" ? base.latestTargetedRun : previous?.overview.latestTargetedRun)
        ?? null;
      const unexplainedPartial = result.partial
        && result.status !== null
        && result.recentJobs !== null
        && result.fullRuns !== null
        && result.globalRuns !== null;
      const overviewPartial = quality.status !== "fresh" || quality.recentJobs !== "fresh" || unexplainedPartial;
      base.availability.message = overviewPartial ? "일부 GBrain 운영 데이터를 불러오지 못했습니다." : null;
      base.management.enabled = this.config.mutationsEnabled
        && base.availability.connected
        && !overviewPartial;
      base.quality = quality;
      const bundle: ControlPollingBundle = {
        overview: base,
        detailByJobId: mergeDetails(sourceDetails, globalDetails),
        quality,
      };
      if (generation === this.generation) this.cached = { at: Date.now(), value: bundle };
      return bundle;
    } catch (error) {
      console.error("Control Center refresh failed:", safeServerError(error));
      if (this.cached) {
        return {
          ...this.cached.value,
          overview: {
            ...this.cached.value.overview,
            availability: {
              configured: true,
              connected: false,
              message: "GBrain Control MCP에 연결할 수 없어 마지막 정상 상태를 표시합니다.",
            },
            management: { enabled: false, confirmationRequired: true },
          },
        };
      }
      const overview = unavailableControlResponse(true, "GBrain Control MCP에 연결할 수 없습니다.");
      return { overview, detailByJobId: new Map(), quality: overview.quality! };
    }
  }
}
