import { X } from "lucide-react";
import { createPortal } from "react-dom";
import type { KeyboardEvent, MouseEvent } from "react";
import type { GraphNode, NodeDetailResponse } from "../api/types";
import { MarkdownContent } from "./MarkdownContent";

interface Props {
  node: GraphNode;
  detail: NodeDetailResponse;
  onClose: () => void;
}

export function MarkdownDocumentDialog({ node, detail, onClose }: Props) {
  const closeFromBackdrop = (event: MouseEvent<HTMLDivElement>) => {
    if (event.target === event.currentTarget) onClose();
  };
  const closeFromKeyboard = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "Escape") return;
    event.preventDefault();
    event.stopPropagation();
    onClose();
  };

  return createPortal(<div
    className="fixed inset-0 z-[100] grid place-items-center bg-black/80 p-3 backdrop-blur-sm sm:p-5"
    onMouseDown={closeFromBackdrop}
    onKeyDownCapture={closeFromKeyboard}
    data-testid="markdown-dialog-backdrop"
  >
    <article
      role="dialog"
      aria-modal="true"
      aria-labelledby="markdown-dialog-title"
      data-testid="markdown-page-dialog"
      className="flex h-[calc(100dvh-24px)] max-h-[960px] w-[min(1120px,calc(100vw-24px))] flex-col overflow-hidden rounded-xl bg-zinc-950 text-zinc-200 shadow-2xl sm:h-[calc(100dvh-40px)] sm:w-[min(1120px,calc(100vw-40px))]"
    >
      <header className="flex shrink-0 items-start gap-3 bg-zinc-900 px-4 py-3 sm:px-6 sm:py-4">
        <span className="mt-1.5 size-3 shrink-0 rounded-full" style={{ backgroundColor: node.color }} />
        <div className="min-w-0 flex-1">
          <h1 id="markdown-dialog-title" className="truncate text-sm font-semibold text-zinc-100 sm:text-base" title={node.title}>{node.title}</h1>
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-zinc-500 sm:text-xs">
            <span>{node.type}</span><span>{node.sourceName}</span><span>{node.chunkCount} chunks</span>
            {detail.updatedAt && <span>Updated {new Date(detail.updatedAt).toLocaleString()}</span>}
          </div>
        </div>
        <button
          type="button"
          autoFocus
          aria-label="Close expanded page content"
          onClick={onClose}
          className="grid size-8 shrink-0 place-items-center rounded-md bg-black/25 text-zinc-400 hover:bg-zinc-700 hover:text-white focus-visible:bg-zinc-600 focus-visible:text-white focus-visible:outline-none"
        ><X className="size-4" /></button>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5 sm:px-10 sm:py-8">
        <MarkdownContent content={detail.content || "No text content"} testId="expanded-markdown-content" />
        {detail.contentTruncated && <div className="mt-8 rounded-md bg-amber-950/50 px-3 py-2 text-xs text-amber-200">Content is truncated after 64,000 characters.</div>}
      </div>
      <footer className="shrink-0 bg-zinc-900/80 px-4 py-2 text-[10px] text-zinc-600 sm:px-6">Read-only Markdown view · Esc or outside click to close</footer>
    </article>
  </div>, document.body);
}
