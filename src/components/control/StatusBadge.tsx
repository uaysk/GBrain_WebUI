import { AlertTriangle, Ban, CheckCircle2, CircleDashed, Clock3, LoaderCircle, XCircle } from "lucide-react";
import type { ControlJobStatus, ControlPhaseStatus } from "../../types";

type Status = ControlPhaseStatus | ControlJobStatus;

const PRESENTATION: Record<Status, { label: string; className: string; icon: typeof CheckCircle2 }> = {
  ok: { label: "정상", className: "bg-emerald-950/70 text-emerald-300", icon: CheckCircle2 },
  warn: { label: "주의", className: "bg-amber-950/70 text-amber-300", icon: AlertTriangle },
  fail: { label: "실패", className: "bg-red-950/70 text-red-300", icon: XCircle },
  skipped: { label: "건너뜀", className: "bg-zinc-800 text-zinc-400", icon: Ban },
  running: { label: "실행 중", className: "bg-cyan-950/70 text-cyan-300", icon: LoaderCircle },
  waiting: { label: "대기", className: "bg-sky-950/70 text-sky-300", icon: Clock3 },
  "waiting-children": { label: "하위 작업 대기", className: "bg-sky-950/70 text-sky-300", icon: Clock3 },
  paused: { label: "일시 정지", className: "bg-zinc-800 text-zinc-300", icon: Ban },
  active: { label: "실행 중", className: "bg-cyan-950/70 text-cyan-300", icon: LoaderCircle },
  completed: { label: "완료", className: "bg-emerald-950/70 text-emerald-300", icon: CheckCircle2 },
  failed: { label: "실패", className: "bg-red-950/70 text-red-300", icon: XCircle },
  delayed: { label: "지연", className: "bg-amber-950/70 text-amber-300", icon: Clock3 },
  dead: { label: "중단", className: "bg-red-950/70 text-red-300", icon: XCircle },
  cancelled: { label: "취소", className: "bg-zinc-800 text-zinc-400", icon: Ban },
  unknown: { label: "알 수 없음", className: "bg-zinc-800 text-zinc-400", icon: CircleDashed },
};

export function StatusBadge({ status, label }: { status: Status; label?: string }) {
  const presentation = PRESENTATION[status];
  const Icon = presentation.icon;
  const spins = status === "running" || status === "active";
  return <span className={`inline-flex h-6 shrink-0 items-center gap-1 rounded-full px-2 text-[10px] font-medium ${presentation.className}`}>
    <Icon className={`size-3 ${spins ? "motion-safe:animate-spin" : ""}`} aria-hidden="true" />
    {label ?? presentation.label}
  </span>;
}
