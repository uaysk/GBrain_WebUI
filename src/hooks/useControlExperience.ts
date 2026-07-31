import { useCallback, useEffect, useMemo, useState } from "react";
import type {
  ControlActionResult,
  ControlCenterResponse,
  ControlJobStatus,
  ControlSourceStatus,
} from "../types";
import type { ControlActionIntent } from "../components/control/ControlActionDialog";
import { normalizeControlJobStatus } from "../api/control-validation";

const ACTIVITY_STORAGE_KEY = "gbrain-control-activity-v1";
const TREND_STORAGE_KEY = "gbrain-control-trends-v1";
const MAX_ACTIVITY_RECORDS = 40;
const MAX_TREND_POINTS = 1_200;
const TREND_RETENTION_MS = 30 * 24 * 60 * 60 * 1_000;
const TREND_HEARTBEAT_MS = 60 * 60 * 1_000;

export interface ControlSourceSnapshot {
  sourceId: string;
  sourceName: string;
  capturedAt: string;
  pages: number;
  chunksTotal: number;
  chunksUnembedded: number;
  embeddingCoveragePct: number;
  lastSyncAt: string | null;
}

export interface ControlActivityRecord {
  id: string;
  recordedAt: string;
  sourceId: string | null;
  result: ControlActionResult;
  before: ControlSourceSnapshot | null;
  after: ControlSourceSnapshot | null;
  observedJobStatus: ControlJobStatus | null;
}

export interface ControlTrendPoint {
  at: string;
  sourceId: string;
  pages: number;
  chunksTotal: number;
  chunksUnembedded: number;
  embeddingCoveragePct: number;
}

function finiteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function text(value: unknown, maxLength = 180): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().replace(/\s+/g, " ");
  if (!normalized) return null;
  return normalized.slice(0, maxLength);
}

function safeActionResult(value: unknown): ControlActionResult | null {
  if (!value || typeof value !== "object") return null;
  const source = value as Record<string, unknown>;
  const actionId = text(source.actionId, 128);
  const action = source.action;
  const outcome = source.outcome;
  const generatedAt = text(source.generatedAt, 40);
  const message = text(source.message, 300);
  const allowedActions = new Set(["quick-dream", "source-sync", "embedding-refresh", "job-retry", "job-cancel"]);
  if (!actionId || !allowedActions.has(String(action)) || !generatedAt || !message) return null;
  if (outcome !== "accepted" && outcome !== "pending-verification") return null;

  let job: ControlActionResult["job"] = null;
  if (source.job && typeof source.job === "object") {
    const rawJob = source.job as Record<string, unknown>;
    const id = finiteNumber(rawJob.id);
    const name = text(rawJob.name, 80);
    const label = text(rawJob.label, 120);
    const rawStatus = text(rawJob.status, 32);
    const status = rawStatus ? normalizeControlJobStatus(rawStatus) : null;
    if (id !== null && id > 0 && name && label && status) {
      job = {
        id,
        name,
        label,
        status,
        sourceId: text(rawJob.sourceId, 128),
        createdAt: text(rawJob.createdAt, 40),
      };
    }
  }

  return {
    actionId,
    action: action as ControlActionResult["action"],
    outcome,
    replayed: source.replayed === true,
    message,
    generatedAt,
    job,
  };
}

function safeSnapshot(value: unknown): ControlSourceSnapshot | null {
  if (!value || typeof value !== "object") return null;
  const source = value as Record<string, unknown>;
  const sourceId = text(source.sourceId, 128);
  const sourceName = text(source.sourceName, 160);
  const capturedAt = text(source.capturedAt, 40);
  const pages = finiteNumber(source.pages);
  const chunksTotal = finiteNumber(source.chunksTotal);
  const chunksUnembedded = finiteNumber(source.chunksUnembedded);
  const embeddingCoveragePct = finiteNumber(source.embeddingCoveragePct);
  if (!sourceId || !sourceName || !capturedAt || pages === null || chunksTotal === null
    || chunksUnembedded === null || embeddingCoveragePct === null) return null;
  return {
    sourceId,
    sourceName,
    capturedAt,
    pages,
    chunksTotal,
    chunksUnembedded,
    embeddingCoveragePct,
    lastSyncAt: text(source.lastSyncAt, 40),
  };
}

