import {
  AlertTriangle,
  Ban,
  BrainCircuit,
  CheckCircle2,
  DatabaseZap,
  Gauge,
  GitMerge,
  Info,
  RefreshCw,
  RotateCcw,
  ShieldAlert,
  Timer,
  X,
  type LucideIcon,
} from "lucide-react";
import { createPortal } from "react-dom";
import { useEffect, useId, useRef, useState, type FormEvent, type MouseEvent } from "react";
import type {
  ControlActionName,
  ControlActionRequest,
  ControlJob,
  ControlSourceStatus,
} from "../../types";
import type { ControlActionPreview } from "../../control/insights";
import type { ControlActionFailure } from "../../hooks/useControlActions";
import { Button } from "../ui/button";
import { StatusBadge } from "./StatusBadge";

type SourceAction = "quick-dream" | "source-sync" | "embedding-refresh";
type JobAction = "job-retry" | "job-cancel";

export type ControlActionIntent =
  | { action: SourceAction; source: ControlSourceStatus; job?: never }
  | { action: JobAction; job: ControlJob; source?: never };

interface Props {
  intent: ControlActionIntent;
  executing: boolean;
  error: string | null;
  failure?: ControlActionFailure | null;
  preview?: ControlActionPreview | null;
  onClose: () => void;
  onConfirm: (request: ControlActionRequest) => void | Promise<void>;
  onRecovery?: (failure: ControlActionFailure) => void | Promise<void>;
}

interface ActionPresentation {
  title: string;
  eyebrow: string;
  description: string;
  confirmLabel: string;
  icon: LucideIcon;
  effects: string[];
  warnings: string[];
  dangerous?: boolean;
}

const ACTION_PRESENTATION: Record<ControlActionName, ActionPresentation> = {
  "quick-dream": {
    title: "Quick Dream 실행",
    eyebrow: "Dream 관리",
    description: "선택한 source를 대상으로 축약된 Dream 분석 작업을 큐에 등록합니다.",
    confirmLabel: "Quick Dream 실행",
    icon: BrainCircuit,
    effects: [
      "선택한 source에 sync → extract → embed 고정 3단계를 실행합니다.",
      "실행 상태와 단계별 결과는 Control Center에 표시됩니다.",
    ],
    warnings: [
      "요청은 비동기로 실행되며 완료까지 시간이 걸릴 수 있습니다.",
      "전체 Dream의 global maintenance와 purge 단계는 실행하지 않습니다.",
    ],
  },
  "source-sync": {
    title: "Source 동기화",
    eyebrow: "Source 관리",
    description: "선택한 source를 다시 스캔해 GBrain 색인과 원본 상태를 동기화합니다.",
    confirmLabel: "동기화 시작",
    icon: RefreshCw,
    effects: [
      "새 문서와 변경된 문서를 찾아 Source 색인 갱신 작업을 등록합니다.",
      "관계 추출과 inline embedding은 이 작업에서 실행하지 않습니다.",
    ],
    warnings: [
      "관리형 원격 Source는 원본을 갱신하고, 로컬 Source는 현재 파일을 스캔합니다.",
      "동기화 중에는 대시보드 수치가 일시적으로 변할 수 있습니다.",
    ],
  },
  "embedding-refresh": {
    title: "Embedding 갱신",
    eyebrow: "Embedding 관리",
    description: "선택한 source의 누락되거나 오래된 embedding을 갱신하는 작업을 등록합니다.",
    confirmLabel: "갱신 시작",
    icon: DatabaseZap,
    effects: [
      "갱신 대상 chunk를 계산하고 embedding 작업을 큐에 등록합니다.",
      "완료 후 embedding 적용률과 의미 기반 검색 데이터가 갱신됩니다.",
    ],
    warnings: [
      "대상 규모에 따라 연산 자원과 외부 모델 사용량이 증가할 수 있습니다.",
      "작업 중 일부 chunk는 순차적으로 갱신되어 적용률이 점진적으로 변합니다.",
    ],
  },
  "job-retry": {
    title: "작업 재시도",
    eyebrow: "Job 관리",
    description: "선택한 작업의 현재 상태를 확인한 뒤 동일한 작업을 다시 실행하도록 요청합니다.",
    confirmLabel: "작업 재시도",
    icon: RotateCcw,
    effects: [
      "표시된 작업 ID와 현재 상태를 조건으로 재시도 요청을 보냅니다.",
      "수락된 작업은 새 실행 상태로 Control Center에서 추적할 수 있습니다.",
    ],
    warnings: [
      "화면을 연 뒤 작업 상태가 바뀌었다면 안전을 위해 요청이 거부됩니다.",
      "이전 실행이 일부 결과를 남겼다면 재시도 결과와 함께 다시 확인해야 합니다.",
    ],
  },
  "job-cancel": {
    title: "작업 취소",
    eyebrow: "주의가 필요한 Job 관리",
    description: "선택한 waiting 또는 delayed 작업의 현재 상태를 확인한 뒤 큐에서 취소하도록 요청합니다.",
    confirmLabel: "작업 취소",
    icon: Ban,
    effects: [
      "표시된 작업 ID와 현재 상태를 조건으로 취소 요청을 보냅니다.",
      "취소가 반영되면 작업 상태가 cancelled로 변경됩니다.",
    ],
    warnings: [
      "이미 active 상태가 된 작업은 이 화면에서 취소할 수 없습니다.",
      "화면을 연 뒤 작업 상태가 바뀌었다면 안전을 위해 요청이 거부됩니다.",
    ],
    dangerous: true,
  },
};

