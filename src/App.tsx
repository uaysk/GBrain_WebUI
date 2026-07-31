import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Box, Clock3, Database, Focus, Layers3, LogOut, Map as MapIcon, MoreHorizontal, RefreshCw, RotateCcw, Search, ServerCog, Shapes, Sparkles, Tag, Waypoints } from "lucide-react";
import { Legend } from "./components/Legend";
import { LayerControls } from "./components/LayerControls";
import { CommunityNodeList } from "./components/CommunityNodeList";
import { NodeContextPanel } from "./components/NodeContextPanel";
import { GraphTimelineControls } from "./components/GraphTimelineControls";
import { GraphSearchPalette } from "./components/GraphSearchPalette";
import { MapBottomSheet } from "./components/MapBottomSheet";
import { affectedGraphNodes, DreamImpactPanel } from "./components/DreamImpactPanel";
import { Button } from "./components/ui/button";
import { Tooltip } from "./components/ui/tooltip";
import type { GraphControls } from "./graph/MemoryGraph";
import { GraphViewIndex } from "./graph/graph-view-index";
import { GraphTimelineIndex } from "./graph/graph-timeline";
import { getGraphSearchIndex, type GraphSearchResult } from "./graph/graph-search-index";
import { createMapUrlTransition, parseMapUrlState, type MapUrlStatePatch } from "./graph/map-url-state";
import { EXPLICIT_RELATION_FAMILIES } from "./graph/visual-spec";
import { useGraphExplorerState } from "./hooks/useGraphExplorerState";
import { useNodeDetail } from "./hooks/useNodeDetail";
import { useGraphTimeline } from "./hooks/useGraphTimeline";
import { useGraphData } from "./hooks/useGraphData";
import { useDreamRunDetail } from "./hooks/useDreamRunDetail";

const loadMemoryGraph = () => import("./graph/MemoryGraph");
const loadControlCenter = () => import("./components/control/ControlCenter");
const MemoryGraph = lazy(() => loadMemoryGraph().then((module) => ({ default: module.MemoryGraph })));
const ControlCenter = lazy(() => loadControlCenter().then((module) => ({ default: module.ControlCenter })));

function Metric({ label, value }: { label: string; value: string | number }) {
  return <div className="flex min-w-fit items-baseline gap-1.5"><span className="text-[10px] uppercase tracking-[0.1em] text-zinc-500">{label}</span><strong className="font-mono text-xs font-medium text-zinc-100">{value}</strong></div>;
}

function surfaceFromPath(pathname: string): "map" | "control" {
  return pathname.replace(/\/+$/, "") === "/control" ? "control" : "map";
}

type MobileSheet = "menu" | "legend" | "layers" | "node" | "community" | "timeline" | "dream" | null;

