import { X } from "lucide-react";
import { useEffect, useRef, type KeyboardEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";

interface Props {
  open: boolean;
  title: string;
  children: ReactNode;
  onClose: () => void;
}

const FOCUSABLE = [
  "button:not([disabled])",
  "a[href]",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "summary",
  "[tabindex]:not([tabindex='-1'])",
].join(",");

export function MapBottomSheet({ open, title, children, onClose }: Props) {
  const sheetRef = useRef<HTMLElement>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return;
    restoreFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const frame = window.requestAnimationFrame(() => {
      const focusables = sheetRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE);
      (focusables?.[0] ?? sheetRef.current)?.focus();
    });
    return () => {
      window.cancelAnimationFrame(frame);
      restoreFocusRef.current?.focus();
      restoreFocusRef.current = null;
    };
  }, [open]);

  if (!open) return null;
  const handleKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      onClose();
      return;
    }
    if (event.key !== "Tab") return;
    const focusables = [...(sheetRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? [])];
    if (!focusables.length) {
      event.preventDefault();
      sheetRef.current?.focus();
      return;
    }
    const first = focusables[0]!;
    const last = focusables.at(-1)!;
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  return createPortal(<div
    className="fixed inset-0 z-[90] flex items-end bg-black/65 md:hidden"
    role="presentation"
    onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}
  >
    <section
      ref={sheetRef}
      role="dialog"
      aria-modal="true"
      aria-labelledby="map-sheet-title"
      tabIndex={-1}
      onKeyDown={handleKeyDown}
      className="max-h-[82dvh] w-full overflow-hidden rounded-t-2xl bg-zinc-950 text-zinc-200 shadow-2xl focus:outline-none"
    >
      <header className="flex min-h-14 items-center gap-3 border-b border-zinc-800 px-4">
        <h2 id="map-sheet-title" className="min-w-0 flex-1 truncate text-sm font-semibold">{title}</h2>
        <button type="button" aria-label={`${title} 닫기`} onClick={onClose} className="grid size-11 place-items-center rounded-lg bg-zinc-900 text-zinc-400 focus-visible:bg-zinc-700 focus-visible:text-white focus-visible:outline-none"><X className="size-4" /></button>
      </header>
      <div className="max-h-[calc(82dvh-56px)] overflow-y-auto p-3">{children}</div>
    </section>
  </div>, document.body);
}
