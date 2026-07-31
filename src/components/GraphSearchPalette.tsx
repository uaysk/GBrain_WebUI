import { Boxes, FileText, Search, X } from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import type { GraphSearchIndex, GraphSearchResult } from "../graph/graph-search-index";
import { communityLabelTitle } from "../graph/community-label";

interface Props {
  index: GraphSearchIndex | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelect: (result: GraphSearchResult) => void;
}

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName);
}

export function GraphSearchPalette({ index, open, onOpenChange, onSelect }: Props) {
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(null);
  const listboxId = useId();
  const results = useMemo(() => index?.search(query) ?? [], [index, query]);

  useEffect(() => {
    const onShortcut = (event: globalThis.KeyboardEvent) => {
      const commandSearch = (event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k";
      const slashSearch = event.key === "/" && !event.metaKey && !event.ctrlKey && !event.altKey && !isTypingTarget(event.target);
      if (!commandSearch && !slashSearch) return;
      event.preventDefault();
      onOpenChange(true);
    };
    window.addEventListener("keydown", onShortcut);
    return () => window.removeEventListener("keydown", onShortcut);
  }, [onOpenChange]);

  useEffect(() => {
    if (!open) return;
    restoreFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setQuery("");
    setActiveIndex(0);
    const frame = window.requestAnimationFrame(() => inputRef.current?.focus());
    return () => {
      window.cancelAnimationFrame(frame);
      restoreFocusRef.current?.focus();
      restoreFocusRef.current = null;
    };
  }, [open]);

  useEffect(() => setActiveIndex(0), [query, index]);
  useEffect(() => {
    if (activeIndex < results.length) return;
    setActiveIndex(Math.max(0, results.length - 1));
  }, [activeIndex, results.length]);
  useEffect(() => {
    if (!open || !results[activeIndex]) return;
    document.getElementById(`${listboxId}-${activeIndex}`)?.scrollIntoView({ block: "nearest" });
  }, [activeIndex, listboxId, open, results]);

  if (!open) return null;
  const choose = (result: GraphSearchResult) => {
    onSelect(result);
    onOpenChange(false);
  };
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      onOpenChange(false);
    } else if (event.key === "ArrowDown") {
      event.preventDefault();
      if (results.length) setActiveIndex((current) => Math.min(results.length - 1, current + 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((current) => Math.max(0, current - 1));
    } else if (event.key === "Home") {
      event.preventDefault();
      setActiveIndex(0);
    } else if (event.key === "End") {
      event.preventDefault();
      setActiveIndex(Math.max(0, results.length - 1));
    } else if (event.key === "Enter" && results[activeIndex]) {
      event.preventDefault();
      choose(results[activeIndex]);
    } else if (event.key === "Tab") {
      // The palette intentionally has a tiny focus loop: input -> close -> input.
      const close = document.querySelector<HTMLElement>("[data-graph-search-close]");
      if (event.shiftKey) {
        event.preventDefault();
        close?.focus();
      }
    }
  };

  return createPortal(<div
    className="fixed inset-0 z-[100] flex justify-center bg-black/75 px-3 pt-[min(14dvh,120px)] backdrop-blur-sm"
    onMouseDown={(event) => { if (event.target === event.currentTarget) onOpenChange(false); }}
  >
    <section role="dialog" aria-modal="true" aria-labelledby="graph-search-title" className="h-fit max-h-[72dvh] w-full max-w-2xl overflow-hidden rounded-xl bg-zinc-950 shadow-2xl">
      <h2 id="graph-search-title" className="sr-only">Memory Map 검색</h2>
      <div className="flex min-h-14 items-center gap-3 border-b border-zinc-800 px-3">
        <Search className="size-4 shrink-0 text-cyan-400" />
        <input
          ref={inputRef}
          role="combobox"
          aria-expanded="true"
          aria-controls={listboxId}
          aria-autocomplete="list"
          aria-activedescendant={results[activeIndex] ? `${listboxId}-${activeIndex}` : undefined}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={onKeyDown}
          placeholder="제목, slug, source, type, community 검색"
          className="h-12 min-w-0 flex-1 bg-transparent text-sm text-zinc-100 outline-none placeholder:text-zinc-600"
        />
        <button
          type="button"
          data-graph-search-close
          aria-label="검색 닫기"
          onClick={() => onOpenChange(false)}
          onKeyDown={(event) => {
            if (event.key === "Escape") onOpenChange(false);
            if (event.key === "Tab") { event.preventDefault(); inputRef.current?.focus(); }
          }}
          className="grid size-10 place-items-center rounded-lg bg-zinc-900 text-zinc-400 hover:bg-zinc-800 focus-visible:bg-zinc-700 focus-visible:text-white focus-visible:outline-none"
        ><X className="size-4" /></button>
      </div>
      <div className="flex items-center justify-between px-3 py-2 text-[10px] text-zinc-600">
        <span>{query.trim() ? `${results.length}개 결과` : "최근 페이지"}</span>
        <span className="hidden sm:inline">↑↓ 이동 · Enter 선택 · Esc 닫기</span>
      </div>
      <div id={listboxId} role="listbox" aria-label="Memory Map 검색 결과" className="max-h-[calc(72dvh-94px)] overflow-y-auto px-2 pb-2">
        {!results.length && <div className="px-3 py-10 text-center text-xs text-zinc-600">일치하는 페이지나 community가 없습니다.</div>}
        {results.map((result, resultIndex) => {
          const active = resultIndex === activeIndex;
          const subtitle = result.kind === "node"
            ? `${result.node.sourceName} · ${result.node.type} · ${result.node.slug}`
            : `${result.community.count} nodes · ${result.community.kind}`;
          return <button
            id={`${listboxId}-${resultIndex}`}
            key={result.key}
            type="button"
            role="option"
            aria-selected={active}
            tabIndex={-1}
            onMouseEnter={() => setActiveIndex(resultIndex)}
            onClick={() => choose(result)}
            className={`mb-1 flex min-h-12 w-full items-center gap-3 rounded-lg px-3 py-2 text-left last:mb-0 ${active ? "bg-cyan-950/70 text-white" : "bg-zinc-900/55 text-zinc-300 hover:bg-zinc-800"}`}
          >
            {result.kind === "node" ? <FileText className="size-4 shrink-0 text-cyan-400" /> : <Boxes className="size-4 shrink-0 text-fuchsia-400" />}
            <span className="min-w-0 flex-1">
              <span className="block truncate text-xs font-medium">{result.kind === "community" ? communityLabelTitle(result.label) : result.label}</span>
              <span className="mt-0.5 block truncate text-[10px] text-zinc-500">{subtitle}</span>
            </span>
            <span className="shrink-0 rounded bg-black/25 px-1.5 py-0.5 text-[9px] uppercase text-zinc-500">{result.match}</span>
          </button>;
        })}
      </div>
    </section>
  </div>, document.body);
}
