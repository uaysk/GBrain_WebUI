import { useCallback, useRef, useState } from "react";
import type { ControlActionRequest, ControlActionResult } from "../types";
import { parseControlActionResult } from "../api/control-validation";

interface CsrfResponse {
  token?: unknown;
  csrf?: unknown;
  csrfToken?: unknown;
}

interface ErrorResponse {
  error?: unknown;
  message?: unknown;
  code?: unknown;
}

export type ControlRecoveryAction = "refresh" | "inspect-jobs" | "wait" | "retry" | "reauthenticate";

export interface ControlActionFailure {
  status: number;
  code: string;
  message: string;
  retryAfterSeconds: number | null;
  recoveryAction: ControlRecoveryAction;
  recoveryLabel: string;
  recoveryHint: string;
}

class ControlActionRequestError extends Error {
  constructor(public readonly failure: ControlActionFailure) {
    super(failure.message);
    this.name = "ControlActionRequestError";
  }
}

function idempotencyKey(): string {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();

  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const value = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${value.slice(0, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}-${value.slice(16, 20)}-${value.slice(20)}`;
}

function csrfToken(payload: CsrfResponse): string | null {
  const candidate = payload.token ?? payload.csrfToken ?? payload.csrf;
  return typeof candidate === "string" && candidate.length > 0 ? candidate : null;
}

export function controlActionRecoveryFor(
  code: string,
  status: number,
): Pick<ControlActionFailure, "recoveryAction" | "recoveryLabel" | "recoveryHint"> {
  if (code === "stale_job_status") {
    return {
      recoveryAction: "refresh",
      recoveryLabel: "최신 상태로 갱신",
      recoveryHint: "Job 상태가 바뀌었습니다. 최신 상태를 확인한 뒤 다시 판단하세요.",
    };
  }
  if (code === "source_busy" || code === "action_in_progress") {
    return {
      recoveryAction: "inspect-jobs",
      recoveryLabel: "진행 중 Job 보기",
      recoveryHint: "같은 대상의 기존 작업을 먼저 확인하세요. 완료되면 다시 실행할 수 있습니다.",
    };
  }
  if (code === "action_cooldown" || status === 429) {
    return {
      recoveryAction: "wait",
      recoveryLabel: "대기 후 다시 시도",
      recoveryHint: "중복 실행 방지 시간이 지난 뒤 같은 요청을 다시 시도하세요.",
    };
  }
  if (code.includes("csrf") || code === "authentication_required" || status === 401) {
    return {
      recoveryAction: "reauthenticate",
      recoveryLabel: "페이지 다시 불러오기",
      recoveryHint: "세션 또는 보안 토큰이 만료되었을 수 있습니다. 페이지를 다시 불러온 뒤 재시도하세요.",
    };
  }
  if (code.includes("precheck") || status === 503) {
    return {
      recoveryAction: "refresh",
      recoveryLabel: "연결 상태 갱신",
      recoveryHint: "GBrain의 현재 상태를 확인하지 못했습니다. 상태를 갱신한 뒤 다시 시도하세요.",
    };
  }
  return {
    recoveryAction: "retry",
    recoveryLabel: "다시 시도",
    recoveryHint: "대상과 실행 조건을 확인한 뒤 요청을 다시 시도하세요.",
  };
}

async function responseFailure(response: Response): Promise<ControlActionFailure> {
  const fallback = `관리 요청을 처리할 수 없습니다. (${response.status})`;
  const payload = await response.json().catch(() => null) as ErrorResponse | null;
  const candidate = payload && typeof payload === "object"
    ? typeof payload.message === "string"
      ? payload.message
      : typeof payload.error === "string" ? payload.error : null
    : null;
  const normalized = candidate?.trim().replace(/\s+/g, " ") || fallback;
  const message = normalized.length > 300 ? `${normalized.slice(0, 297)}…` : normalized;
  const rawCode = payload && typeof payload.code === "string" ? payload.code.trim() : "";
  const code = /^[a-z0-9_-]{1,80}$/i.test(rawCode) ? rawCode : `http_${response.status}`;
  const retryAfterHeader = Number(response.headers.get("Retry-After"));
  const retryAfterSeconds = Number.isFinite(retryAfterHeader) && retryAfterHeader > 0
    ? Math.ceil(retryAfterHeader)
    : null;
  return {
    status: response.status,
    code,
    message,
    retryAfterSeconds,
    ...controlActionRecoveryFor(code, response.status),
  };
}

async function submitControlAction(request: ControlActionRequest, key: string): Promise<ControlActionResult> {
  const csrfResponse = await fetch("/api/control-center/csrf", {
    method: "GET",
    headers: { Accept: "application/json" },
    cache: "no-store",
  });
  if (!csrfResponse.ok) throw new ControlActionRequestError(await responseFailure(csrfResponse));

  const csrfPayload = await csrfResponse.json() as CsrfResponse;
  const token = csrfToken(csrfPayload);
  if (!token) throw new Error("관리 요청을 확인할 보안 토큰을 받지 못했습니다.");

  const actionResponse = await fetch("/api/control-center/actions", {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      "Idempotency-Key": key,
      "X-GBrain-CSRF": token,
    },
    body: JSON.stringify(request),
  });
  if (!actionResponse.ok) throw new ControlActionRequestError(await responseFailure(actionResponse));
  return parseControlActionResult(await actionResponse.json());
}

export function useControlActions() {
  const [executing, setExecuting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [failure, setFailure] = useState<ControlActionFailure | null>(null);
  const [result, setResult] = useState<ControlActionResult | null>(null);
  const inFlight = useRef(false);
  const pendingRequest = useRef<{ canonical: string; key: string } | null>(null);

  const execute = useCallback(async (request: ControlActionRequest): Promise<ControlActionResult | null> => {
    if (inFlight.current) {
      const next: ControlActionFailure = {
        status: 409,
        code: "client_action_in_progress",
        message: "이미 다른 관리 요청을 처리하고 있습니다.",
        retryAfterSeconds: null,
        recoveryAction: "wait",
        recoveryLabel: "현재 요청 완료 대기",
        recoveryHint: "진행 중인 요청이 끝나면 다시 시도할 수 있습니다.",
      };
      setError(next.message);
      setFailure(next);
      return null;
    }

    inFlight.current = true;
    setExecuting(true);
    setError(null);
    setFailure(null);
    setResult(null);
    const canonical = JSON.stringify(request);
    if (!pendingRequest.current || pendingRequest.current.canonical !== canonical) {
      pendingRequest.current = { canonical, key: idempotencyKey() };
    }
    try {
      const next = await submitControlAction(request, pendingRequest.current.key);
      setResult(next);
      return next;
    } catch (reason) {
      const next = reason instanceof ControlActionRequestError
        ? reason.failure
        : {
          status: 0,
          code: "network_error",
          message: reason instanceof Error ? reason.message : "관리 요청을 처리할 수 없습니다.",
          retryAfterSeconds: null,
          recoveryAction: "retry" as const,
          recoveryLabel: "다시 시도",
          recoveryHint: "네트워크 연결을 확인한 뒤 같은 요청을 다시 시도하세요.",
        };
      setError(next.message);
      setFailure(next);
      return null;
    } finally {
      inFlight.current = false;
      setExecuting(false);
    }
  }, []);

  const clear = useCallback(() => {
    setError(null);
    setFailure(null);
    setResult(null);
    pendingRequest.current = null;
  }, []);

  return { executing, error, failure, result, execute, clear };
}
