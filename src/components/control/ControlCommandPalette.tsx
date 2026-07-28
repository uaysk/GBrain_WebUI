import {
  Command,
  DatabaseZap,
  Search,
  Workflow,
  X,
} from "lucide-react";
import { createPortal } from "react-dom";
import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type MouseEvent,
} from "react";
import type { ControlJob, ControlSourceStatus } from "../../types";
import { Button } from "../ui/button";
import { StatusBadge } from "./StatusBadge";

export type ControlCommandSelection =
  | { kind: "source"; source: ControlSourceStatus }
  | { kind: "job"; job: ControlJob };

export interface ControlCommandPaletteProps {
  sources: ControlSourceStatus[];
  jobs: ControlJob[];
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  onSelectSource: (source: ControlSourceStatus) => void;
  onSelectJob: (job: ControlJob) => void;
  showTrigger?: boolean;
  maxResults?: number;
}

interface PaletteItem {
  key: string;
  label: string;
  secondary: string;
  searchable: string;
  selection: ControlCommandSelection;
}

function normalize(value: string): string {
  return value.trim().toLocaleLowerCase("ko-KR");
}

function itemScore(item: PaletteItem, query: string): number {
  if (!query) return 10;
  const label = normalize(item.label);
  const secondary = normalize(item.secondary);
  if (label === query) return 0;
  if (label.startsWith(query)) return 1;
  if (secondary.startsWith(query)) return 2;
  if (label.includes(query)) return 3;
  if (secondary.includes(query)) return 4;
  if (item.searchable.includes(query)) return 5;
  return Number.POSITIVE_INFINITY;
}

function jobTimestamp(job: ControlJob): number {
  const value = job.finishedAt ?? job.startedAt ?? job.createdAt;
  return value ? new Date(value).getTime() : 0;
}

function formatDate(value: string | null): string {
  if (!value) return "기록 없음";
  return new Date(value).toLocaleString("ko-KR", { dateStyle: "short", timeStyle: "short" });
}

