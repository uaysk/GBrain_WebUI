import {
  AlertTriangle,
  ArrowRight,
  BellRing,
  CheckCircle2,
  CircleAlert,
  CircleDot,
  Eye,
  Inbox,
} from "lucide-react";
import type { ControlJobStatus } from "../../types";
import { Button } from "../ui/button";
import { StatusBadge } from "./StatusBadge";

export type OperationsAttentionPriority = "critical" | "high" | "medium" | "low";

export interface OperationsAttentionItem {
  id: string;
  priority: OperationsAttentionPriority;
  title: string;
  description: string;
  status?: ControlJobStatus;
  sourceId?: string;
  jobId?: number;
  value?: string;
  actionLabel?: string;
  actionVariant?: "default" | "primary" | "danger";
  viewLabel?: string;
  actionDisabled?: boolean;
  actionDisabledReason?: string;
}

export interface OperationsInboxProps {
  items: OperationsAttentionItem[];
  onAction?: (item: OperationsAttentionItem) => void;
  onView?: (item: OperationsAttentionItem) => void;
  emptyTitle?: string;
  emptyDescription?: string;
}

const PRIORITY_ORDER: OperationsAttentionPriority[] = ["critical", "high", "medium", "low"];

const PRIORITY_PRESENTATION: Record<OperationsAttentionPriority, {
  label: string;
  description: string;
  icon: typeof AlertTriangle;
  iconClassName: string;
  countClassName: string;
  itemClassName: string;
}> = {
  critical: {
    label: "즉시 확인",
    description: "실패 또는 중단된 운영 항목",
    icon: CircleAlert,
    iconClassName: "text-red-300",
    countClassName: "bg-red-950/70 text-red-300",
    itemClassName: "bg-red-950/20 before:bg-red-500",
  },
  high: {
    label: "우선 처리",
    description: "서비스 품질에 영향을 줄 수 있는 항목",
    icon: AlertTriangle,
    iconClassName: "text-amber-300",
    countClassName: "bg-amber-950/70 text-amber-300",
    itemClassName: "bg-amber-950/15 before:bg-amber-500",
  },
  medium: {
    label: "확인 권장",
    description: "가까운 시일 내 점검할 항목",
    icon: BellRing,
    iconClassName: "text-sky-300",
    countClassName: "bg-sky-950/70 text-sky-300",
    itemClassName: "bg-sky-950/10 before:bg-sky-500",
  },
  low: {
    label: "참고",
    description: "운영 상태를 개선할 수 있는 항목",
    icon: CircleDot,
    iconClassName: "text-zinc-400",
    countClassName: "bg-zinc-800 text-zinc-300",
    itemClassName: "bg-black/15 before:bg-zinc-600",
  },
};

function targetLabel(item: OperationsAttentionItem): string | null {
  if (item.jobId !== undefined) return `Job #${item.jobId}`;
  if (item.sourceId) return `Source ${item.sourceId}`;
  return null;
}

function AttentionItem({
  item,
  onAction,
  onView,
}: {
  item: OperationsAttentionItem;
  onAction?: (item: OperationsAttentionItem) => void;
  onView?: (item: OperationsAttentionItem) => void;
}) {
  const presentation = PRIORITY_PRESENTATION[item.priority];
  const target = targetLabel(item);
  const showAction = Boolean(item.actionLabel && onAction);
  const showView = Boolean(item.viewLabel && onView);

  return <li
    className={`relative overflow-hidden rounded-lg p-3 before:absolute before:inset-y-0 before:left-0 before:w-0.5 ${presentation.itemClassName}`}
    data-priority={item.priority}
  >
    <div className="flex min-w-0 items-start gap-3">
      <presentation.icon className={`mt-0.5 size-4 shrink-0 ${presentation.iconClassName}`} aria-hidden="true" />
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <h4 className="min-w-0 flex-1 text-xs font-medium leading-relaxed text-zinc-100">{item.title}</h4>
          {item.status && <StatusBadge status={item.status} />}
          {item.value && <span className="shrink-0 rounded-md bg-black/25 px-2 py-1 font-mono text-[10px] text-zinc-300">{item.value}</span>}
        </div>
        <p className="mt-1 text-[11px] leading-relaxed text-zinc-400">{item.description}</p>
        {target && <div className="mt-2 break-all font-mono text-[10px] text-zinc-600">{target}</div>}
        {(showAction || showView) && <div className="mt-3 flex flex-wrap gap-2">
          {showAction && <Button
            variant={item.actionVariant ?? "default"}
            className="max-w-full"
            disabled={item.actionDisabled}
            title={item.actionDisabled ? item.actionDisabledReason : undefined}
            onClick={() => onAction?.(item)}
            aria-label={`${item.title}: ${item.actionLabel}`}
          >
            <span className="truncate">{item.actionLabel}</span>
            <ArrowRight className="size-3.5 shrink-0" aria-hidden="true" />
          </Button>}
          {showView && <Button
            variant="ghost"
            className="max-w-full"
            onClick={() => onView?.(item)}
            aria-label={`${item.title}: ${item.viewLabel}`}
          >
            <Eye className="size-3.5 shrink-0" aria-hidden="true" />
            <span className="truncate">{item.viewLabel}</span>
          </Button>}
        </div>}
      </div>
    </div>
  </li>;
}