function confirmationFor(intent: ControlActionIntent): string {
  switch (intent.action) {
    case "quick-dream": return `RUN ${intent.source.id}`;
    case "source-sync": return `SYNC ${intent.source.id}`;
    case "embedding-refresh": return `EMBED ${intent.source.id}`;
    case "job-retry": return `RETRY #${intent.job.id}`;
    case "job-cancel": return `CANCEL #${intent.job.id}`;
  }
}

export function createControlActionRequest(intent: ControlActionIntent): ControlActionRequest {
  const confirmation = confirmationFor(intent);
  switch (intent.action) {
    case "quick-dream":
    case "source-sync":
    case "embedding-refresh":
      return { action: intent.action, sourceId: intent.source.id, confirmation };
    case "job-retry":
    case "job-cancel":
      return {
        action: intent.action,
        jobId: intent.job.id,
        expectedStatus: intent.job.status,
        confirmation,
      };
  }
}

function TargetSummary({ intent }: { intent: ControlActionIntent }) {
  if (intent.source) {
    return <div className="rounded-lg bg-black/25 px-3 py-3">
      <div className="flex items-start gap-3">
        <DatabaseZap className="mt-0.5 size-4 shrink-0 text-cyan-300" aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <strong className="truncate text-xs font-semibold text-zinc-100">{intent.source.name}</strong>
            <span className={`rounded-full px-2 py-0.5 text-[10px] ${
              intent.source.syncEnabled ? "bg-emerald-950/70 text-emerald-300" : "bg-zinc-800 text-zinc-400"
            }`}>{intent.source.syncEnabled ? "Sync 활성" : "Sync 비활성"}</span>
          </div>
          <div className="mt-1 break-all font-mono text-[10px] text-zinc-500">{intent.source.id}</div>
          <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[10px] text-zinc-500">
            <span>{intent.source.pages.toLocaleString()} pages</span>
            <span>{intent.source.chunksTotal.toLocaleString()} chunks</span>
            <span>{intent.source.embeddingCoveragePct.toFixed(1)}% embedded</span>
          </div>
        </div>
      </div>
    </div>;
  }

  return <div className="rounded-lg bg-black/25 px-3 py-3">
    <div className="flex items-start gap-3">
      <ShieldAlert className="mt-0.5 size-4 shrink-0 text-cyan-300" aria-hidden="true" />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <strong className="min-w-0 truncate text-xs font-semibold text-zinc-100">{intent.job.label}</strong>
          <StatusBadge status={intent.job.status} />
        </div>
        <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 font-mono text-[10px] text-zinc-500">
          <span>Job #{intent.job.id}</span>
          <span>{intent.job.queue}</span>
          {intent.job.sourceId && <span className="break-all">Source {intent.job.sourceId}</span>}
        </div>
      </div>
    </div>
  </div>;
}

