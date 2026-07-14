import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Box, Database, Focus, LogOut, Map as MapIcon, RefreshCw, RotateCcw, Tag, Waypoints } from "lucide-react";
import { Legend } from "./components/Legend";
import { LayerControls } from "./components/LayerControls";
import { CommunityNodeList } from "./components/CommunityNodeList";
import { NodeContextPanel } from "./components/NodeContextPanel";
import { GraphTimelineControls } from "./components/GraphTimelineControls";
import { Button } from "./components/ui/button";
import { Tooltip } from "./components/ui/tooltip";
import { MemoryGraph, type GraphControls } from "./graph/MemoryGraph";
import type { GraphResponse, GraphTimelineResponse, StatusResponse } from "./types";
import { activeGraphEdges, relatedNodesForNode } from "./graph/graph-layers";
import { projectGraphAtFrame } from "./graph/graph-timeline";
import { nodesInCommunityHalo } from "./graph/halo";
import { useGraphExplorerState } from "./hooks/useGraphExplorerState";
import { useNodeDetail } from "./hooks/useNodeDetail";
import { useGraphTimeline } from "./hooks/useGraphTimeline";

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
  const [timeline, setTimeline] = useState<GraphTimelineResponse | null>(null);
  const [status, setStatus] = useState<StatusResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [timelineError, setTimelineError] = useState(false);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [focusedCommunityId, setFocusedCommunityId] = useState<string | null>(null);
  const { state, patchState } = useGraphExplorerState(graph);
  const { selectedId, viewMode, communityLabelsOn, semanticOn, explicitOn, semanticThreshold, explicitFamilies } = state;
  const history = useGraphTimeline(timeline);

  const load = useCallback(async () => {
    setError(null);
    setTimelineError(false);
    const historyRequest = json<GraphTimelineResponse>("/api/graph/history").then(
      (value) => ({ ok: true as const, value }),
      () => ({ ok: false as const }),
    );
    try {
      const [nextStatus, nextGraph] = await Promise.all([
        json<StatusResponse>("/api/status"),
        json<GraphResponse>("/api/graph"),
      ]);
      setStatus(nextStatus); setGraph(nextGraph); setLoading(false);
      const historyResult = await historyRequest;
      if (historyResult.ok && historyResult.value.graphGeneratedAt === nextGraph.generatedAt) setTimeline(historyResult.value);
      else { setTimeline(null); setTimelineError(true); }
    } catch (reason) { setError(reason instanceof Error ? reason.message : "데이터를 불러올 수 없습니다."); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    const minimum = graph?.communityDetection.minSemanticSimilarity;
    if (minimum !== undefined && semanticThreshold < minimum) patchState({ semanticThreshold: Math.min(1, minimum) });
  }, [graph?.communityDetection.minSemanticSimilarity, patchState, semanticThreshold]);

  const rebuild = async () => {
    setRefreshing(true); setError(null); setTimelineError(false);
    try {
      const next = await json<GraphResponse>("/api/graph/rebuild", { method: "POST" });
      setGraph(next);
      const [statusResult, historyResult] = await Promise.allSettled([
        json<StatusResponse>("/api/status"),
        json<GraphTimelineResponse>("/api/graph/history"),
      ]);
      if (statusResult.status === "fulfilled") setStatus(statusResult.value);
      else setStatus({ connected: false, lastBuiltAt: next.generatedAt, counts: next.counts });
      if (historyResult.status === "fulfilled" && historyResult.value.graphGeneratedAt === next.generatedAt) setTimeline(historyResult.value);
      else { setTimeline(null); setTimelineError(true); }
    } catch (reason) { setError(reason instanceof Error ? reason.message : "새로고침에 실패했습니다."); }
    finally { setRefreshing(false); }
  };
  const timelineProjection = useMemo(() => graph && timeline && history.frame
    ? projectGraphAtFrame(graph, timeline, history.frame)
    : null, [graph, history.frame, timeline]);
  const displayedGraph = timelineProjection?.graph ?? graph;
  const counts = displayedGraph?.counts ?? status?.counts;
  const layers = useMemo(() => ({ semanticOn, explicitOn, minSemanticSimilarity: semanticThreshold, explicitFamilies }), [explicitFamilies, explicitOn, semanticOn, semanticThreshold]);
  const effectiveSelectedId = displayedGraph?.nodes.some((node) => node.id === selectedId) ? selectedId : null;
  const activeEdges = useMemo(() => displayedGraph ? activeGraphEdges(displayedGraph, layers) : [], [displayedGraph, layers]);
  const selectedNode = displayedGraph?.nodes.find((node) => node.id === effectiveSelectedId) ?? null;
  const selectedRelatedNodes = useMemo(() => displayedGraph && effectiveSelectedId
    ? relatedNodesForNode(effectiveSelectedId, displayedGraph.nodes, activeEdges)
    : [], [activeEdges, displayedGraph, effectiveSelectedId]);
  const nodeDetailState = useNodeDetail(effectiveSelectedId, graph?.generatedAt);
  const focusedCommunity = displayedGraph?.semanticGroups.find((group) => group.id === focusedCommunityId) ?? null;
  const focusedCommunityNodes = useMemo(() => displayedGraph && focusedCommunityId
    ? nodesInCommunityHalo(displayedGraph.nodes, focusedCommunityId)
    : [], [focusedCommunityId, displayedGraph]);
  const dbState = loading ? "connecting" : error || status?.connected === false ? "failed" : status?.connected ? "connected" : "connecting";
  const generatedAt = graph?.generatedAt ?? status?.lastBuiltAt;
  const selectNode = useCallback((id: string | null) => {
    if (id) setFocusedCommunityId(null);
    patchState({ selectedId: id });
  }, [patchState]);

  return (
    <main className="flex h-dvh w-full min-w-0 flex-col overflow-hidden bg-[#080808] text-zinc-100">
      <header className="z-20 flex min-h-16 shrink-0 flex-wrap items-center gap-x-4 gap-y-2 bg-[#111113] px-4 py-2.5">
        <div className="mr-auto flex min-w-fit items-center gap-3">
          <div className="flex size-8 items-center justify-center rounded-md bg-zinc-800"><Waypoints className="size-4" /></div>
          <div><h1 className="text-sm font-semibold tracking-tight sm:text-base">GBrain {viewMode.toUpperCase()} Memory Map</h1><p className="text-[10px] text-zinc-500">Read-only semantic memory space</p></div>
        </div>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
          <div className="flex items-center gap-1.5 text-xs text-zinc-400" data-testid="db-status" data-state={dbState}><span className={`size-2 rounded-full ${dbState === "connected" ? "bg-emerald-500" : dbState === "failed" ? "bg-red-500" : "animate-pulse bg-amber-400"}`} /><Database className="size-3.5" />{dbState === "connected" ? "DB connected" : dbState === "failed" ? "DB failed" : "DB connecting"}</div>
          <Metric label="Pages" value={counts?.pages ?? "—"} /><Metric label="Chunks" value={counts?.chunks ?? "—"} /><Metric label="Links" value={counts?.links ?? "—"} /><Metric label="Coverage" value={counts ? `${(counts.embeddingCoverage * 100).toFixed(1)}%` : "—"} />
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <Tooltip content={`${viewMode === "3d" ? "충돌 없는 평면 layout" : "원래 공간 layout"}으로 모핑합니다`}><Button
            data-testid="view-mode-toggle"
            aria-label={`${viewMode === "3d" ? "2D" : "3D"} 맵으로 전환`}
            onClick={() => patchState((current) => ({ viewMode: current.viewMode === "3d" ? "2d" : "3d" }))}
          >{viewMode === "3d" ? <MapIcon className="size-3.5" /> : <Box className="size-3.5" />}<span>{viewMode === "3d" ? "2D map" : "3D map"}</span></Button></Tooltip>
          <Tooltip content="모든 노드를 화면에 맞춥니다"><Button onClick={() => controls.current?.fit()}><Focus className="size-3.5" /><span className="hidden xl:inline">Fit graph</span></Button></Tooltip>
          <Tooltip content="기본 카메라 위치로 돌아갑니다"><Button onClick={() => controls.current?.reset()}><RotateCcw className="size-3.5" /><span className="hidden xl:inline">Reset camera</span></Button></Tooltip>
          <Button data-testid="community-label-toggle" variant={communityLabelsOn ? "active" : "default"} aria-pressed={communityLabelsOn} onClick={() => patchState({ communityLabelsOn: !communityLabelsOn })}><Tag className="size-3.5" />Community labels {communityLabelsOn ? "on" : "off"}</Button>
          <Tooltip content="DB에서 graph snapshot을 다시 생성합니다"><Button onClick={() => void rebuild()} disabled={refreshing}><RefreshCw className={`size-3.5 ${refreshing ? "animate-spin" : ""}`} /><span className="hidden sm:inline">데이터 새로고침</span></Button></Tooltip>
          <form method="post" action="/auth/logout"><Tooltip content="인증 세션을 종료합니다"><Button type="submit" size="icon" aria-label="로그아웃"><LogOut className="size-3.5" /></Button></Tooltip></form>
        </div>
      </header>
      <section className="relative min-h-0 flex-1 overflow-hidden">
        {loading && <div className="absolute inset-0 z-30 grid place-items-center bg-[#080808]"><div className="flex items-center gap-3 text-sm text-zinc-400"><RefreshCw className="size-4 animate-spin" />UMAP · Leiden graph를 생성하는 중…</div></div>}
        {error && <div className="absolute left-1/2 top-5 z-40 -translate-x-1/2 rounded-md bg-red-950 px-4 py-2 text-xs text-red-200">{error}</div>}
        {graph && displayedGraph && <><MemoryGraph ref={controls} graph={displayedGraph} viewMode={viewMode} labelsOn={communityLabelsOn} layers={layers} selectedId={effectiveSelectedId} changedNodeIds={timelineProjection?.changedNodeIds} onSelect={selectNode} onCommunityFocus={setFocusedCommunityId} /><Legend />
          <div className="pointer-events-none absolute bottom-[92px] right-3 top-3 z-30 flex w-[min(310px,calc(100vw-24px))] flex-col gap-2">
            <LayerControls
              semanticOn={semanticOn} explicitOn={explicitOn} threshold={semanticThreshold} minimumThreshold={displayedGraph.communityDetection.minSemanticSimilarity}
              explicitFamilies={explicitFamilies}
              onSemanticOnChange={(value) => patchState({ semanticOn: value })}
              onExplicitOnChange={(value) => patchState({ explicitOn: value })}
              onThresholdChange={(value) => patchState({ semanticThreshold: Math.max(-1, Math.min(1, value)) })}
              onExplicitFamiliesChange={(value) => patchState({ explicitFamilies: value })}
            />
            {selectedNode
              ? <NodeContextPanel node={selectedNode} detailState={nodeDetailState} relatedNodes={selectedRelatedNodes} onSelectNode={selectNode} onClose={() => selectNode(null)} />
              : focusedCommunity && <CommunityNodeList group={focusedCommunity} nodes={focusedCommunityNodes} onSelectNode={selectNode} />}
          </div>
          <div className="pointer-events-none absolute bottom-[92px] left-3 z-10 rounded-md bg-zinc-900/85 px-3 py-2 text-[10px] text-zinc-500">
            <span className="text-zinc-300">{displayedGraph.communityDetection.communityCount}</span> Leiden communities · <span className="text-zinc-300">{displayedGraph.counts.unclassifiedPages}</span> unclassified · <span className="text-zinc-300">{displayedGraph.counts.unembeddedPages}</span> outline-only
          </div>
          {generatedAt && <div data-testid="generated-at" className="pointer-events-none absolute bottom-[92px] left-1/2 z-20 hidden -translate-x-1/2 rounded-md bg-zinc-900/80 px-2 py-1 text-[10px] text-zinc-500 md:block">Generated {new Date(generatedAt).toLocaleString()}</div>}
          {timeline && history.frame && <GraphTimelineControls
            frames={history.frames}
            frame={history.frame}
            frameIndex={history.frameIndex}
            playing={history.playing}
            historical={history.historical}
            visibleNodeCount={displayedGraph.nodes.length}
            totalNodeCount={graph.nodes.length}
            staticNodeCount={timeline.staticNodeCount}
            onSeek={history.seek}
            onTogglePlayback={history.togglePlayback}
            onReturnToNow={history.returnToNow}
          />}
          {timelineError && <div data-testid="graph-timeline-error" className="pointer-events-none absolute bottom-3 left-1/2 z-40 -translate-x-1/2 rounded-lg bg-amber-950/90 px-3 py-2 text-[10px] text-amber-200">Memory history unavailable · current graph remains available</div>}
        </>}
      </section>
    </main>
  );
}
