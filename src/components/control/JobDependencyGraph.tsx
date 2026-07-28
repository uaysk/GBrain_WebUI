import {
  AlertTriangle,
  CheckCircle2,
  CircleDashed,
  GitBranch,
  LoaderCircle,
  Workflow,
} from "lucide-react";
import { useId, useMemo } from "react";
import type {
  ControlJob,
  ControlJobStatus,
  ControlPhase,
  ControlPhaseStatus,
} from "../../types";
import { StatusBadge } from "./StatusBadge";

export interface ControlJobDependencyLink {
  parentId: number;
  childId: number;
}

export interface JobDependencyGraphProps {
  job: ControlJob;
  jobs?: ControlJob[];
  links?: ControlJobDependencyLink[];
  parentJob?: ControlJob | null;
  childJobs?: ControlJob[];
  onSelectJob?: (job: ControlJob) => void;
  className?: string;
}

function formatDuration(value: number): string {
  if (!value) return "—";
  if (value < 1_000) return `${Math.round(value)}ms`;
  if (value < 60_000) return `${(value / 1_000).toFixed(value < 10_000 ? 1 : 0)}초`;
  const minutes = Math.floor(value / 60_000);
  const seconds = Math.round((value % 60_000) / 1_000);
  return `${minutes}분 ${seconds}초`;
}

function phaseSummary(phase: ControlPhase): string {
  if (phase.summary) return phase.summary;
  if (phase.metrics.length) return `${phase.metrics.length}개 지표가 기록되었습니다.`;
  return "이 단계의 상세 보고서가 없습니다.";
}

function inferPhaseStatus(job: ControlJob, phaseName: string, index: number, total: number): ControlPhaseStatus {
  if (job.status === "completed") return "ok";
  if (job.status === "failed" || job.status === "dead") {
    const progressPhase = job.progress?.phase?.toLowerCase();
    if (progressPhase && phaseName.toLowerCase().includes(progressPhase)) return "fail";
    return index === Math.max(0, total - 1) ? "fail" : "unknown";
  }
  if (job.status === "active") {
    const progressPhase = job.progress?.phase?.toLowerCase();
    if (progressPhase && phaseName.toLowerCase().includes(progressPhase)) return "running";
    return index === 0 ? "running" : "unknown";
  }
  if (job.status === "waiting-children" || job.status === "waiting" || job.status === "delayed") {
    return index === 0 ? "running" : "unknown";
  }
  if (job.status === "cancelled" || job.status === "paused") return "skipped";
  return "unknown";
}

function fallbackPhases(job: ControlJob): ControlPhase[] {
  if (job.run?.phases.length) return job.run.phases;
  if (job.name !== "autopilot-cycle") return [];
  const phases = [
    { name: "sync", label: "Source 동기화" },
    { name: "extract", label: "관계 추출" },
    { name: "embed", label: "Embedding 갱신" },
  ];
  return phases.map((phase, index) => ({
    ...phase,
    status: inferPhaseStatus(job, phase.name, index, phases.length),
    durationMs: 0,
    summary: job.progress?.phase === phase.name && job.progress.message
      ? job.progress.message
      : "개별 하위 Job 정보가 없어 Quick Dream의 고정 단계로 표시합니다.",
    metrics: [],
    warnings: [],
  }));
}

function jobConcern(status: ControlJobStatus): number {
  if (status === "failed" || status === "dead") return 5;
  if (status === "delayed") return 4;
  if (status === "active") return 3;
  if (status === "waiting-children" || status === "waiting" || status === "paused") return 2;
  if (status === "unknown") return 1;
  return 0;
}

function phaseConcern(status: ControlPhaseStatus): number {
  if (status === "fail") return 5;
  if (status === "warn") return 4;
  if (status === "running") return 3;
  if (status === "unknown") return 2;
  if (status === "skipped") return 1;
  return 0;
}

function jobById(jobs: ControlJob[], id: number): ControlJob | undefined {
  return jobs.find((candidate) => candidate.id === id);
}

function uniqueJobs(jobs: Array<ControlJob | undefined>): ControlJob[] {
  const seen = new Set<number>();
  return jobs.filter((job): job is ControlJob => {
    if (!job || seen.has(job.id)) return false;
    seen.add(job.id);
    return true;
  });
}