export function parseStoredActivity(value: unknown): ControlActivityRecord[] {
  if (!Array.isArray(value)) return [];
  const records: ControlActivityRecord[] = [];
  for (const item of value.slice(0, MAX_ACTIVITY_RECORDS)) {
    if (!item || typeof item !== "object") continue;
    const source = item as Record<string, unknown>;
    const id = text(source.id, 128);
    const recordedAt = text(source.recordedAt, 40);
    const result = safeActionResult(source.result);
    if (!id || !recordedAt || !result) continue;
    records.push({
      id,
      recordedAt,
      sourceId: text(source.sourceId, 128),
      result,
      before: safeSnapshot(source.before),
      after: safeSnapshot(source.after),
      observedJobStatus: source.observedJobStatus === null || source.observedJobStatus === undefined
        ? null
        : normalizeControlJobStatus(source.observedJobStatus),
    });
  }
  return records;
}

export function parseStoredTrendPoints(value: unknown): ControlTrendPoint[] {
  if (!Array.isArray(value)) return [];
  const cutoff = Date.now() - TREND_RETENTION_MS;
  return value.slice(-MAX_TREND_POINTS).flatMap((item): ControlTrendPoint[] => {
    if (!item || typeof item !== "object") return [];
    const source = item as Record<string, unknown>;
    const at = text(source.at, 40);
    const sourceId = text(source.sourceId, 128);
    const pages = finiteNumber(source.pages);
    const chunksTotal = finiteNumber(source.chunksTotal);
    const chunksUnembedded = finiteNumber(source.chunksUnembedded);
    const embeddingCoveragePct = finiteNumber(source.embeddingCoveragePct);
    const timestamp = at ? Date.parse(at) : Number.NaN;
    if (!at || !sourceId || !Number.isFinite(timestamp) || timestamp < cutoff || pages === null
      || chunksTotal === null || chunksUnembedded === null || embeddingCoveragePct === null) return [];
    return [{ at, sourceId, pages, chunksTotal, chunksUnembedded, embeddingCoveragePct }];
  });
}

function readStorage<T>(key: string, parser: (value: unknown) => T, fallback: T): T {
  if (typeof window === "undefined") return fallback;
  try {
    const value = window.localStorage.getItem(key);
    return value ? parser(JSON.parse(value)) : fallback;
  } catch {
    return fallback;
  }
}

function writeStorage(key: string, value: unknown): void {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage can be unavailable in private mode; the in-memory experience remains usable.
  }
}

export function snapshotSource(source: ControlSourceStatus, capturedAt: string): ControlSourceSnapshot {
  return {
    sourceId: source.id,
    sourceName: source.name,
    capturedAt,
    pages: source.pages,
    chunksTotal: source.chunksTotal,
    chunksUnembedded: source.chunksUnembedded,
    embeddingCoveragePct: source.embeddingCoveragePct,
    lastSyncAt: source.lastSyncAt,
  };
}

function pointChanged(previous: ControlTrendPoint, next: ControlTrendPoint): boolean {
  return previous.pages !== next.pages
    || previous.chunksTotal !== next.chunksTotal
    || previous.chunksUnembedded !== next.chunksUnembedded
    || previous.embeddingCoveragePct !== next.embeddingCoveragePct;
}

