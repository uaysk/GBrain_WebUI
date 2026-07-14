import { useCallback, useEffect, useRef, useState } from "react";
import { Box, Database, Focus, LogOut, Map as MapIcon, RefreshCw, RotateCcw, Tag, Waypoints } from "lucide-react";
import { Legend } from "./components/Legend";
import { Button } from "./components/ui/button";
import { Tooltip } from "./components/ui/tooltip";
import { MemoryGraph, type GraphControls } from "./graph/MemoryGraph";
import type { GraphResponse, StatusResponse } from "./types";

async function json<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  if (!response.ok) throw new Error(`Request failed (${response.status})`);
  return response.json() as Promise<T>;
}

function Metric({ label, value }: { label: string; value: string | number }) {
  return <div className="flex min-w-fit items-baseline gap-1.5"><span className="text-[10px] uppercase tracking-[0.1em] text-zinc-500">{label}</span><strong className="font-mono text-xs font-medium text-zinc-100">{value}</strong></div>;
}

export default function App() {
  const controls = useRef<GraphControls>(null);
  const [graph, setGraph] = useState<GraphResponse | null>(null);
  const [status, setStatus] = useState<StatusResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<"3d" | "2d">("3d");
  const [labelsOn, setLabelsOn] = useState(true);
  const [semanticOn, setSemanticOn] = useState(true);
  const [explicitOn, setExplicitOn] = useState(true);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [nextStatus, nextGraph] = await Promise.all([json<StatusResponse>("/api/status"), json<GraphResponse>("/api/graph")]);
      setStatus(nextStatus); setGraph(nextGraph);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "데이터를 불러올 수 없습니다."); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const rebuild = async () => {
    setRefreshing(true); setError(null);
    try {
      const next = await json<GraphResponse>("/api/graph/rebuild", { method: "POST" });
      setGraph(next); setSelectedId(null);
      setStatus(await json<StatusResponse>("/api/status"));
    } catch (reason) { setError(reason instanceof Error ? reason.message : "새로고침에 실패했습니다."); }
    finally { setRefreshing(false); }
  };
  const counts = graph?.counts ?? status?.counts;

  return (
    <main className="flex h-dvh w-full min-w-0 flex-col overflow-hidden bg-[#080808] text-zinc-100">
      <header className="z-20 flex min-h-16 shrink-0 flex-wrap items-center gap-x-4 gap-y-2 border-b border-zinc-800 bg-[#0b0b0b] px-4 py-2.5">
        <div className="mr-auto flex min-w-fit items-center gap-3">
          <div className="flex size-8 items-center justify-center rounded-md border border-zinc-700 bg-zinc-900"><Waypoints className="size-4" /></div>
          <div><h1 className="text-sm font-semibold tracking-tight sm:text-base">GBrain {viewMode.toUpperCase()} Memory Map</h1><p className="text-[10px] text-zinc-500">Read-only semantic memory space</p></div>
        </div>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
          <div className="flex items-center gap-1.5 text-xs text-zinc-400" data-testid="db-status"><span className={`size-2 rounded-full ${status?.connected ? "bg-emerald-500" : "bg-red-500"}`} /><Database className="size-3.5" />{status?.connected ? "DB connected" : "DB unavailable"}</div>
          <Metric label="Pages" value={counts?.pages ?? "—"} /><Metric label="Chunks" value={counts?.chunks ?? "—"} /><Metric label="Links" value={counts?.links ?? "—"} /><Metric label="Coverage" value={counts ? `${(counts.embeddingCoverage * 100).toFixed(1)}%` : "—"} />
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <Tooltip content={`${viewMode === "3d" ? "충돌 없는 평면 layout" : "원래 공간 layout"}으로 모핑합니다`}><Button
            data-testid="view-mode-toggle"
            aria-label={`${viewMode === "3d" ? "2D" : "3D"} 맵으로 전환`}
            onClick={() => setViewMode((mode) => mode === "3d" ? "2d" : "3d")}
          >{viewMode === "3d" ? <MapIcon className="size-3.5" /> : <Box className="size-3.5" />}<span>{viewMode === "3d" ? "2D map" : "3D map"}</span></Button></Tooltip>
          <Tooltip content="모든 노드를 화면에 맞춥니다"><Button onClick={() => controls.current?.fit()}><Focus className="size-3.5" /><span className="hidden xl:inline">Fit graph</span></Button></Tooltip>
          <Tooltip content="기본 카메라 위치로 돌아갑니다"><Button onClick={() => controls.current?.reset()}><RotateCcw className="size-3.5" /><span className="hidden xl:inline">Reset camera</span></Button></Tooltip>
          <Button variant={labelsOn ? "active" : "default"} onClick={() => setLabelsOn((v) => !v)}><Tag className="size-3.5" />Labels {labelsOn ? "on" : "off"}</Button>
          <Button variant={semanticOn ? "active" : "default"} onClick={() => setSemanticOn((v) => !v)}><span className="size-2 rounded-full bg-cyan-500" />Semantic {semanticOn ? "on" : "off"}</Button>
          <Button variant={explicitOn ? "active" : "default"} onClick={() => setExplicitOn((v) => !v)}><span className="size-2 rounded-full bg-amber-500" />Explicit {explicitOn ? "on" : "off"}</Button>
          <Tooltip content="DB에서 graph snapshot을 다시 생성합니다"><Button onClick={() => void rebuild()} disabled={refreshing}><RefreshCw className={`size-3.5 ${refreshing ? "animate-spin" : ""}`} /><span className="hidden sm:inline">데이터 새로고침</span></Button></Tooltip>
          <form method="post" action="/auth/logout"><Tooltip content="인증 세션을 종료합니다"><Button type="submit" size="icon" aria-label="로그아웃"><LogOut className="size-3.5" /></Button></Tooltip></form>
        </div>
      </header>
      <section className="relative min-h-0 flex-1 overflow-hidden">
        {loading && <div className="absolute inset-0 z-30 grid place-items-center bg-[#080808]"><div className="flex items-center gap-3 text-sm text-zinc-400"><RefreshCw className="size-4 animate-spin" />UMAP · Leiden graph를 생성하는 중…</div></div>}
        {error && <div className="absolute left-1/2 top-5 z-40 -translate-x-1/2 rounded-md border border-red-900 bg-red-950 px-4 py-2 text-xs text-red-200">{error}</div>}
        {graph && <><MemoryGraph ref={controls} graph={graph} viewMode={viewMode} labelsOn={labelsOn} semanticOn={semanticOn} explicitOn={explicitOn} selectedId={selectedId} onSelect={setSelectedId} /><Legend />
          <div className="pointer-events-none absolute bottom-3 left-3 z-10 rounded-md border border-zinc-800 bg-black/80 px-3 py-2 text-[10px] text-zinc-500">
            <span className="text-zinc-300">{graph.communityDetection.communityCount}</span> Leiden communities · <span className="text-zinc-300">{graph.counts.unclassifiedPages}</span> unclassified · <span className="text-zinc-300">{graph.counts.unembeddedPages}</span> outline-only
          </div>
          {selectedId && <div data-testid="selected-summary" className="pointer-events-none absolute bottom-3 right-3 z-10 max-w-[min(430px,60vw)] rounded-md border border-zinc-700 bg-black/85 px-3 py-2 text-xs text-zinc-300"><span className="text-zinc-500">Selected · </span>{graph.nodes.find((n) => n.id === selectedId)?.title}<span className="ml-2 text-zinc-600">1-hop highlighted</span></div>}
        </>}
      </section>
    </main>
  );
}