export default function App() {
  const controls = useRef<GraphControls>(null);
  const [surface, setSurface] = useState<"map" | "control">(() => surfaceFromPath(window.location.pathname));
  const {
    graph, timeline, status, error, rebuildError, rebuildStatus, timelineError,
    loading, refreshing, rebuild,
  } = useGraphData(surface === "map");
  const initialMapUrl = useMemo(() => parseMapUrlState(window.location.search), []);
  const [focusedCommunityId, setFocusedCommunityId] = useState<string | null>(initialMapUrl.community);
  const [dreamRunId, setDreamRunId] = useState<number | null>(initialMapUrl.dreamRun);
  const [searchOpen, setSearchOpen] = useState(false);
  const [mobileSheet, setMobileSheet] = useState<MobileSheet>(null);
  const { state, patchState } = useGraphExplorerState(graph);
  const { selectedId, viewMode, timelineOn, communityLabelsOn, semanticOn, explicitOn, semanticThreshold, explicitFamilies } = state;
  const history = useGraphTimeline(timelineOn ? timeline : null);
  const dreamDetailState = useDreamRunDetail(
    surface === "map" ? dreamRunId : null,
    null,
  );

  const writeMapUrl = useCallback((patch: MapUrlStatePatch, mode: "push" | "replace") => {
    const transition = createMapUrlTransition(window.location.search, patch, mode);
    const target = `${window.location.pathname}${transition.search}${window.location.hash}`;
    if (mode === "push") window.history.pushState(window.history.state, "", target);
    else window.history.replaceState(window.history.state, "", target);
  }, []);

  useEffect(() => {
    const onPopState = () => {
      setSurface(surfaceFromPath(window.location.pathname));
      const restored = parseMapUrlState(window.location.search);
      patchState((current) => ({
        selectedId: restored.node,
        viewMode: restored.view ?? current.viewMode,
      }));
      setFocusedCommunityId(restored.community);
      setDreamRunId(restored.dreamRun);
      setMobileSheet(null);
      setSearchOpen(false);
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, [patchState]);
  useEffect(() => {
    document.title = surface === "control" ? "GBrain Control Center" : `GBrain ${viewMode.toUpperCase()} Memory Map`;
  }, [surface, viewMode]);
  const navigateSurface = useCallback((next: "map" | "control") => {
    const path = next === "control" ? "/control" : "/";
    if (window.location.pathname !== path) window.history.pushState(window.history.state, "", `${path}${window.location.search}${window.location.hash}`);
    setSurface(next);
  }, []);
  useEffect(() => {
    const minimum = graph?.communityDetection.minSemanticSimilarity;
    if (minimum !== undefined && semanticThreshold < minimum) patchState({ semanticThreshold: Math.min(1, minimum) });
  }, [graph?.communityDetection.minSemanticSimilarity, patchState, semanticThreshold]);

  const timelineIndex = useMemo(() => timeline ? new GraphTimelineIndex(timeline) : null, [timeline]);
  const timelineProjection = useMemo(() => timelineOn && graph && timelineIndex && history.frame
    ? timelineIndex.project(graph, history.frame)
    : null, [graph, history.frame, timelineIndex, timelineOn]);
  const displayedGraph = timelineProjection?.graph ?? graph;
  const graphSearchIndex = useMemo(() => graph ? getGraphSearchIndex(graph) : null, [graph]);
  const graphViewIndex = useMemo(() => displayedGraph ? new GraphViewIndex(displayedGraph) : null, [displayedGraph]);
  const counts = displayedGraph?.counts ?? status?.counts;
  const layers = useMemo(() => ({ semanticOn, explicitOn, minSemanticSimilarity: semanticThreshold, explicitFamilies }), [explicitFamilies, explicitOn, semanticOn, semanticThreshold]);
  const effectiveSelectedId = displayedGraph?.nodes.some((node) => node.id === selectedId) ? selectedId : null;
  const activeView = useMemo(() => graphViewIndex?.active(layers) ?? { edges: [], edgeIds: new Set<string>() }, [graphViewIndex, layers]);
  const selectedNode = effectiveSelectedId ? graphViewIndex?.nodeById.get(effectiveSelectedId) ?? null : null;
  const selectedRelatedNodes = useMemo(() => graphViewIndex && effectiveSelectedId
    ? graphViewIndex.related(effectiveSelectedId, activeView)
    : [], [activeView, effectiveSelectedId, graphViewIndex]);
  const nodeDetailState = useNodeDetail(effectiveSelectedId, graph?.generatedAt);
  const focusedCommunity = displayedGraph?.semanticGroups.find((group) => group.id === focusedCommunityId) ?? null;
  const focusedCommunityNodes = useMemo(() => graphViewIndex && focusedCommunityId
    ? graphViewIndex.groupNodes(focusedCommunityId, true)
    : [], [focusedCommunityId, graphViewIndex]);
  const dbState = loading ? "connecting" : error || status?.connected === false ? "failed" : status?.connected ? "connected" : "connecting";
  const generatedAt = graph?.generatedAt ?? status?.lastBuiltAt;
  const timelineVisible = Boolean(timelineOn && timeline && history.frame);
  const overlayBottomClass = timelineVisible ? "bottom-[128px]" : "bottom-3";
  const timelineChangedNodes = useMemo(() => {
    if (!history.frame || !graph) return [];
    const nodeById = new Map(graph.nodes.map((node) => [node.id, node]));
    return [...history.frame.changedNodeIds]
      .map((id) => ({
        id,
        title: nodeById.get(id)?.title ?? id,
        kind: history.frame!.createdNodeIds.has(id) ? "created" as const : "updated" as const,
      }))
      .sort((left, right) => left.kind.localeCompare(right.kind) || left.title.localeCompare(right.title) || left.id.localeCompare(right.id));
  }, [graph, history.frame]);
  const dreamImpact = useMemo(() => graph
    ? affectedGraphNodes(graph, dreamDetailState.detail)
    : { nodes: [], nodeIds: new Set<string>(), missingCount: 0 }, [dreamDetailState.detail, graph]);
  const selectNode = useCallback((id: string | null, historyMode: "push" | "replace" = "replace") => {
    if (id && graph && !displayedGraph?.nodes.some((node) => node.id === id)) history.returnToNow();
    if (id) setFocusedCommunityId(null);
    patchState({ selectedId: id });
    writeMapUrl({ node: id, community: null }, historyMode);
    if (id && window.matchMedia("(max-width: 767px)").matches) setMobileSheet("node");
  }, [displayedGraph?.nodes, graph, history.returnToNow, patchState, writeMapUrl]);
  const focusCommunity = useCallback((id: string | null, historyMode: "push" | "replace" = "replace") => {
    if (id && graph && !displayedGraph?.nodes.some((node) => node.groupId === id)) history.returnToNow();
    patchState({ selectedId: null });
    setFocusedCommunityId(id);
    writeMapUrl({ community: id, node: null }, historyMode);
    if (id && window.matchMedia("(max-width: 767px)").matches) setMobileSheet("community");
  }, [displayedGraph?.nodes, graph, history.returnToNow, patchState, writeMapUrl]);
  const selectSearchResult = useCallback((result: GraphSearchResult) => {
    if (result.kind === "node") selectNode(result.id, "push");
    else focusCommunity(result.id, "push");
  }, [focusCommunity, selectNode]);
  const setViewMode = useCallback((next: "2d" | "3d") => {
    patchState({ viewMode: next });
    writeMapUrl({ view: next }, "replace");
  }, [patchState, writeMapUrl]);
  const closeDreamImpact = useCallback(() => {
    setDreamRunId(null);
    setMobileSheet((current) => current === "dream" ? null : current);
    writeMapUrl({ dreamRun: null }, "replace");
  }, [writeMapUrl]);
  const openDreamInControl = useCallback(() => {
    if (!dreamRunId) return;
    const params = new URLSearchParams(window.location.search);
    for (const key of ["node", "community", "view", "dreamRun"]) params.delete(key);
    params.set("run", String(dreamRunId));
    params.set("tab", "overview");
    const search = params.toString();
    window.history.pushState(window.history.state, "", `/control${search ? `?${search}` : ""}`);
    setMobileSheet(null);
    setSurface("control");
  }, [dreamRunId]);

  useEffect(() => {
    if (!dreamRunId || !dreamDetailState.detail || !window.matchMedia("(max-width: 767px)").matches) return;
    setMobileSheet((current) => current ?? "dream");
  }, [dreamDetailState.detail, dreamRunId]);

  useEffect(() => {
    const onEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || searchOpen || mobileSheet) return;
      event.preventDefault();
      selectNode(null);
      setFocusedCommunityId(null);
    };
    window.addEventListener("keydown", onEscape);
    return () => window.removeEventListener("keydown", onEscape);
  }, [mobileSheet, searchOpen, selectNode]);

  return (
    <main className="flex h-dvh w-full min-w-0 flex-col overflow-hidden bg-[#080808] text-zinc-100">
      <header className="z-20 flex min-h-16 shrink-0 items-center gap-3 bg-[#111113] px-3 py-2.5 sm:px-4">
        <div className="mr-auto flex min-w-0 items-center gap-3">
          <div className="flex size-8 items-center justify-center rounded-md bg-zinc-800">{surface === "map" ? <Waypoints className="size-4" /> : <ServerCog className="size-4" />}</div>
          <div className="min-w-0"><h1 className="truncate text-sm font-semibold tracking-tight sm:text-base">{surface === "map" ? `GBrain ${viewMode.toUpperCase()} Memory Map` : "GBrain Control Center"}</h1><p className="hidden text-[10px] text-zinc-500 sm:block">{surface === "map" ? "Read-only semantic memory space" : "Guarded operations & visual observability"}</p></div>
        </div>
        {surface === "map" && <div className="hidden flex-wrap items-center gap-x-4 gap-y-1.5 xl:flex">
          <div className="flex items-center gap-1.5 text-xs text-zinc-400" data-testid="db-status" data-state={dbState}><span className={`size-2 rounded-full ${dbState === "connected" ? "bg-emerald-500" : dbState === "failed" ? "bg-red-500" : "animate-pulse bg-amber-400"}`} /><Database className="size-3.5" />{dbState === "connected" ? "DB connected" : dbState === "failed" ? "DB failed" : "DB connecting"}</div>
          <Metric label="Pages" value={counts?.pages ?? "—"} /><Metric label="Chunks" value={counts?.chunks ?? "—"} /><Metric label="Links" value={counts?.links ?? "—"} /><Metric label="Coverage" value={counts ? `${(counts.embeddingCoverage * 100).toFixed(1)}%` : "—"} />
        </div>}
        <div className="hidden flex-wrap items-center gap-1.5 md:flex">
          <Button data-testid="map-surface-toggle" variant={surface === "map" ? "active" : "default"} aria-pressed={surface === "map"} onMouseEnter={() => { void loadMemoryGraph(); }} onFocus={() => { void loadMemoryGraph(); }} onClick={() => navigateSurface("map")}><Waypoints className="size-3.5" />Map</Button>
          <Button data-testid="control-surface-toggle" variant={surface === "control" ? "active" : "default"} aria-pressed={surface === "control"} onMouseEnter={() => { void loadControlCenter(); }} onFocus={() => { void loadControlCenter(); }} onClick={() => navigateSurface("control")}><ServerCog className="size-3.5" />Control</Button>
          {surface === "map" && <>
          <Tooltip content="제목, slug, source, type, community를 검색합니다 (Ctrl/Cmd+K)"><Button aria-label="Memory Map 검색" onClick={() => setSearchOpen(true)}><Search className="size-3.5" />Search</Button></Tooltip>
          <Tooltip content={`${viewMode === "3d" ? "충돌 없는 평면 layout" : "원래 공간 layout"}으로 모핑합니다`}><Button
            data-testid="view-mode-toggle"
            aria-label={`${viewMode === "3d" ? "2D" : "3D"} 맵으로 전환`}
            onClick={() => setViewMode(viewMode === "3d" ? "2d" : "3d")}
          >{viewMode === "3d" ? <MapIcon className="size-3.5" /> : <Box className="size-3.5" />}<span>{viewMode === "3d" ? "2D map" : "3D map"}</span></Button></Tooltip>
          <Tooltip content="모든 노드를 화면에 맞춥니다"><Button onClick={() => controls.current?.fit()}><Focus className="size-3.5" /><span className="hidden xl:inline">Fit graph</span></Button></Tooltip>
          <Tooltip content="기본 카메라 위치로 돌아갑니다"><Button onClick={() => controls.current?.reset()}><RotateCcw className="size-3.5" /><span className="hidden xl:inline">Reset camera</span></Button></Tooltip>
          <Button data-testid="community-label-toggle" variant={communityLabelsOn ? "active" : "default"} aria-pressed={communityLabelsOn} onClick={() => patchState({ communityLabelsOn: !communityLabelsOn })}><Tag className="size-3.5" />Community labels {communityLabelsOn ? "on" : "off"}</Button>
          <Tooltip content="DB에서 graph snapshot을 백그라운드로 다시 생성합니다"><Button onClick={() => void rebuild()} disabled={refreshing}><RefreshCw className={`size-3.5 ${refreshing ? "animate-spin" : ""}`} /><span className="hidden sm:inline">{refreshing ? `새로고침 · ${rebuildStatus?.phase ?? "대기"}` : "데이터 새로고침"}</span></Button></Tooltip>
          </>}
          <form method="post" action="/auth/logout"><Tooltip content="인증 세션을 종료합니다"><Button type="submit" size="icon" aria-label="로그아웃"><LogOut className="size-3.5" /></Button></Tooltip></form>
        </div>
        <div className="flex items-center gap-1.5 md:hidden">
          {surface === "map" && <>
            <Button size="icon" aria-label="Memory Map 검색" onClick={() => setSearchOpen(true)}><Search className="size-4" /></Button>
            <Button size="icon" data-testid="mobile-view-mode-toggle" aria-label={`${viewMode === "3d" ? "2D" : "3D"} 맵으로 전환`} onClick={() => setViewMode(viewMode === "3d" ? "2d" : "3d")}>{viewMode === "3d" ? <MapIcon className="size-4" /> : <Box className="size-4" />}</Button>
          </>}
          <Button size="icon" aria-label="추가 작업 열기" aria-haspopup="dialog" onClick={() => setMobileSheet("menu")}><MoreHorizontal className="size-4" /></Button>
        </div>
      </header>
      {surface === "control" ? <Suspense fallback={<div className="grid min-h-0 flex-1 place-items-center text-sm text-zinc-500">Control Center를 불러오는 중…</div>}><ControlCenter /></Suspense> : <section className="relative min-h-0 flex-1 overflow-hidden">
        {loading && <div className="absolute inset-0 z-30 grid place-items-center bg-[#080808]"><div className="flex items-center gap-3 text-sm text-zinc-400"><RefreshCw className="size-4 animate-spin" />UMAP · Leiden graph를 생성하는 중…</div></div>}
        {error && <div className="absolute left-1/2 top-5 z-40 -translate-x-1/2 rounded-md bg-red-950 px-4 py-2 text-xs text-red-200">{error}</div>}
        {rebuildError && graph && <div className="absolute left-1/2 top-5 z-40 -translate-x-1/2 rounded-md bg-amber-950 px-4 py-2 text-xs text-amber-200">{rebuildError}</div>}
        {graph && displayedGraph && graphViewIndex && <><Suspense fallback={<div className="absolute inset-0 z-20 grid place-items-center text-sm text-zinc-500">그래프 렌더러를 불러오는 중…</div>}><MemoryGraph ref={controls} graph={displayedGraph} viewIndex={graphViewIndex} viewMode={viewMode} labelsOn={communityLabelsOn} layers={layers} selectedId={effectiveSelectedId} focusedCommunityId={focusedCommunityId} changedNodeIds={timelineProjection?.changedNodeIds} impactNodeIds={dreamImpact.nodeIds} onSelect={selectNode} onCommunityFocus={focusCommunity} /></Suspense><Legend />
          <div className={`pointer-events-none absolute right-3 top-3 z-30 hidden w-[min(310px,calc(100vw-24px))] flex-col gap-2 md:flex ${overlayBottomClass}`}>
            <LayerControls
              timelineOn={timelineOn}
              semanticOn={semanticOn} explicitOn={explicitOn} threshold={semanticThreshold} minimumThreshold={displayedGraph.communityDetection.minSemanticSimilarity}
              explicitFamilies={explicitFamilies}
              activeRelationCount={activeView.edges.length}
              onTimelineOnChange={(value) => patchState({ timelineOn: value })}
              onSemanticOnChange={(value) => patchState({ semanticOn: value })}
              onExplicitOnChange={(value) => patchState({ explicitOn: value })}
              onThresholdChange={(value) => patchState({ semanticThreshold: Math.max(-1, Math.min(1, value)) })}
              onExplicitFamiliesChange={(value) => patchState({ explicitFamilies: value })}
              onReset={() => patchState({ semanticOn: true, explicitOn: true, semanticThreshold: displayedGraph.communityDetection.minSemanticSimilarity, explicitFamilies: [...EXPLICIT_RELATION_FAMILIES], timelineOn: true })}
            />
            {selectedNode
              ? <NodeContextPanel node={selectedNode} detailState={nodeDetailState} relatedNodes={selectedRelatedNodes} historicalContent={history.historical} onSelectNode={selectNode} onClose={() => selectNode(null)} />
              : focusedCommunity && <CommunityNodeList group={focusedCommunity} nodes={focusedCommunityNodes} onSelectNode={selectNode} />}
          </div>
          <div className={`pointer-events-none absolute left-3 z-10 hidden rounded-md bg-zinc-900/85 px-3 py-2 text-[10px] text-zinc-500 md:block ${overlayBottomClass}`}>
            <span className="text-zinc-300">{displayedGraph.communityDetection.communityCount}</span> Leiden communities · <span className="text-zinc-300">{displayedGraph.counts.unclassifiedPages}</span> unclassified · <span className="text-zinc-300">{displayedGraph.counts.unembeddedPages}</span> outline-only
          </div>
          {generatedAt && <div data-testid="generated-at" className={`pointer-events-none absolute left-1/2 z-20 hidden -translate-x-1/2 rounded-md bg-zinc-900/80 px-2 py-1 text-[10px] text-zinc-500 md:block ${overlayBottomClass}`}>Generated {new Date(generatedAt).toLocaleString()}</div>}
          {timelineVisible && timeline && history.frame && <div className="hidden md:block"><GraphTimelineControls
            frames={history.frames}
            frame={history.frame}
            frameIndex={history.frameIndex}
            playing={history.playing}
            historical={history.historical}
            visibleNodeCount={displayedGraph.nodes.length}
            totalNodeCount={graph.nodes.length}
            staticNodeCount={timeline.staticNodeCount}
            changedNodes={timelineChangedNodes}
            onSeek={history.seek}
            onPrevious={history.previous}
            onNext={history.next}
            onTogglePlayback={history.togglePlayback}
            onReturnToNow={history.returnToNow}
          /></div>}
          {timelineOn && timelineError && <div data-testid="graph-timeline-error" className="pointer-events-none absolute bottom-3 left-1/2 z-40 -translate-x-1/2 rounded-lg bg-amber-950/90 px-3 py-2 text-[10px] text-amber-200">Memory history unavailable · current graph remains available</div>}
          {dreamRunId && <DreamImpactPanel
            jobId={dreamRunId}
            graph={graph}
            detail={dreamDetailState.detail}
            loading={dreamDetailState.loading}
            error={dreamDetailState.error}
            onRetry={() => { void dreamDetailState.reload(); }}
            onSelectNode={(id) => selectNode(id, "push")}
            onOpenControl={openDreamInControl}
            onClose={closeDreamImpact}
          />}
        </>}
      </section>}
      {surface === "map" && <GraphSearchPalette index={graphSearchIndex} open={searchOpen} onOpenChange={setSearchOpen} onSelect={selectSearchResult} />}
      <MapBottomSheet open={mobileSheet === "menu"} title="Map actions" onClose={() => setMobileSheet(null)}>
        <div className="grid grid-cols-2 gap-2">
          <Button className="h-11 justify-start" variant={surface === "map" ? "active" : "default"} onClick={() => { navigateSurface("map"); setMobileSheet(null); }}><Waypoints className="size-4" />Map</Button>
          <Button className="h-11 justify-start" variant={surface === "control" ? "active" : "default"} onClick={() => { navigateSurface("control"); setMobileSheet(null); }}><ServerCog className="size-4" />Control</Button>
          {surface === "map" && <>
            <Button className="h-11 justify-start" onClick={() => { controls.current?.fit(); setMobileSheet(null); }}><Focus className="size-4" />Fit graph</Button>
            <Button className="h-11 justify-start" onClick={() => { controls.current?.reset(); setMobileSheet(null); }}><RotateCcw className="size-4" />Reset camera</Button>
            <Button className="h-11 justify-start" onClick={() => setMobileSheet("legend")}><Shapes className="size-4" />Legend</Button>
            <Button className="h-11 justify-start" onClick={() => setMobileSheet("layers")}><Layers3 className="size-4" />Layers</Button>
            <Button className="h-11 justify-start" variant={communityLabelsOn ? "active" : "default"} onClick={() => patchState({ communityLabelsOn: !communityLabelsOn })}><Tag className="size-4" />Labels {communityLabelsOn ? "on" : "off"}</Button>
            <Button className="h-11 justify-start" disabled={!timelineVisible} onClick={() => setMobileSheet("timeline")}><Clock3 className="size-4" />Timeline</Button>
            {dreamRunId && <Button className="h-11 justify-start" onClick={() => setMobileSheet("dream")}><Sparkles className="size-4" />Dream impact</Button>}
            <Button className="col-span-2 h-11 justify-start" disabled={refreshing} onClick={() => { void rebuild(); setMobileSheet(null); }}><RefreshCw className={`size-4 ${refreshing ? "animate-spin" : ""}`} />{refreshing ? "데이터 갱신 중" : "데이터 새로고침"}</Button>
          </>}
          <form className="col-span-2" method="post" action="/auth/logout"><Button type="submit" className="h-11 w-full justify-start"><LogOut className="size-4" />로그아웃</Button></form>
        </div>
        {surface === "map" && <div className="mt-3 rounded-lg bg-zinc-900 p-3 text-[10px] text-zinc-500">
          <span data-state={dbState}>{dbState === "connected" ? "DB connected" : dbState === "failed" ? "DB failed" : "DB connecting"}</span>
          <span className="mx-2">·</span>{counts?.pages ?? "—"} pages · {counts?.links ?? "—"} links
        </div>}
      </MapBottomSheet>
      <MapBottomSheet open={mobileSheet === "legend"} title="Visual legend" onClose={() => setMobileSheet(null)}><Legend embedded /></MapBottomSheet>
      <MapBottomSheet open={mobileSheet === "layers"} title="Graph layers" onClose={() => setMobileSheet(null)}>
        {displayedGraph && <LayerControls
          timelineOn={timelineOn}
          semanticOn={semanticOn}
          explicitOn={explicitOn}
          threshold={semanticThreshold}
          minimumThreshold={displayedGraph.communityDetection.minSemanticSimilarity}
          explicitFamilies={explicitFamilies}
          activeRelationCount={activeView.edges.length}
          onTimelineOnChange={(value) => patchState({ timelineOn: value })}
          onSemanticOnChange={(value) => patchState({ semanticOn: value })}
          onExplicitOnChange={(value) => patchState({ explicitOn: value })}
          onThresholdChange={(value) => patchState({ semanticThreshold: Math.max(-1, Math.min(1, value)) })}
          onExplicitFamiliesChange={(value) => patchState({ explicitFamilies: value })}
          onReset={() => patchState({ semanticOn: true, explicitOn: true, semanticThreshold: displayedGraph.communityDetection.minSemanticSimilarity, explicitFamilies: [...EXPLICIT_RELATION_FAMILIES], timelineOn: true })}
        />}
      </MapBottomSheet>
      <MapBottomSheet open={mobileSheet === "node" && Boolean(selectedNode)} title={selectedNode?.title ?? "Selected page"} onClose={() => { setMobileSheet(null); selectNode(null); }}>
        {selectedNode && <NodeContextPanel node={selectedNode} detailState={nodeDetailState} relatedNodes={selectedRelatedNodes} historicalContent={history.historical} onSelectNode={selectNode} onClose={() => { setMobileSheet(null); selectNode(null); }} />}
      </MapBottomSheet>
      <MapBottomSheet open={mobileSheet === "community" && Boolean(focusedCommunity)} title={focusedCommunity?.label ?? "Community"} onClose={() => { setMobileSheet(null); focusCommunity(null); }}>
        {focusedCommunity && <CommunityNodeList group={focusedCommunity} nodes={focusedCommunityNodes} onSelectNode={selectNode} />}
      </MapBottomSheet>
      <MapBottomSheet open={mobileSheet === "timeline" && Boolean(timelineVisible && timeline && history.frame)} title="Memory timeline" onClose={() => setMobileSheet(null)}>
        {timelineVisible && timeline && history.frame && <GraphTimelineControls
          embedded
          frames={history.frames}
          frame={history.frame}
          frameIndex={history.frameIndex}
          playing={history.playing}
          historical={history.historical}
          visibleNodeCount={displayedGraph?.nodes.length ?? 0}
          totalNodeCount={graph?.nodes.length ?? 0}
          staticNodeCount={timeline.staticNodeCount}
          changedNodes={timelineChangedNodes}
          onSeek={history.seek}
          onPrevious={history.previous}
          onNext={history.next}
          onTogglePlayback={history.togglePlayback}
          onReturnToNow={history.returnToNow}
        />}
      </MapBottomSheet>
      <MapBottomSheet open={mobileSheet === "dream" && Boolean(dreamRunId && graph)} title={`Dream #${dreamRunId ?? ""} impact`} onClose={() => setMobileSheet(null)}>
        {dreamRunId && graph && <DreamImpactPanel
          embedded
          jobId={dreamRunId}
          graph={graph}
          detail={dreamDetailState.detail}
          loading={dreamDetailState.loading}
          error={dreamDetailState.error}
          onRetry={() => { void dreamDetailState.reload(); }}
          onSelectNode={(id) => { setMobileSheet(null); selectNode(id, "push"); }}
          onOpenControl={openDreamInControl}
          onClose={closeDreamImpact}
        />}
      </MapBottomSheet>
    </main>
  );
}