export function appendTrendSnapshot(
  existing: ControlTrendPoint[],
  data: Pick<ControlCenterResponse, "generatedAt" | "sources">,
  now = Date.now(),
): ControlTrendPoint[] {
  const cutoff = now - TREND_RETENTION_MS;
  const retained = existing.filter((point) => Date.parse(point.at) >= cutoff);
  const additions: ControlTrendPoint[] = [];
  for (const source of data.sources) {
    const next: ControlTrendPoint = {
      at: data.generatedAt,
      sourceId: source.id,
      pages: source.pages,
      chunksTotal: source.chunksTotal,
      chunksUnembedded: source.chunksUnembedded,
      embeddingCoveragePct: source.embeddingCoveragePct,
    };
    const previous = [...retained, ...additions].reverse().find((point) => point.sourceId === source.id);
    const elapsed = previous ? Date.parse(next.at) - Date.parse(previous.at) : Number.POSITIVE_INFINITY;
    if (!previous || pointChanged(previous, next) || elapsed >= TREND_HEARTBEAT_MS) additions.push(next);
  }
  return [...retained, ...additions].slice(-MAX_TREND_POINTS);
}

function sourceIdForIntent(intent: ControlActionIntent): string | null {
  return intent.source?.id ?? intent.job?.sourceId ?? null;
}

export function useControlExperience(data: ControlCenterResponse | null) {
  const [activity, setActivity] = useState<ControlActivityRecord[]>(() =>
    readStorage(ACTIVITY_STORAGE_KEY, parseStoredActivity, []));
  const [trendPoints, setTrendPoints] = useState<ControlTrendPoint[]>(() =>
    readStorage(TREND_STORAGE_KEY, parseStoredTrendPoints, []));

  useEffect(() => {
    if (!data) return;
    setTrendPoints((current) => {
      const next = appendTrendSnapshot(current, data);
      if (next.length === current.length && next.every((point, index) => point === current[index])) return current;
      writeStorage(TREND_STORAGE_KEY, next);
      return next;
    });
  }, [data]);

  useEffect(() => {
    if (!data) return;
    setActivity((current) => {
      let changed = false;
      const next = current.map((record) => {
        const currentSource = record.sourceId
          ? data.sources.find((source) => source.id === record.sourceId) ?? null
          : null;
        const currentJob = record.result.job
          ? data.jobs.find((job) => job.id === record.result.job!.id) ?? null
          : null;
        const nextAfter = currentSource ? snapshotSource(currentSource, data.generatedAt) : record.after;
        const nextStatus = currentJob?.status ?? record.observedJobStatus;
        if (JSON.stringify(nextAfter) === JSON.stringify(record.after) && nextStatus === record.observedJobStatus) {
          return record;
        }
        changed = true;
        return { ...record, after: nextAfter, observedJobStatus: nextStatus };
      });
      if (!changed) return current;
      writeStorage(ACTIVITY_STORAGE_KEY, next);
      return next;
    });
  }, [data]);

  const recordAction = useCallback((result: ControlActionResult, intent: ControlActionIntent) => {
    const sourceId = sourceIdForIntent(intent);
    const before = intent.source
      ? snapshotSource(intent.source, data?.generatedAt ?? result.generatedAt)
      : sourceId && data
        ? data.sources.find((source) => source.id === sourceId)
          ? snapshotSource(data.sources.find((source) => source.id === sourceId)!, data.generatedAt)
          : null
        : null;
    const record: ControlActivityRecord = {
      id: result.actionId,
      recordedAt: result.generatedAt,
      sourceId,
      result,
      before,
      after: null,
      observedJobStatus: result.job?.status ?? null,
    };
    setActivity((current) => {
      const next = [record, ...current.filter((item) => item.id !== record.id)].slice(0, MAX_ACTIVITY_RECORDS);
      writeStorage(ACTIVITY_STORAGE_KEY, next);
      return next;
    });
  }, [data]);

  const clearActivity = useCallback(() => {
    setActivity([]);
    writeStorage(ACTIVITY_STORAGE_KEY, []);
  }, []);

  const uiLaunchedJobIds = useMemo(() => new Set(activity.flatMap((record) =>
    record.result.job ? [record.result.job.id] : [])), [activity]);

  return {
    activity,
    trendPoints,
    uiLaunchedJobIds,
    recordAction,
    clearActivity,
  };
}