function JobNode({
  job,
  selected = false,
  onSelect,
}: {
  job: ControlJob;
  selected?: boolean;
  onSelect?: (job: ControlJob) => void;
}) {
  const content = <>
    <div className="flex min-w-0 items-center gap-2">
      <Workflow className={`size-3.5 shrink-0 ${selected ? "text-cyan-300" : "text-zinc-500"}`} aria-hidden="true" />
      <strong className="min-w-0 flex-1 truncate text-[11px] font-medium text-zinc-200">{job.label}</strong>
      <StatusBadge status={job.status} />
    </div>
    <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1 pl-5 font-mono text-[9px] text-zinc-600">
      <span>#{job.id}</span>
      <span>{job.sourceId ?? "brain-wide"}</span>
      <span>{formatDuration(job.durationMs)}</span>
    </div>
    {job.progress?.message && <p className="mt-1.5 line-clamp-2 pl-5 text-[10px] leading-relaxed text-zinc-500">{job.progress.message}</p>}
  </>;
  const className = `block w-full rounded-lg px-3 py-2.5 text-left ${
    selected ? "bg-cyan-950/30 ring-1 ring-inset ring-cyan-900/70" : "bg-black/20"
  }`;
  if (!onSelect || selected) return <div className={className} aria-current={selected ? "true" : undefined}>{content}</div>;
  return <button
    type="button"
    className={`${className} transition-colors hover:bg-zinc-800 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-cyan-500`}
    onClick={() => onSelect(job)}
  >{content}</button>;
}

function PhaseNode({ phase, index }: { phase: ControlPhase; index: number }) {
  return <div className="rounded-lg bg-black/20 px-3 py-2.5">
    <div className="flex min-w-0 items-center gap-2">
      <span className="grid size-5 shrink-0 place-items-center rounded-full bg-zinc-800 font-mono text-[9px] text-zinc-500">{index + 1}</span>
      <strong className="min-w-0 flex-1 truncate text-[11px] font-medium text-zinc-200">{phase.label}</strong>
      <StatusBadge status={phase.status} />
    </div>
    <p className="mt-1.5 line-clamp-2 pl-7 text-[10px] leading-relaxed text-zinc-500">{phaseSummary(phase)}</p>
    <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1 pl-7 font-mono text-[9px] text-zinc-600">
      <span>{phase.name}</span>
      <span>{formatDuration(phase.durationMs)}</span>
      {!!phase.metrics.length && <span>{phase.metrics.length} metrics</span>}
    </div>
  </div>;
}