function DetailList({ title, items, warning = false }: { title: string; items: string[]; warning?: boolean }) {
  const Icon = warning ? AlertTriangle : CheckCircle2;
  return <section className={`rounded-lg px-3 py-3 ${warning ? "bg-amber-950/35" : "bg-cyan-950/25"}`}>
    <h3 className={`flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.12em] ${
      warning ? "text-amber-300" : "text-cyan-300"
    }`}><Icon className="size-3" aria-hidden="true" />{title}</h3>
    <ul className={`mt-2 space-y-1.5 text-[11px] leading-relaxed ${
      warning ? "text-amber-100/75" : "text-zinc-300"
    }`}>
      {items.map((item) => <li key={item} className="flex gap-2">
        <span className="mt-[0.4rem] size-1 shrink-0 rounded-full bg-current opacity-60" aria-hidden="true" />
        <span>{item}</span>
      </li>)}
    </ul>
  </section>;
}

function ImpactPreview({ preview }: { preview: ControlActionPreview }) {
  return <section className="rounded-lg bg-violet-950/25 px-3 py-3" aria-labelledby="control-action-impact-preview">
    <div className="flex flex-wrap items-center gap-2">
      <Gauge className="size-3.5 text-violet-300" aria-hidden="true" />
      <h3 id="control-action-impact-preview" className="text-[10px] font-semibold uppercase tracking-[0.12em] text-violet-200">
        실행 영향 미리보기
      </h3>
      <span className="rounded bg-violet-950/70 px-2 py-0.5 text-[9px] font-semibold text-violet-300">추정치</span>
    </div>
    <p className="mt-2 flex items-start gap-1.5 text-[10px] leading-relaxed text-violet-100/55">
      <Info className="mt-0.5 size-3 shrink-0" aria-hidden="true" />
      {preview.estimateNotice}
    </p>
    <dl className="mt-3 grid gap-2 sm:grid-cols-3">
      <div className="rounded bg-black/20 px-2.5 py-2">
        <dt className="flex items-center gap-1.5 text-[9px] text-zinc-500"><DatabaseZap className="size-3" aria-hidden="true" />예상 처리량</dt>
        <dd className="mt-1 text-[10px] leading-relaxed text-zinc-200">{preview.workload.label}</dd>
      </div>
      <div className="rounded bg-black/20 px-2.5 py-2">
        <dt className="flex items-center gap-1.5 text-[9px] text-zinc-500"><Timer className="size-3" aria-hidden="true" />예상 소요</dt>
        <dd className="mt-1 font-mono text-xs font-semibold text-zinc-200">{preview.duration.label}</dd>
        <div className="mt-1 text-[9px] text-zinc-600">
          {preview.duration.basis === "recent-jobs" ? `최근 ${preview.duration.sampleSize}개 완료 Job 기준` : "안전한 기본 범위"}
        </div>
      </div>
      <div className="rounded bg-black/20 px-2.5 py-2">
        <dt className="flex items-center gap-1.5 text-[9px] text-zinc-500"><GitMerge className="size-3" aria-hidden="true" />겹치는 Job</dt>
        <dd className={`mt-1 text-xs font-semibold ${preview.conflicts.length ? "text-amber-300" : "text-emerald-300"}`}>
          {preview.conflicts.length ? `${preview.conflicts.length}개 확인 필요` : "감지되지 않음"}
        </dd>
        {!!preview.conflicts.length && <div className="mt-1 line-clamp-2 font-mono text-[9px] text-amber-200/60">
          {preview.conflicts.map((conflict) => `#${conflict.jobId} ${conflict.status}`).join(" · ")}
        </div>}
      </div>
    </dl>
    {(preview.warnings.length > 0 || preview.followUps.length > 0) && <div className="mt-3 grid gap-2 sm:grid-cols-2">
      {!!preview.warnings.length && <ul className="space-y-1 text-[10px] leading-relaxed text-amber-200/70">
        {preview.warnings.map((warning) => <li key={warning}>• {warning}</li>)}
      </ul>}
      {!!preview.followUps.length && <ul className="space-y-1 text-[10px] leading-relaxed text-zinc-400">
        {preview.followUps.map((followUp) => <li key={followUp}>→ {followUp}</li>)}
      </ul>}
    </div>}
  </section>;
}