export function OperationsInbox({
  items,
  onAction,
  onView,
  emptyTitle = "지금 확인할 운영 항목이 없습니다",
  emptyDescription = "실패, 지연, 오래된 Source 또는 Embedding 누락이 감지되면 여기에 우선순위별로 표시됩니다.",
}: OperationsInboxProps) {
  const groups = PRIORITY_ORDER
    .map((priority) => ({
      priority,
      items: items.filter((item) => item.priority === priority),
    }))
    .filter((group) => group.items.length > 0);

  return <section
    className="overflow-hidden rounded-xl bg-zinc-900/70"
    aria-labelledby="operations-inbox-title"
    data-testid="operations-inbox"
  >
    <header className="flex flex-wrap items-center gap-3 bg-zinc-900 px-4 py-3">
      <div className="grid size-8 shrink-0 place-items-center rounded-lg bg-zinc-800 text-cyan-300">
        <Inbox className="size-4" aria-hidden="true" />
      </div>
      <div className="min-w-0 flex-1">
        <h2 id="operations-inbox-title" className="text-xs font-semibold text-zinc-100">운영 인박스</h2>
        <p className="mt-0.5 text-[10px] text-zinc-500">먼저 확인할 항목을 영향도 순서로 정리합니다.</p>
      </div>
      {!!items.length && <span
        className="rounded-full bg-zinc-800 px-2.5 py-1 font-mono text-[10px] text-zinc-300"
        aria-label={`확인할 운영 항목 ${items.length}개`}
      >
        {items.length}
      </span>}
    </header>

    {!groups.length ? <div className="grid min-h-44 place-items-center px-5 py-8 text-center" role="status">
      <div>
        <span className="mx-auto grid size-10 place-items-center rounded-full bg-emerald-950/50 text-emerald-300">
          <CheckCircle2 className="size-5" aria-hidden="true" />
        </span>
        <h3 className="mt-3 text-xs font-medium text-zinc-200">{emptyTitle}</h3>
        <p className="mx-auto mt-1.5 max-w-md text-[11px] leading-relaxed text-zinc-500">{emptyDescription}</p>
      </div>
    </div> : <div className="space-y-4 p-3 sm:p-4">
      {groups.map(({ priority, items: groupItems }) => {
        const presentation = PRIORITY_PRESENTATION[priority];
        return <section key={priority} aria-labelledby={`operations-priority-${priority}`}>
          <div className="mb-2 flex min-w-0 items-center gap-2 px-1">
            <presentation.icon className={`size-3.5 shrink-0 ${presentation.iconClassName}`} aria-hidden="true" />
            <h3 id={`operations-priority-${priority}`} className="text-[10px] font-semibold uppercase tracking-[0.12em] text-zinc-300">
              {presentation.label}
            </h3>
            <span className={`rounded-full px-1.5 py-0.5 font-mono text-[9px] ${presentation.countClassName}`}>{groupItems.length}</span>
            <span className="hidden truncate text-[10px] text-zinc-600 sm:inline">{presentation.description}</span>
          </div>
          <ul className="grid gap-2 lg:grid-cols-2" aria-label={`${presentation.label} 항목`}>
            {groupItems.map((item) => <AttentionItem
              key={item.id}
              item={item}
              onAction={onAction}
              onView={onView}
            />)}
          </ul>
        </section>;
      })}
    </div>}
  </section>;
}