export function JobDependencyGraph({
  job,
  jobs = [],
  links = [],
  parentJob,
  childJobs = [],
  onSelectJob,
  className = "",
}: JobDependencyGraphProps) {
  const titleId = useId();
  const explicitParents = uniqueJobs([
    parentJob ?? undefined,
    ...links
      .filter((link) => link.childId === job.id)
      .map((link) => jobById(jobs, link.parentId)),
  ]);
  const explicitChildren = uniqueJobs([
    ...childJobs,
    ...links
      .filter((link) => link.parentId === job.id)
      .map((link) => jobById(jobs, link.childId)),
  ]);
  const hasExplicitDependencies = explicitParents.length > 0 || explicitChildren.length > 0;
  const phases = useMemo(() => hasExplicitDependencies ? [] : fallbackPhases(job), [hasExplicitDependencies, job]);
  const bottleneck = useMemo(() => {
    if (hasExplicitDependencies) {
      const candidates = explicitChildren
        .map((child) => ({ label: `${child.label} #${child.id}`, score: jobConcern(child.status), status: child.status }))
        .sort((left, right) => right.score - left.score);
      const candidate = candidates[0];
      if (candidate?.score) return {
        label: candidate.label,
        detail: candidate.status === "failed" || candidate.status === "dead"
          ? "실패한 하위 작업이 상위 작업 완료를 막고 있습니다."
          : candidate.status === "delayed"
            ? "지연된 하위 작업이 다음 단계 시작을 늦추고 있습니다."
            : candidate.status === "active"
              ? "현재 처리 중인 하위 작업입니다."
              : "하위 작업의 상태 전환을 기다리고 있습니다.",
        dangerous: candidate.score >= 4,
      };
      return null;
    }
    const candidates = phases
      .map((phase) => ({ label: phase.label, score: phaseConcern(phase.status), status: phase.status }))
      .sort((left, right) => right.score - left.score);
    const candidate = candidates[0];
    if (!candidate?.score) return null;
    return {
      label: candidate.label,
      detail: candidate.status === "fail" ? "실패한 단계에서 실행 흐름이 중단되었습니다."
        : candidate.status === "warn" ? "주의 상태인 단계의 결과를 확인하세요."
          : candidate.status === "running" ? "현재 처리 중인 단계입니다."
            : "이 단계의 확정된 실행 결과가 아직 없습니다.",
      dangerous: candidate.score >= 4,
    };
  }, [explicitChildren, hasExplicitDependencies, phases]);

  return <section
    className={`rounded-lg bg-zinc-900/55 px-3 py-3 ${className}`}
    aria-labelledby={titleId}
    data-testid="job-dependency-graph"
  >
    <header className="flex flex-wrap items-start gap-2">
      <div className="grid size-7 shrink-0 place-items-center rounded-md bg-zinc-800 text-zinc-400">
        <GitBranch className="size-3.5" aria-hidden="true" />
      </div>
      <div className="min-w-0 flex-1">
        <h3 id={titleId} className="text-[11px] font-semibold text-zinc-200">Job 실행 흐름</h3>
        <p className="mt-0.5 text-[9px] leading-relaxed text-zinc-600">
          {hasExplicitDependencies
            ? "관측된 부모·자식 Job 관계를 표시합니다."
            : phases.length
              ? "하위 Job 관계가 없어 보존된 실행 단계로 재구성했습니다."
              : "이 Job에는 부모·자식 관계나 단계 보고서가 없습니다."}
        </p>
      </div>
      <span className="rounded bg-black/20 px-2 py-1 text-[9px] text-zinc-500">
        {hasExplicitDependencies ? `${explicitParents.length + explicitChildren.length + 1} jobs` : `${phases.length} phases`}
      </span>
    </header>

    {bottleneck && <div className={`mt-3 flex items-start gap-2 rounded-lg px-3 py-2.5 ${
      bottleneck.dangerous ? "bg-red-950/35 text-red-200" : "bg-cyan-950/25 text-cyan-200"
    }`} role="status">
      {bottleneck.dangerous
        ? <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
        : <LoaderCircle className="mt-0.5 size-3.5 shrink-0 motion-safe:animate-spin" aria-hidden="true" />}
      <div>
        <strong className="text-[10px] font-medium">현재 병목 · {bottleneck.label}</strong>
        <p className="mt-0.5 text-[9px] leading-relaxed opacity-65">{bottleneck.detail}</p>
      </div>
    </div>}

    {hasExplicitDependencies ? <div className="mt-3" role="tree" aria-label={`Job #${job.id} 의존성`}>
      {!!explicitParents.length && <div role="group" aria-label="상위 Job" className="space-y-1.5">
        <div className="text-[9px] font-semibold uppercase tracking-[0.12em] text-zinc-600">Parent</div>
        {explicitParents.map((parent) => <div key={parent.id} role="treeitem" aria-level={1}>
          <JobNode job={parent} onSelect={onSelectJob} />
        </div>)}
      </div>}
      {!!explicitParents.length && <div className="ml-5 h-4 w-px bg-zinc-700" aria-hidden="true" />}
      <div role="treeitem" aria-level={explicitParents.length ? 2 : 1} aria-expanded={explicitChildren.length > 0}>
        <JobNode job={job} selected />
      </div>
      {!!explicitChildren.length && <div role="group" aria-label="하위 Job" className="ml-5 border-l border-zinc-700 pl-4 pt-3">
        <div className="mb-1.5 text-[9px] font-semibold uppercase tracking-[0.12em] text-zinc-600">Children</div>
        <div className="space-y-1.5">
          {explicitChildren.map((child) => <div key={child.id} role="treeitem" aria-level={explicitParents.length ? 3 : 2} className="relative">
            <span className="absolute -left-4 top-5 h-px w-4 bg-zinc-700" aria-hidden="true" />
            <JobNode job={child} onSelect={onSelectJob} />
          </div>)}
        </div>
      </div>}
    </div> : phases.length ? <div className="mt-3" role="tree" aria-label={`Job #${job.id} 단계`}>
      <div role="treeitem" aria-level={1} aria-expanded="true"><JobNode job={job} selected /></div>
      <div role="group" aria-label="실행 단계" className="ml-5 border-l border-zinc-700 pl-4 pt-3">
        <div className="space-y-1.5">
          {phases.map((phase, index) => <div key={`${phase.name}-${index}`} role="treeitem" aria-level={2} className="relative">
            <span className="absolute -left-4 top-5 h-px w-4 bg-zinc-700" aria-hidden="true" />
            <PhaseNode phase={phase} index={index} />
          </div>)}
        </div>
      </div>
    </div> : <div className="mt-3 flex items-center justify-center gap-2 rounded-lg bg-black/15 px-3 py-6 text-[10px] text-zinc-600">
      {job.status === "completed"
        ? <CheckCircle2 className="size-3.5 text-emerald-700" aria-hidden="true" />
        : <CircleDashed className="size-3.5" aria-hidden="true" />}
      단일 Job 상태만 표시할 수 있습니다.
    </div>}
  </section>;
}