export function ControlActionDialog({
  intent,
  executing,
  error,
  failure = null,
  preview = null,
  onClose,
  onConfirm,
  onRecovery,
}: Props) {
  const [typedConfirmation, setTypedConfirmation] = useState("");
  const [retrySeconds, setRetrySeconds] = useState(failure?.retryAfterSeconds ?? 0);
  const dialogRef = useRef<HTMLFormElement>(null);
  const onCloseRef = useRef(onClose);
  const titleId = useId();
  const descriptionId = useId();
  const errorId = useId();
  const presentation = ACTION_PRESENTATION[intent.action];
  const confirmation = confirmationFor(intent);
  const requiresTypedConfirmation = intent.action === "job-cancel";
  const confirmed = !requiresTypedConfirmation || typedConfirmation === confirmation;
  const ActionIcon = presentation.icon;
  const intentKey = intent.source
    ? `${intent.action}:source:${intent.source.id}`
    : `${intent.action}:job:${intent.job.id}:${intent.job.status}`;

  useEffect(() => {
    setTypedConfirmation("");
  }, [intentKey]);

  useEffect(() => {
    setRetrySeconds(failure?.retryAfterSeconds ?? 0);
    if (!failure?.retryAfterSeconds) return;
    const timer = window.setInterval(() => {
      setRetrySeconds((current) => Math.max(0, current - 1));
    }, 1_000);
    return () => window.clearInterval(timer);
  }, [failure]);

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const handleDialogKeys = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        onCloseRef.current();
        return;
      }
      if (event.key !== "Tab" || !dialogRef.current) return;
      const focusable = [...dialogRef.current.querySelectorAll<HTMLElement>(
        'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [href], [tabindex]:not([tabindex="-1"])',
      )].filter((element) => !element.hasAttribute("hidden"));
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", handleDialogKeys, true);
    return () => {
      window.removeEventListener("keydown", handleDialogKeys, true);
      previouslyFocused?.focus({ preventScroll: true });
    };
  }, []);

  const closeFromBackdrop = (event: MouseEvent<HTMLDivElement>) => {
    if (event.target === event.currentTarget) onClose();
  };

  const confirm = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (executing || !confirmed) return;
    void onConfirm(createControlActionRequest(intent));
  };

  return createPortal(<div
    className="fixed inset-0 z-[110] grid place-items-center overflow-y-auto bg-black/80 p-3 backdrop-blur-sm sm:p-5"
    onMouseDown={closeFromBackdrop}
    data-testid="control-action-backdrop"
  >
    <form
      ref={dialogRef}
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      aria-describedby={descriptionId}
      aria-busy={executing}
      onSubmit={confirm}
      data-testid="control-action-dialog"
      className="flex max-h-[calc(100dvh-24px)] w-[min(560px,calc(100vw-24px))] flex-col overflow-hidden rounded-xl bg-zinc-950 text-zinc-200 shadow-2xl sm:max-h-[calc(100dvh-40px)] sm:w-[min(560px,calc(100vw-40px))]"
    >
      <header className="flex shrink-0 items-start gap-3 bg-zinc-900 px-4 py-4 sm:px-5">
        <div className={`grid size-9 shrink-0 place-items-center rounded-lg ${
          presentation.dangerous ? "bg-red-950 text-red-300" : "bg-cyan-950 text-cyan-300"
        }`}><ActionIcon className="size-4" aria-hidden="true" /></div>
        <div className="min-w-0 flex-1">
          <div className="text-[9px] font-semibold uppercase tracking-[0.14em] text-zinc-500">{presentation.eyebrow}</div>
          <h2 id={titleId} className="mt-1 text-sm font-semibold text-zinc-100">{presentation.title}</h2>
          <p id={descriptionId} className="mt-1 text-[11px] leading-relaxed text-zinc-400">{presentation.description}</p>
        </div>
        <button
          type="button"
          aria-label="관리 작업 창 닫기"
          onClick={onClose}
          className="grid size-8 shrink-0 place-items-center rounded-md text-zinc-500 hover:bg-zinc-800 hover:text-white focus-visible:bg-zinc-700 focus-visible:text-white focus-visible:outline-none"
        ><X className="size-4" aria-hidden="true" /></button>
      </header>

      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-4 sm:px-5">
        <section aria-label="실행 대상">
          <h3 className="mb-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-zinc-500">실행 대상</h3>
          <TargetSummary intent={intent} />
        </section>
        {preview && <ImpactPreview preview={preview} />}
        <div className="grid gap-3 sm:grid-cols-2">
          <DetailList title="예상되는 변화" items={presentation.effects} />
          <DetailList title="실행 전 확인" items={presentation.warnings} warning />
        </div>

        {requiresTypedConfirmation && <section className="rounded-lg bg-red-950/35 px-3 py-3">
          <label htmlFor={`${titleId}-confirmation`} className="text-[11px] font-medium text-red-200">
            취소 대상을 확인하려면 아래 문구를 입력하세요
          </label>
          <code className="mt-2 block select-all rounded bg-black/30 px-2.5 py-2 font-mono text-xs text-red-200">{confirmation}</code>
          <input
            id={`${titleId}-confirmation`}
            value={typedConfirmation}
            onChange={(event) => setTypedConfirmation(event.target.value)}
            autoComplete="off"
            spellCheck={false}
            placeholder={confirmation}
            aria-invalid={typedConfirmation.length > 0 && !confirmed}
            className="mt-2 h-9 w-full rounded-md bg-black/35 px-3 font-mono text-xs text-zinc-100 outline-none placeholder:text-zinc-700 focus:ring-1 focus:ring-red-500"
            data-testid="control-action-confirmation"
          />
        </section>}

        {error && <div
          id={errorId}
          role="alert"
          className="flex items-start gap-2 rounded-lg bg-red-950/45 px-3 py-2.5 text-[11px] leading-relaxed text-red-200"
        >
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
          <div className="min-w-0 flex-1">
            <div>{error}</div>
            {failure && <div className="mt-1.5 text-[10px] text-red-200/65">{failure.recoveryHint}</div>}
            {failure && onRecovery && <Button
              type="button"
              variant="ghost"
              className="mt-2 h-7 border border-red-900/50 px-2 text-[10px] text-red-100"
              disabled={executing || retrySeconds > 0}
              onClick={() => void onRecovery(failure)}
            >
              {failure.recoveryAction === "refresh" && <RefreshCw className="size-3" aria-hidden="true" />}
              {retrySeconds > 0 ? `${retrySeconds}초 후 재시도` : failure.recoveryLabel}
            </Button>}
          </div>
        </div>}
      </div>

      <footer className="flex shrink-0 flex-col-reverse gap-2 bg-zinc-900 px-4 py-3 sm:flex-row sm:justify-end sm:px-5">
        <Button
          key={intentKey}
          type="button"
          variant="ghost"
          autoFocus
          onClick={onClose}
          className="w-full sm:w-auto"
          data-testid="control-action-safe-cancel"
        >닫기</Button>
        <Button
          type="submit"
          variant={presentation.dangerous ? "danger" : "primary"}
          disabled={executing || !confirmed}
          aria-describedby={error ? errorId : undefined}
          className="w-full sm:w-auto"
          data-testid="control-action-submit"
        >
          {executing && <RefreshCw className="size-3 motion-safe:animate-spin" aria-hidden="true" />}
          {executing ? "요청 중…" : presentation.confirmLabel}
        </Button>
      </footer>
    </form>
  </div>, document.body);
}