export function ControlCommandPalette({
  sources,
  jobs,
  open,
  defaultOpen = false,
  onOpenChange,
  onSelectSource,
  onSelectJob,
  showTrigger = true,
  maxResults = 14,
}: ControlCommandPaletteProps) {
  const [internalOpen, setInternalOpen] = useState(defaultOpen);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const dialogRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const onOpenChangeRef = useRef(onOpenChange);
  const onSelectSourceRef = useRef(onSelectSource);
  const onSelectJobRef = useRef(onSelectJob);
  const titleId = useId();
  const listboxId = useId();
  const isControlled = open !== undefined;
  const visible = open ?? internalOpen;

  useEffect(() => {
    onOpenChangeRef.current = onOpenChange;
    onSelectSourceRef.current = onSelectSource;
    onSelectJobRef.current = onSelectJob;
  }, [onOpenChange, onSelectJob, onSelectSource]);

  const setVisible = useCallback((next: boolean) => {
    if (!isControlled) setInternalOpen(next);
    onOpenChangeRef.current?.(next);
  }, [isControlled]);

  useEffect(() => {
    const openFromShortcut = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.altKey || event.key.toLowerCase() !== "k") return;
      event.preventDefault();
      setVisible(!visible);
    };
    window.addEventListener("keydown", openFromShortcut);
    return () => window.removeEventListener("keydown", openFromShortcut);
  }, [setVisible, visible]);

  const allItems = useMemo<PaletteItem[]>(() => {
    const sourceItems = [...sources]
      .sort((left, right) => left.name.localeCompare(right.name, "ko"))
      .map((source) => ({
        key: `source-${source.id}`,
        label: source.name,
        secondary: `${source.id} ${source.pages} pages ${source.embeddingCoveragePct.toFixed(1)}% embedded`,
        searchable: normalize(`${source.name} ${source.id} source pages chunks embedding ${source.stalenessClass}`),
        selection: { kind: "source", source } as const,
      }));
    const jobItems = [...jobs]
      .sort((left, right) => jobTimestamp(right) - jobTimestamp(left))
      .map((job) => ({
        key: `job-${job.id}`,
        label: job.label,
        secondary: `#${job.id} ${job.sourceId ?? "brain-wide"} ${job.status}`,
        searchable: normalize(`${job.label} ${job.name} #${job.id} ${job.sourceId ?? ""} ${job.status} job`),
        selection: { kind: "job", job } as const,
      }));
    return [...sourceItems, ...jobItems];
  }, [jobs, sources]);
  const results = useMemo(() => {
    const normalizedQuery = normalize(query);
    return allItems
      .map((item, order) => ({ item, order, score: itemScore(item, normalizedQuery) }))
      .filter((candidate) => Number.isFinite(candidate.score))
      .sort((left, right) => left.score - right.score || left.order - right.order)
      .slice(0, Math.max(1, maxResults))
      .map((candidate) => candidate.item);
  }, [allItems, maxResults, query]);

  useEffect(() => {
    setActiveIndex(0);
  }, [query, visible]);

  useEffect(() => {
    if (!visible) return;
    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    requestAnimationFrame(() => inputRef.current?.focus());
    const handleModalKeys = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        setVisible(false);
        return;
      }
      if (event.key !== "Tab" || !dialogRef.current) return;
      const elements = [...dialogRef.current.querySelectorAll<HTMLElement>(
        'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [href], [tabindex]:not([tabindex="-1"])',
      )].filter((element) => !element.hasAttribute("hidden"));
      if (!elements.length) return;
      const first = elements[0];
      const last = elements[elements.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", handleModalKeys, true);
    return () => {
      window.removeEventListener("keydown", handleModalKeys, true);
      previouslyFocused?.focus({ preventScroll: true });
    };
  }, [setVisible, visible]);

  const select = useCallback((item: PaletteItem) => {
    setVisible(false);
    setQuery("");
    if (item.selection.kind === "source") onSelectSourceRef.current(item.selection.source);
    else onSelectJobRef.current(item.selection.job);
  }, [setVisible]);

  const selectActive = () => {
    const item = results[activeIndex];
    if (item) select(item);
  };
  const handleInputKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveIndex((current) => results.length ? (current + 1) % results.length : 0);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((current) => results.length ? (current - 1 + results.length) % results.length : 0);
    } else if (event.key === "Home") {
      event.preventDefault();
      setActiveIndex(0);
    } else if (event.key === "End") {
      event.preventDefault();
      setActiveIndex(Math.max(0, results.length - 1));
    } else if (event.key === "Enter") {
      event.preventDefault();
      selectActive();
    }
  };
  const closeFromBackdrop = (event: MouseEvent<HTMLDivElement>) => {
    if (event.target === event.currentTarget) setVisible(false);
  };

  return <>
    {showTrigger && <Button
      type="button"
      variant="ghost"
      onClick={() => setVisible(true)}
      aria-haspopup="dialog"
      aria-expanded={visible}
      aria-keyshortcuts="Control+K Meta+K"
      title="Source 또는 Job 검색"
    >
      <Search className="size-3.5" aria-hidden="true" />
      검색
      <kbd className="ml-1 hidden rounded bg-black/25 px-1.5 py-0.5 font-mono text-[9px] text-zinc-500 sm:inline">⌘K</kbd>
    </Button>}

    {visible && typeof document !== "undefined" && createPortal(<div
      className="fixed inset-0 z-[120] flex items-start justify-center bg-black/75 px-3 pt-[max(8dvh,24px)] backdrop-blur-sm sm:px-5 sm:pt-[14dvh]"
      onMouseDown={closeFromBackdrop}
      data-testid="control-command-palette-backdrop"
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="flex max-h-[min(680px,82dvh)] w-[min(680px,calc(100vw-24px))] flex-col overflow-hidden rounded-xl bg-zinc-950 text-zinc-200 shadow-2xl ring-1 ring-zinc-800 sm:w-[min(680px,calc(100vw-40px))]"
        data-testid="control-command-palette"
      >
        <h2 id={titleId} className="sr-only">Source와 Job 빠른 검색</h2>
        <div className="flex shrink-0 items-center gap-3 bg-zinc-900 px-3 py-3 sm:px-4">
          <Search className="size-4 shrink-0 text-zinc-500" aria-hidden="true" />
          <input
            ref={inputRef}
            type="search"
            role="combobox"
            aria-expanded="true"
            aria-controls={listboxId}
            aria-autocomplete="list"
            aria-activedescendant={results.length ? `${listboxId}-${activeIndex}` : undefined}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={handleInputKeyDown}
            placeholder="Source 이름, Job ID 또는 상태 검색…"
            autoComplete="off"
            spellCheck={false}
            className="h-8 min-w-0 flex-1 bg-transparent text-sm text-zinc-100 outline-none placeholder:text-zinc-600"
          />
          {query && <button
            type="button"
            onClick={() => setQuery("")}
            aria-label="검색어 지우기"
            className="grid size-7 shrink-0 place-items-center rounded-md text-zinc-600 hover:bg-zinc-800 hover:text-zinc-300 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-cyan-500"
          ><X className="size-3.5" aria-hidden="true" /></button>}
          <button
            type="button"
            onClick={() => setVisible(false)}
            aria-label="검색 닫기"
            className="hidden h-7 shrink-0 items-center rounded-md bg-black/20 px-2 font-mono text-[9px] text-zinc-500 hover:bg-zinc-800 hover:text-zinc-300 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-cyan-500 sm:inline-flex"
          >Esc</button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-2 sm:p-3">
          {results.length ? <ul id={listboxId} role="listbox" aria-label="검색 결과" className="space-y-1">
            {results.map((item, index) => {
              const selected = activeIndex === index;
              return <li key={item.key} role="presentation">
                <button
                  id={`${listboxId}-${index}`}
                  type="button"
                  role="option"
                  aria-selected={selected}
                  tabIndex={-1}
                  onMouseEnter={() => setActiveIndex(index)}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => select(item)}
                  className={`flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left ${
                    selected ? "bg-zinc-700/80" : "hover:bg-zinc-800/70"
                  }`}
                >
                  <div className={`grid size-8 shrink-0 place-items-center rounded-md ${
                    item.selection.kind === "source" ? "bg-cyan-950 text-cyan-300" : "bg-zinc-800 text-zinc-400"
                  }`}>
                    {item.selection.kind === "source"
                      ? <DatabaseZap className="size-3.5" aria-hidden="true" />
                      : <Workflow className="size-3.5" aria-hidden="true" />}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <strong className="truncate text-[11px] font-medium text-zinc-200">{item.label}</strong>
                      <span className="shrink-0 rounded bg-black/20 px-1.5 py-0.5 text-[8px] font-medium uppercase tracking-wide text-zinc-600">
                        {item.selection.kind === "source" ? "Source" : "Job"}
                      </span>
                    </div>
                    <div className="mt-1 truncate font-mono text-[9px] text-zinc-600">{item.secondary}</div>
                  </div>
                  {item.selection.kind === "source"
                    ? <span className={`shrink-0 text-[9px] ${
                      item.selection.source.stalenessClass === "fresh" ? "text-emerald-400"
                        : item.selection.source.stalenessClass === "stale" ? "text-red-400" : "text-amber-400"
                    }`}>{item.selection.source.stalenessClass}</span>
                    : <StatusBadge status={item.selection.job.status} />}
                </button>
              </li>;
            })}
          </ul> : <div id={listboxId} role="listbox" className="grid min-h-40 place-items-center px-5 text-center">
            <div>
              <Command className="mx-auto size-6 text-zinc-700" aria-hidden="true" />
              <p className="mt-3 text-xs text-zinc-500">일치하는 Source 또는 Job이 없습니다.</p>
              <p className="mt-1 text-[10px] text-zinc-700">이름, Source ID, Job 번호나 상태를 바꿔 검색해 보세요.</p>
            </div>
          </div>}
        </div>

        <footer className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-1 bg-zinc-900 px-4 py-2 text-[9px] text-zinc-600">
          <span><kbd className="font-mono text-zinc-500">↑↓</kbd> 이동</span>
          <span><kbd className="font-mono text-zinc-500">Enter</kbd> 선택</span>
          <span><kbd className="font-mono text-zinc-500">Esc</kbd> 닫기</span>
          <span className="ml-auto hidden sm:inline">{sources.length} sources · {jobs.length} jobs</span>
        </footer>
      </div>
    </div>, document.body)}
  </>;
}
