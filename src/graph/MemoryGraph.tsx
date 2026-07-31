import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import ForceGraph3D from "react-force-graph-3d";
import * as THREE from "three";
import { LineSegments2 } from "three/examples/jsm/lines/LineSegments2.js";
import type { GraphEdge, GraphNode, GraphResponse } from "../types";
import { COMMUNITY_LABEL_STYLE, communityLabelTitle, placeCommunityLabels } from "./community-label";
import { cameraFocusDelayMs, cameraPoseForNodes } from "./camera";
import { bundleGraphEdges, endpointId, type GraphLayerSettings, type RenderEdge } from "./graph-layers";
import { GraphViewIndex } from "./graph-view-index";
import { createCommunityHaloMeshes, disposeHaloRoot, haloTransformForNodes } from "./halo";
import { createMap2DLayout, easeInOutCubic, type MapViewMode } from "./layout-2d";
import { configureNavigationControls } from "./navigation-controls";
import { createMorphHaloBatch, type MorphHaloBatch } from "./morph-halo-batch";
import { createMorphNodeBatch, type MorphNodeBatch } from "./morph-node-batch";
import { BillboardTexturePool } from "./node-billboard";
import { createEdgeObject, createNodeObject, disposeNodeObject, edgeSegmentPositions, updateEdgeAppearance, updateEdgeObject, updateNodeObject, type NodeRenderState } from "./rendering";
import { RELATION_DIRECTION_ARROW_LENGTH } from "./visual-spec";
import { ViewMorphController } from "./view-morph-controller";

export interface GraphControls { fit: () => void; reset: () => void }
interface Props {
  graph: GraphResponse;
  viewIndex: GraphViewIndex;
  viewMode: MapViewMode;
  labelsOn: boolean;
  layers: GraphLayerSettings;
  selectedId: string | null;
  focusedCommunityId?: string | null;
  changedNodeIds?: ReadonlySet<string>;
  impactNodeIds?: ReadonlySet<string>;
  onSelect: (id: string | null) => void;
  onCommunityFocus: (id: string | null) => void;
}

const escapeHtml = (value: string) => value.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]!));

export const MemoryGraph = forwardRef<GraphControls, Props>(function MemoryGraph({ graph, viewIndex, viewMode, labelsOn, layers, selectedId, focusedCommunityId, changedNodeIds, impactNodeIds, onSelect, onCommunityFocus }, ref) {
  const containerRef = useRef<HTMLDivElement>(null);
  const labelLayerRef = useRef<HTMLDivElement>(null);
  const haloRootRef = useRef<THREE.Group | null>(null);
  const haloRaycasterRef = useRef(new THREE.Raycaster());
  const hoveredGroupIdRef = useRef<string | null>(null);
  const focusedCommunityIdRef = useRef<string | null>(null);
  const viewModeRef = useRef<MapViewMode>(viewMode);
  const flatnessRef = useRef(viewMode === "2d" ? 1 : 0);
  const morphFrameRef = useRef<number | null>(null);
  const edgeFadeFrameRef = useRef<number | null>(null);
  const previousSelectedIdRef = useRef<string | null>(null);
  const skipClearFitRef = useRef(false);
  const labelSizeRef = useRef(new Map<string, { width: number; height: number }>());
  const nodeObjectRegistryRef = useRef(new Map<string, THREE.Object3D>());
  const edgeObjectRegistryRef = useRef(new Map<string, LineSegments2>());
  const factoryCountsRef = useRef({ nodes: 0, edges: 0 });
  const viewMorphControllerRef = useRef(new ViewMorphController());
  const texturePoolStateRef = useRef({ generation: graph.generatedAt, pool: new BillboardTexturePool() });
  if (texturePoolStateRef.current.generation !== graph.generatedAt) {
    for (const object of nodeObjectRegistryRef.current.values()) disposeNodeObject(object, texturePoolStateRef.current.pool);
    texturePoolStateRef.current.pool.dispose();
    texturePoolStateRef.current = { generation: graph.generatedAt, pool: new BillboardTexturePool() };
    nodeObjectRegistryRef.current.clear();
    edgeObjectRegistryRef.current.clear();
    factoryCountsRef.current = { nodes: 0, edges: 0 };
  }
  const graphRef = useRef<any>(null);
  const diagnosticsEnabled = useMemo(() => new URLSearchParams(window.location.search).get("graphDiagnostics") === "1", []);
  const [size, setSize] = useState({ width: 800, height: 600 });
  const [sceneReadyTick, setSceneReadyTick] = useState(0);
  useEffect(() => {
    if (!containerRef.current) return;
    const observer = new ResizeObserver(([entry]) => entry && setSize({ width: Math.max(1, entry.contentRect.width), height: Math.max(1, entry.contentRect.height) }));
    observer.observe(containerRef.current); return () => observer.disconnect();
  }, []);
  useEffect(() => {
    let frame: number | null = null;
    let attempts = 0;
    const check = () => {
      let nodeFound = false;
      const scene = graphRef.current?.scene?.() as THREE.Scene | undefined;
      scene?.traverse((object) => { if (object.name === "memory-node-object") nodeFound = true; });
      if (scene && nodeFound) {
        setSceneReadyTick((current) => current + 1);
        return;
      }
      attempts += 1;
      if (attempts < 120) frame = requestAnimationFrame(check);
    };
    frame = requestAnimationFrame(check);
    return () => { if (frame !== null) cancelAnimationFrame(frame); };
  }, [graph.generatedAt]);
  const activeView = useMemo(() => viewIndex.active(layers), [layers, viewIndex]);
  const activeEdges = activeView.edges;
  const visibleEdges = useMemo<RenderEdge[]>(() => bundleGraphEdges(activeEdges), [activeEdges]);
  const visibleEdgesRef = useRef(visibleEdges);
  visibleEdgesRef.current = visibleEdges;
  const neighbors = useMemo(() => viewIndex.neighbors(selectedId, activeView), [activeView, selectedId, viewIndex]);
  const renderSelectionRef = useRef<{
    selectedId: string | null;
    neighbors: ReadonlySet<string>;
    changedNodeIds?: ReadonlySet<string>;
    impactNodeIds?: ReadonlySet<string>;
  }>({ selectedId, neighbors, changedNodeIds, impactNodeIds });
  renderSelectionRef.current = { selectedId, neighbors, changedNodeIds, impactNodeIds };
  const nodeRenderState = (nodeId: string): NodeRenderState => {
    const selection = renderSelectionRef.current;
    const selected = nodeId === selection.selectedId;
    return {
      selected,
      adjacent: Boolean(selection.selectedId && selection.neighbors.has(nodeId) && !selected),
      dimmed: Boolean(selection.selectedId && !selection.neighbors.has(nodeId) && !selection.impactNodeIds?.has(nodeId)),
      showLabel: false,
      historyChanged: selection.changedNodeIds?.has(nodeId),
      dreamAffected: selection.impactNodeIds?.has(nodeId),
    };
  };
  const renderNodeObject = useCallback((raw: object) => {
    const node = raw as GraphNode;
    const object = createNodeObject(node, nodeRenderState(node.id), texturePoolStateRef.current.pool);
    nodeObjectRegistryRef.current.set(node.id, object);
    factoryCountsRef.current.nodes += 1;
    if (containerRef.current) containerRef.current.dataset.nodeFactoryCount = String(factoryCountsRef.current.nodes);
    return object;
  }, []);
  const renderNodeTooltip = useCallback((raw: object) => {
    const node = raw as GraphNode;
    const community = node.isUnclassified
      ? "Leiden · unclassified"
      : `Leiden internal-edge share · ${((node.communityStrength ?? 0) * 100).toFixed(0)}%`;
    return `<div class="graph-tooltip"><strong>${escapeHtml(node.title)}</strong><span>Type · ${escapeHtml(node.type)}</span><span>Community · ${escapeHtml(node.groupLabel)}</span><span>${community}</span><span>Source · ${escapeHtml(node.sourceName)}</span><span>Chunks · ${node.chunkCount}</span></div>`;
  }, []);
  const renderLinkObject = useCallback((raw: object) => {
    const edge = raw as GraphEdge;
    const currentSelectedId = renderSelectionRef.current.selectedId;
    const emphasized = Boolean(currentSelectedId && (endpointId(edge.source) === currentSelectedId || endpointId(edge.target) === currentSelectedId));
    const object = createEdgeObject(edge, emphasized, Boolean(currentSelectedId && !emphasized));
    edgeObjectRegistryRef.current.set(edge.id, object);
    factoryCountsRef.current.edges += 1;
    if (containerRef.current) containerRef.current.dataset.edgeFactoryCount = String(factoryCountsRef.current.edges);
    return object;
  }, []);
  const updateRenderedLinkPosition = useCallback((object: object, coordinates: object, raw: object) =>
    updateEdgeObject(object as THREE.Object3D, coordinates as { start: { x: number; y: number; z: number }; end: { x: number; y: number; z: number } }, raw as GraphEdge), []);
  const renderLinkTooltip = useCallback((raw: object) => {
    const edge = raw as RenderEdge;
    const relations = edge.bundledEdges;
    const details = relations.map((relation) => {
      const source = viewIndex.nodeById.get(endpointId(relation.source))?.title ?? endpointId(relation.source);
      const target = viewIndex.nodeById.get(endpointId(relation.target))?.title ?? endpointId(relation.target);
      const direction = relation.directed ? `${escapeHtml(source)} → ${escapeHtml(target)}` : "Undirected";
      const similarity = relation.similarity === null ? "" : ` · ${relation.similarity.toFixed(4)}`;
      return `<span>${escapeHtml(relation.linkType)} · ${direction}${similarity}</span>`;
    }).join("");
    return `<div class="graph-tooltip"><strong>${escapeHtml(edge.family)}${relations.length > 1 ? ` · ${relations.length} relations` : ""}</strong><span>${edge.dashPattern.length ? "Dashed relation" : "Solid relation"}</span>${details}</div>`;
  }, [viewIndex]);
  const renderNodes = useMemo(() => graph.nodes.map((node) => ({ ...node, fx: node.x, fy: node.y, fz: node.z })), [graph.nodes]);
  const graphData = useMemo(() => ({
    nodes: renderNodes,
    links: visibleEdges.map((edge) => ({ ...edge })),
  }), [renderNodes, visibleEdges]);
  const map2DLayout = useMemo(() => createMap2DLayout(graph.nodes), [graph.nodes]);
  const haloGroups = useMemo(() => graph.semanticGroups.filter((semanticGroup) =>
    semanticGroup.kind !== "unclassified" && graph.nodes.some((node) => node.groupId === semanticGroup.id && node.hasEmbedding),
  ), [graph.nodes, graph.semanticGroups]);
  const haloMembersByGroup = useMemo(() => new Map(haloGroups.map((group) => [
    group.id,
    renderNodes.filter((node) => node.groupId === group.id && node.hasEmbedding),
  ])), [haloGroups, renderNodes]);
  const hoverFocusByGroup = useMemo(() => new Map(graph.semanticGroups.map((group) => [
    group.id,
    viewIndex.connectedToGroup(group.id, activeView),
  ])), [activeView, graph.semanticGroups, viewIndex]);

  const previousRenderSelectionRef = useRef<{
    selectedId: string | null;
    neighbors: ReadonlySet<string>;
    changedNodeIds: ReadonlySet<string>;
    impactNodeIds: ReadonlySet<string>;
  }>({
    selectedId: null,
    neighbors: new Set(),
    changedNodeIds: new Set(),
    impactNodeIds: new Set(),
  });
  useEffect(() => {
    const previous = previousRenderSelectionRef.current;
    const nextChanged = changedNodeIds ?? new Set<string>();
    const nextImpact = impactNodeIds ?? new Set<string>();
    const affected = new Set<string>();
    if (Boolean(previous.selectedId) !== Boolean(selectedId)) {
      for (const id of nodeObjectRegistryRef.current.keys()) affected.add(id);
    } else {
      for (const id of previous.neighbors) if (!neighbors.has(id)) affected.add(id);
      for (const id of neighbors) if (!previous.neighbors.has(id)) affected.add(id);
      if (previous.selectedId) affected.add(previous.selectedId);
      if (selectedId) affected.add(selectedId);
      for (const id of previous.changedNodeIds) if (!nextChanged.has(id)) affected.add(id);
      for (const id of nextChanged) if (!previous.changedNodeIds.has(id)) affected.add(id);
      for (const id of previous.impactNodeIds) if (!nextImpact.has(id)) affected.add(id);
      for (const id of nextImpact) if (!previous.impactNodeIds.has(id)) affected.add(id);
    }
    for (const id of affected) {
      const object = nodeObjectRegistryRef.current.get(id);
      const node = viewIndex.nodeById.get(id);
      if (object && node) updateNodeObject(object, node, nodeRenderState(id), texturePoolStateRef.current.pool);
    }
    const edgeIds = new Set<string>();
    if (Boolean(previous.selectedId) !== Boolean(selectedId)) {
      for (const id of edgeObjectRegistryRef.current.keys()) edgeIds.add(id);
    } else {
      for (const edge of activeEdges) {
        const source = endpointId(edge.source);
        const target = endpointId(edge.target);
        if (source === previous.selectedId || target === previous.selectedId || source === selectedId || target === selectedId) edgeIds.add(edge.id);
      }
    }
    for (const edge of activeEdges) {
      if (!edgeIds.has(edge.id)) continue;
      const object = edgeObjectRegistryRef.current.get(edge.id);
      if (!object) continue;
      const emphasized = Boolean(selectedId && (endpointId(edge.source) === selectedId || endpointId(edge.target) === selectedId));
      updateEdgeAppearance(object, edge, emphasized, Boolean(selectedId && !emphasized));
    }
    previousRenderSelectionRef.current = {
      selectedId,
      neighbors,
      changedNodeIds: nextChanged,
      impactNodeIds: nextImpact,
    };
  }, [activeEdges, changedNodeIds, impactNodeIds, neighbors, selectedId, viewIndex]);

  useEffect(() => () => {
    for (const object of nodeObjectRegistryRef.current.values()) disposeNodeObject(object, texturePoolStateRef.current.pool);
    nodeObjectRegistryRef.current.clear();
    edgeObjectRegistryRef.current.clear();
    texturePoolStateRef.current.pool.dispose();
  }, []);
  const syncHaloTransforms = useCallback(() => {
    const root = haloRootRef.current;
    if (!root) return;
    for (const semanticGroup of haloGroups) {
      const members = haloMembersByGroup.get(semanticGroup.id) ?? [];
      const transform = haloTransformForNodes(members, flatnessRef.current);
      if (!transform) continue;
      for (const object of root.children) {
        if (!(object instanceof THREE.Mesh) || object.userData.haloGroupId !== semanticGroup.id) continue;
        object.position.set(...transform.center);
        const scale = object.userData.haloLayer === "outer" ? 1.16 : 1;
        object.scale.set(transform.radii[0] * scale, transform.radii[1] * scale, transform.radii[2] * scale);
      }
    }
  }, [haloGroups, haloMembersByGroup]);

  const positionCommunityLabels = useCallback(() => {
    const camera = graphRef.current?.camera?.() as THREE.Camera | undefined;
    const layer = labelLayerRef.current;
    const root = haloRootRef.current;
    if (!camera || !layer || !root || !labelsOn) return;
    const selectedGroupId = graph.nodes.find((node) => node.id === selectedId)?.groupId ?? null;
    const projected = root.children.filter((object) => object.userData.haloLayer === "outer").map((object) => {
      const points: THREE.Vector3[] = [];
      for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1]) {
        points.push(new THREE.Vector3(
          object.position.x + sx * object.scale.x,
          object.position.y + sy * object.scale.y,
          object.position.z + sz * object.scale.z,
        ).project(camera));
      }
      const xs = points.map((point) => (point.x + 1) * size.width / 2);
      const ys = points.map((point) => (1 - point.y) * size.height / 2);
      const id = String(object.userData.haloGroupId);
      const priority = id === hoveredGroupIdRef.current || id === focusedCommunityIdRef.current
        ? 3
        : id === selectedGroupId ? 2 : 0;
      return { id, priority, anchor: { x: (Math.min(...xs) + Math.max(...xs)) / 2, y: Math.min(...ys) - 8 } };
    });
    viewMorphControllerRef.current.captureLabels(layer);
    const elements = viewMorphControllerRef.current.labelByGroupId;
    const candidates = projected.flatMap((item) => {
      const element = elements.get(item.id);
      if (!element) return [];
      let labelSize = labelSizeRef.current.get(item.id);
      if (!labelSize) {
        labelSize = { width: element.offsetWidth, height: element.offsetHeight };
        labelSizeRef.current.set(item.id, labelSize);
      }
      return [{ ...item, size: labelSize }];
    });
    const reserved = size.width >= 768 ? [
      { left: 0, top: 0, width: Math.min(360, size.width * 0.32), height: 220 },
      { left: Math.max(0, size.width - 330), top: 0, width: 330, height: Math.min(480, size.height * 0.7) },
      { left: Math.max(0, size.width / 2 - 360), top: Math.max(0, size.height - 110), width: 720, height: 110 },
    ] : [];
    const placements = placeCommunityLabels(candidates, size, reserved);
    for (const element of elements.values()) element.style.opacity = "0";
    for (const placement of placements) {
      const element = elements.get(placement.id);
      if (!element) continue;
      const transform = `translate3d(${placement.left}px,${placement.top}px,0)`;
      if (element.style.transform !== transform) element.style.transform = transform;
      element.dataset.labelLeft = String(placement.left);
      element.dataset.labelTop = String(placement.top);
      element.style.opacity = placement.visible ? "1" : "0";
    }
  }, [graph.nodes, labelsOn, selectedId, size]);
  const updatePointerDiagnostics = useCallback(() => {
    if (!diagnosticsEnabled) return;
    const container = containerRef.current;
    const camera = graphRef.current?.camera?.() as THREE.Camera | undefined;
    if (!container || !camera) return;
    const bounds = container.getBoundingClientRect();
    const renderNodeById = new Map(renderNodes.map((node) => [node.id, node]));
    const nodeHoverPoints = renderNodes.flatMap((node) => {
      const projected = new THREE.Vector3(Number(node.x ?? 0), Number(node.y ?? 0), Number(node.z ?? 0)).project(camera);
      if (Math.abs(projected.x) > 1 || Math.abs(projected.y) > 1 || projected.z < -1 || projected.z > 1) return [];
      return [{
        id: node.id,
        x: Math.round(bounds.left + (projected.x + 1) * bounds.width / 2),
        y: Math.round(bounds.top + (1 - projected.y) * bounds.height / 2),
      }];
    });
    const edgeHoverPoints = visibleEdgesRef.current.flatMap((edge) => {
      const source = renderNodeById.get(endpointId(edge.source));
      const target = renderNodeById.get(endpointId(edge.target));
      if (!source || !target) return [];
      const projected = new THREE.Vector3(
        (Number(source.x ?? 0) + Number(target.x ?? 0)) / 2,
        (Number(source.y ?? 0) + Number(target.y ?? 0)) / 2,
        (Number(source.z ?? 0) + Number(target.z ?? 0)) / 2,
      ).project(camera);
      if (Math.abs(projected.x) > 1 || Math.abs(projected.y) > 1 || projected.z < -1 || projected.z > 1) return [];
      return [{
        x: Math.round(bounds.left + (projected.x + 1) * bounds.width / 2),
        y: Math.round(bounds.top + (1 - projected.y) * bounds.height / 2),
      }];
    });
    container.dataset.nodeHoverPoints = JSON.stringify(nodeHoverPoints);
    container.dataset.edgeHoverPoints = JSON.stringify(edgeHoverPoints);
  }, [diagnosticsEnabled, renderNodes]);
  const moveCameraToNodeIds = useCallback((ids: ReadonlySet<string>, duration = 500) => {
    const nodes = renderNodes.filter((node) => ids.has(node.id));
    const camera = graphRef.current?.camera?.() as THREE.Camera | undefined;
    const pose = cameraPoseForNodes(nodes, viewModeRef.current, {
      x: Number(camera?.position.x ?? 210),
      y: Number(camera?.position.y ?? 155),
      z: Number(camera?.position.z ?? 245),
    });
    const reducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
    if (pose) graphRef.current?.cameraPosition(pose.position, pose.target, reducedMotion ? 0 : duration);
  }, [renderNodes]);
  const fit = useCallback((duration = 500) => {
    const effectiveDuration = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ? 0 : duration;
    if (viewModeRef.current === "2d") {
      graphRef.current?.cameraPosition({ x: 0, y: 0, z: Math.max(220, map2DLayout.extent * 2.5) }, { x: 0, y: 0, z: 0 }, effectiveDuration);
      return;
    }
    graphRef.current?.zoomToFit(effectiveDuration, 14);
  }, [map2DLayout.extent]);
  const reset = useCallback((duration = 500) => {
    const effectiveDuration = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ? 0 : duration;
    graphRef.current?.cameraPosition(
      viewModeRef.current === "2d" ? { x: 0, y: 0, z: Math.max(220, map2DLayout.extent * 2.5) } : { x: 210, y: 155, z: 245 },
      { x: 0, y: 0, z: 0 },
      effectiveDuration,
    );
  }, [map2DLayout.extent]);
  useImperativeHandle(ref, () => ({ fit: () => fit(), reset }), [fit, reset]);
  useEffect(() => {
    if (selectedId) return;
    reset(0);
    const timer = window.setTimeout(() => fit(0), 250);
    return () => clearTimeout(timer);
  }, [graph.generatedAt, size.width, size.height]);

  useEffect(() => {
    const previous = previousSelectedIdRef.current;
    previousSelectedIdRef.current = selectedId;
    if (!selectedId && !focusedCommunityId && !skipClearFitRef.current && containerRef.current) containerRef.current.dataset.focusedCommunity = "";
    const dimensionChanging = viewModeRef.current !== viewMode;
    const reducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
    const timer = window.setTimeout(() => {
      if (selectedId && neighbors.size) moveCameraToNodeIds(neighbors);
      else if (previous && !skipClearFitRef.current) fit();
      skipClearFitRef.current = false;
    }, cameraFocusDelayMs(dimensionChanging, reducedMotion));
    return () => clearTimeout(timer);
  }, [activeEdges, focusedCommunityId, graph.generatedAt, moveCameraToNodeIds, neighbors, selectedId, viewMode]);

  useEffect(() => {
    if (!labelsOn) return;
    labelSizeRef.current.clear();
    const controls = graphRef.current?.controls?.();
    let pendingFrame: number | null = null;
    const update = () => {
      if (pendingFrame !== null) return;
      pendingFrame = requestAnimationFrame(() => {
        pendingFrame = null;
        positionCommunityLabels();
      });
    };
    controls?.addEventListener?.("change", update);
    update();
    const timer = window.setTimeout(update, 350);
    return () => {
      controls?.removeEventListener?.("change", update);
      if (pendingFrame !== null) cancelAnimationFrame(pendingFrame);
      clearTimeout(timer);
    };
  }, [labelsOn, positionCommunityLabels]);

  useEffect(() => {
    const controls = graphRef.current?.controls?.();
    const update = () => {
      const camera = graphRef.current?.camera?.() as THREE.Camera | undefined;
      const target = controls?.target as THREE.Vector3 | undefined;
      const container = containerRef.current;
      if (!camera || !container) return;
      container.dataset.cameraX = camera.position.x.toFixed(3);
      container.dataset.cameraY = camera.position.y.toFixed(3);
      container.dataset.cameraZ = camera.position.z.toFixed(3);
      if (target) {
        container.dataset.cameraTargetX = target.x.toFixed(3);
        container.dataset.cameraTargetY = target.y.toFixed(3);
        container.dataset.cameraTargetZ = target.z.toFixed(3);
      }
      updatePointerDiagnostics();
    };
    controls?.addEventListener?.("change", update);
    update();
    return () => controls?.removeEventListener?.("change", update);
  }, [sceneReadyTick, updatePointerDiagnostics]);

  useEffect(() => { hoveredGroupIdRef.current = null; }, [labelsOn]);

  useEffect(() => {
    const scene = graphRef.current?.scene?.() as THREE.Scene | undefined;
    if (!scene) return;
    const root = new THREE.Group();
    root.name = "leiden-community-halos";
    root.renderOrder = -10;
    for (const semanticGroup of haloGroups) {
      root.add(...createCommunityHaloMeshes(semanticGroup.id, semanticGroup.color));
    }
    scene.add(root);
    haloRootRef.current = root;
    syncHaloTransforms();
    positionCommunityLabels();
    return () => {
      if (haloRootRef.current === root) haloRootRef.current = null;
      scene.remove(root);
      disposeHaloRoot(root);
    };
  }, [graph.generatedAt, haloGroups, positionCommunityLabels, sceneReadyTick, syncHaloTransforms]);

  useEffect(() => {
    const selectedGroupId = graph.nodes.find((node) => node.id === selectedId)?.groupId ?? null;
    for (const object of haloRootRef.current?.children ?? []) {
      if (!(object instanceof THREE.Mesh) || typeof object.userData.haloGroupId !== "string") continue;
      const selected = object.userData.haloGroupId === selectedGroupId;
      const baseOpacity = object.userData.haloLayer === "inner"
        ? selected ? 0.12 : selectedGroupId ? 0.016 : 0.06
        : selected ? 0.085 : selectedGroupId ? 0.01 : 0.038;
      object.userData.baseOpacity = baseOpacity;
      if (!hoveredGroupIdRef.current) (object.material as THREE.MeshBasicMaterial).opacity = baseOpacity;
    }
  }, [graph.nodes, selectedId]);

  const setHoveredGroup = useCallback((next: string | null) => {
    const current = hoveredGroupIdRef.current;
    if (current === next) return;
    const labels = labelLayerRef.current?.querySelectorAll<HTMLElement>("[data-group-label]") ?? [];
    for (const label of labels) {
      const hovered = label.dataset.groupLabel === next;
      label.style.color = next ? hovered ? COMMUNITY_LABEL_STYLE.hoverColor : COMMUNITY_LABEL_STYLE.dimColor : COMMUNITY_LABEL_STYLE.color;
      label.style.backgroundColor = next ? hovered ? COMMUNITY_LABEL_STYLE.hoverBackgroundColor : COMMUNITY_LABEL_STYLE.dimBackgroundColor : COMMUNITY_LABEL_STYLE.backgroundColor;
    }
    for (const object of haloRootRef.current?.children ?? []) {
      if (!(object instanceof THREE.Mesh) || typeof object.userData.haloGroupId !== "string") continue;
      const material = object.material as THREE.MeshBasicMaterial;
      if (!next) material.opacity = Number(object.userData.baseOpacity);
      else if (object.userData.haloGroupId === next) material.opacity = object.userData.haloLayer === "inner" ? 0.17 : 0.105;
      else material.opacity = object.userData.haloLayer === "inner" ? 0.012 : 0.006;
    }
    const focused = next ? hoverFocusByGroup.get(next) ?? new Set<string>() : null;
    if (containerRef.current) {
      containerRef.current.dataset.hoveredGroup = next ?? "";
      containerRef.current.dataset.hoverFocusCount = String(focused?.size ?? 0);
    }
    const scene = graphRef.current?.scene?.() as THREE.Scene | undefined;
    scene?.traverse((object) => {
      if (object.name !== "memory-node-object" || typeof object.userData.nodeId !== "string") return;
      const billboard = object.getObjectByName("node-billboard") as THREE.Sprite | undefined;
      if (!billboard) return;
      const material = billboard.material as THREE.SpriteMaterial;
      if (!focused) {
        material.opacity = Number(billboard.userData.baseOpacity ?? 0.96);
        object.scale.setScalar(1);
        return;
      }
      const emphasized = focused.has(object.userData.nodeId);
      material.opacity = emphasized ? 1 : 0.055;
      object.scale.setScalar(emphasized ? 1.1 : 1);
    });
    hoveredGroupIdRef.current = next;
    window.requestAnimationFrame(positionCommunityLabels);
  }, [hoverFocusByGroup, positionCommunityLabels]);

  const clearCommunityFocus = useCallback((returnToOverview = true, notify = true) => {
    const hadFocus = focusedCommunityIdRef.current !== null;
    focusedCommunityIdRef.current = null;
    skipClearFitRef.current = false;
    if (hadFocus && notify) onCommunityFocus(null);
    if (containerRef.current) {
      containerRef.current.dataset.focusedCommunity = "";
      containerRef.current.dataset.focusedCommunityMemberCount = "0";
    }
    if (hadFocus && returnToOverview) fit();
    window.requestAnimationFrame(positionCommunityLabels);
    return hadFocus;
  }, [fit, onCommunityFocus, positionCommunityLabels]);

  const haloGroupAt = useCallback((clientX: number, clientY: number) => {
    const camera = graphRef.current?.camera?.() as THREE.Camera | undefined;
    const root = haloRootRef.current;
    const container = containerRef.current;
    if (!camera || !root || !container) return null;
    const bounds = container.getBoundingClientRect();
    const pointer = new THREE.Vector2(
      ((clientX - bounds.left) / bounds.width) * 2 - 1,
      -((clientY - bounds.top) / bounds.height) * 2 + 1,
    );
    const raycaster = haloRaycasterRef.current;
    raycaster.setFromCamera(pointer, camera);
    const hit = raycaster.intersectObjects(root.children.filter((object) => Boolean(object.userData.groupId)), false)[0];
    return typeof hit?.object.userData.groupId === "string" ? hit.object.userData.groupId : null;
  }, []);

  const handlePointerMove = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    setHoveredGroup(haloGroupAt(event.clientX, event.clientY));
  }, [haloGroupAt, setHoveredGroup]);

  const handleBackgroundClick = useCallback((event: MouseEvent) => {
    const groupId = haloGroupAt(event.clientX, event.clientY);
    if (!groupId) {
      clearCommunityFocus();
      onSelect(null);
      return;
    }
    focusedCommunityIdRef.current = groupId;
    skipClearFitRef.current = true;
    onSelect(null);
    onCommunityFocus(groupId);
    window.requestAnimationFrame(positionCommunityLabels);
    const members = new Set((haloMembersByGroup.get(groupId) ?? []).map((node) => node.id));
    moveCameraToNodeIds(members);
    if (containerRef.current) {
      containerRef.current.dataset.focusedCommunity = groupId;
      containerRef.current.dataset.focusedCommunityMemberCount = String(members.size);
    }
  }, [clearCommunityFocus, haloGroupAt, haloMembersByGroup, moveCameraToNodeIds, onCommunityFocus, onSelect, positionCommunityLabels]);

  const handleNodeClick = useCallback((raw: object) => {
    clearCommunityFocus(false, false);
    onSelect((raw as GraphNode).id);
  }, [clearCommunityFocus, onSelect]);

  useEffect(() => {
    if (focusedCommunityIdRef.current === (focusedCommunityId ?? null)) return;
    if (!focusedCommunityId) {
      clearCommunityFocus(false, false);
      return;
    }
    focusedCommunityIdRef.current = focusedCommunityId;
    const members = new Set((haloMembersByGroup.get(focusedCommunityId) ?? []).map((node) => node.id));
    moveCameraToNodeIds(members);
    if (containerRef.current) {
      containerRef.current.dataset.focusedCommunity = focusedCommunityId;
      containerRef.current.dataset.focusedCommunityMemberCount = String(members.size);
    }
    window.requestAnimationFrame(positionCommunityLabels);
  }, [clearCommunityFocus, focusedCommunityId, haloMembersByGroup, moveCameraToNodeIds, positionCommunityLabels]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || !focusedCommunityIdRef.current) return;
      event.preventDefault();
      setHoveredGroup(null);
      clearCommunityFocus();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [clearCommunityFocus, setHoveredGroup]);

  useEffect(() => {
    if (!selectedId || !focusedCommunityIdRef.current) return;
    clearCommunityFocus(false, false);
  }, [clearCommunityFocus, selectedId]);

  useEffect(() => { setHoveredGroup(null); }, [graph.generatedAt, labelsOn, selectedId, setHoveredGroup, viewMode]);

  useEffect(() => {
    const container = containerRef.current;
    const scene = graphRef.current?.scene?.() as THREE.Scene | undefined;
    const targetFlatness = viewMode === "2d" ? 1 : 0;
    const startFlatness = flatnessRef.current;
    const targetById = new Map(graph.nodes.map((node) => [
      node.id,
      viewMode === "2d" ? map2DLayout.positions[node.id]! : { x: node.x, y: node.y, z: node.z },
    ]));
    const starts = new Map(renderNodes.map((node) => [node.id, {
      x: Number(node.x ?? 0),
      y: Number(node.y ?? 0),
      z: Number(node.z ?? 0),
    }]));
    const renderNodeById = new Map(renderNodes.map((node) => [node.id, node]));
    const morphController = viewMorphControllerRef.current;
    morphController.capture(scene, labelLayerRef.current);
    const nodeObjectById = morphController.nodeObjectById;
    const edgeObjects = morphController.edgeObjects;
    const explicitEdgeObjects = edgeObjects.filter((object) => (object.userData.edge as GraphEdge).kind !== "semantic");
    const semanticEdgeObjects = edgeObjects.filter((object) => (object.userData.edge as GraphEdge).kind === "semantic");
    const restoreEdgeOpacity = (objects: LineSegments2[]) => {
      for (const object of objects) {
        const material = object.material;
        material.opacity = Number(object.userData.baseOpacity ?? material.opacity);
      }
    };
    const updateEdgeObjects = (objects: LineSegments2[]) => {
      for (const object of objects) {
        const edge = object.userData.edge as GraphEdge;
        const source = renderNodeById.get(endpointId(edge.source));
        const target = renderNodeById.get(endpointId(edge.target));
        if (!source || !target) continue;
        updateEdgeObject(object, {
          start: { x: Number(source.x ?? 0), y: Number(source.y ?? 0), z: Number(source.z ?? 0) },
          end: { x: Number(target.x ?? 0), y: Number(target.y ?? 0), z: Number(target.z ?? 0) },
        }, edge);
      }
    };
    const updateSceneDiagnostics = () => {
      if (!diagnosticsEnabled || !container || !scene) return;
      const liveNodeObjects = new Map<string, THREE.Object3D>();
      scene.traverse((object) => {
        if (object.name === "memory-node-object" && typeof object.userData.nodeId === "string" && object.visible) {
          liveNodeObjects.set(object.userData.nodeId, object);
        }
      });
      let maximumNodePositionError = 0;
      let maximumSceneDepth = 0;
      for (const node of renderNodes) {
        const object = liveNodeObjects.get(node.id);
        if (!object) continue;
        maximumNodePositionError = Math.max(maximumNodePositionError, object.position.distanceTo(new THREE.Vector3(
          Number(node.x ?? 0), Number(node.y ?? 0), Number(node.z ?? 0),
        )));
        maximumSceneDepth = Math.max(maximumSceneDepth, Math.abs(object.position.z));
      }
      let maximumHaloCenterError = 0;
      let maximumHaloContainmentError = 0;
      for (const semanticGroup of haloGroups) {
        const members = haloMembersByGroup.get(semanticGroup.id) ?? [];
        if (!members.length) continue;
        const minimum = [Infinity, Infinity, Infinity];
        const maximum = [-Infinity, -Infinity, -Infinity];
        for (const member of members) {
          const values = [Number(member.x ?? 0), Number(member.y ?? 0), Number(member.z ?? 0)];
          for (let axis = 0; axis < 3; axis += 1) {
            minimum[axis] = Math.min(minimum[axis]!, values[axis]!);
            maximum[axis] = Math.max(maximum[axis]!, values[axis]!);
          }
        }
        const expected = new THREE.Vector3(
          (minimum[0]! + maximum[0]!) / 2,
          (minimum[1]! + maximum[1]!) / 2,
          (minimum[2]! + maximum[2]!) / 2,
        );
        const halo = haloRootRef.current?.children.find((object) =>
          object.userData.haloGroupId === semanticGroup.id && object.userData.haloLayer === "inner");
        if (halo) {
          maximumHaloCenterError = Math.max(maximumHaloCenterError, halo.position.distanceTo(expected));
          for (const member of members) {
            maximumHaloContainmentError = Math.max(
              maximumHaloContainmentError,
              Math.abs(Number(member.x ?? 0) - halo.position.x) - halo.scale.x,
              Math.abs(Number(member.y ?? 0) - halo.position.y) - halo.scale.y,
              Math.abs(Number(member.z ?? 0) - halo.position.z) - halo.scale.z,
            );
          }
        }
      }
      const camera = graphRef.current?.camera?.() as THREE.Camera | undefined;
      container.dataset.coordinateMode = viewMode;
      container.dataset.sceneNodeCount = String(liveNodeObjects.size);
      container.dataset.sceneDepth = maximumSceneDepth.toFixed(3);
      container.dataset.sceneNodePositionError = maximumNodePositionError.toFixed(6);
      container.dataset.haloCenterError = maximumHaloCenterError.toFixed(6);
      container.dataset.haloContainmentError = Math.max(0, maximumHaloContainmentError).toFixed(6);
      container.dataset.cameraX = Number(camera?.position.x ?? 0).toFixed(3);
      container.dataset.cameraY = Number(camera?.position.y ?? 0).toFixed(3);
      container.dataset.cameraZ = Number(camera?.position.z ?? 0).toFixed(3);
      if (camera) {
        const bounds = container.getBoundingClientRect();
        const nodeHoverPoints = renderNodes.flatMap((node) => {
          const projected = new THREE.Vector3(Number(node.x ?? 0), Number(node.y ?? 0), Number(node.z ?? 0)).project(camera);
          if (Math.abs(projected.x) > 1 || Math.abs(projected.y) > 1 || projected.z < -1 || projected.z > 1) return [];
          return [{
            id: node.id,
            x: Math.round(bounds.left + (projected.x + 1) * bounds.width / 2),
            y: Math.round(bounds.top + (1 - projected.y) * bounds.height / 2),
          }];
        });
        const hoverPoints = visibleEdgesRef.current.flatMap((edge) => {
          const source = renderNodeById.get(endpointId(edge.source));
          const target = renderNodeById.get(endpointId(edge.target));
          if (!source || !target) return [];
          const projected = new THREE.Vector3(
            (Number(source.x ?? 0) + Number(target.x ?? 0)) / 2,
            (Number(source.y ?? 0) + Number(target.y ?? 0)) / 2,
            (Number(source.z ?? 0) + Number(target.z ?? 0)) / 2,
          ).project(camera);
          if (Math.abs(projected.x) > 1 || Math.abs(projected.y) > 1 || projected.z < -1 || projected.z > 1) return [];
          return [{
            x: Math.round(bounds.left + (projected.x + 1) * bounds.width / 2),
            y: Math.round(bounds.top + (1 - projected.y) * bounds.height / 2),
          }];
        });
        container.dataset.nodeHoverPoints = JSON.stringify(nodeHoverPoints);
        container.dataset.edgeHoverPoints = JSON.stringify(hoverPoints);
      }
    };
    if (edgeFadeFrameRef.current !== null) cancelAnimationFrame(edgeFadeFrameRef.current);
    edgeFadeFrameRef.current = null;
    restoreEdgeOpacity(edgeObjects);
    const controls = graphRef.current?.controls?.() as any;
    const reducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
    const changesDimension = Math.abs(targetFlatness - startFlatness) > 1e-6;
    const duration = reducedMotion || !changesDimension ? 0 : 1050;
    const haloObjects = (haloRootRef.current?.children ?? []).filter((object): object is THREE.Mesh => object instanceof THREE.Mesh);
    let haloMorphBatch: MorphHaloBatch | null = null;
    let nodeMorphBatch: MorphNodeBatch | null = null;
    let explicitMorphLine: THREE.LineSegments | null = null;
    let explicitMorphPositions: Float32Array<ArrayBuffer> | null = null;
    let explicitMorphColors: Float32Array<ArrayBuffer> | null = null;
    let explicitMorphPositionAttribute: THREE.BufferAttribute | null = null;
    let semanticMorphLine: THREE.LineSegments | null = null;
    let semanticMorphPositions: Float32Array<ArrayBuffer> | null = null;
    let semanticMorphPositionAttribute: THREE.BufferAttribute | null = null;
    const updateSemanticMorphLine = () => {
      if (!semanticMorphLine || !semanticMorphPositions) return;
      let offset = 0;
      for (const object of semanticEdgeObjects) {
        const edge = object.userData.edge as GraphEdge;
        const source = renderNodeById.get(endpointId(edge.source));
        const target = renderNodeById.get(endpointId(edge.target));
        if (!source || !target) continue;
        semanticMorphPositions[offset++] = Number(source.x ?? 0);
        semanticMorphPositions[offset++] = Number(source.y ?? 0);
        semanticMorphPositions[offset++] = Number(source.z ?? 0);
        semanticMorphPositions[offset++] = Number(target.x ?? 0);
        semanticMorphPositions[offset++] = Number(target.y ?? 0);
        semanticMorphPositions[offset++] = Number(target.z ?? 0);
      }
      semanticMorphLine.geometry.getAttribute("position").needsUpdate = true;
      semanticMorphLine.geometry.setDrawRange(0, offset / 3);
    };
    const updateExplicitMorphLine = () => {
      if (!explicitMorphLine || !explicitMorphPositions || !explicitMorphColors) return;
      let offset = 0;
      const color = new THREE.Color();
      for (const object of explicitEdgeObjects) {
        const edge = object.userData.edge as GraphEdge;
        const source = renderNodeById.get(endpointId(edge.source));
        const target = renderNodeById.get(endpointId(edge.target));
        if (!source || !target) continue;
        const segments = edgeSegmentPositions(
          edge,
          { x: Number(source.x ?? 0), y: Number(source.y ?? 0), z: Number(source.z ?? 0) },
          { x: Number(target.x ?? 0), y: Number(target.y ?? 0), z: Number(target.z ?? 0) },
        );
        color.set(edge.color);
        for (let index = 0; index < segments.length; index += 3) {
          explicitMorphPositions[offset] = segments[index]!;
          explicitMorphPositions[offset + 1] = segments[index + 1]!;
          explicitMorphPositions[offset + 2] = segments[index + 2]!;
          explicitMorphColors[offset] = color.r;
          explicitMorphColors[offset + 1] = color.g;
          explicitMorphColors[offset + 2] = color.b;
          offset += 3;
        }
      }
      explicitMorphLine.geometry.getAttribute("position").needsUpdate = true;
      explicitMorphLine.geometry.getAttribute("color").needsUpdate = true;
      explicitMorphLine.geometry.setDrawRange(0, offset / 3);
    };
    const removeExplicitMorphLine = () => {
      if (!explicitMorphLine) return;
      scene?.remove(explicitMorphLine);
      explicitMorphLine.geometry.dispose();
      (explicitMorphLine.material as THREE.Material).dispose();
      explicitMorphLine = null;
      explicitMorphPositions = null;
      explicitMorphColors = null;
      explicitMorphPositionAttribute = null;
    };
    const removeSemanticMorphLine = () => {
      if (!semanticMorphLine) return;
      scene?.remove(semanticMorphLine);
      semanticMorphLine.geometry.dispose();
      (semanticMorphLine.material as THREE.Material).dispose();
      semanticMorphLine = null;
      semanticMorphPositions = null;
      semanticMorphPositionAttribute = null;
    };
    const removeNodeMorphBatch = () => {
      if (!nodeMorphBatch) return;
      scene?.remove(nodeMorphBatch.object);
      nodeMorphBatch.dispose();
      nodeMorphBatch = null;
    };
    const removeHaloMorphBatch = () => {
      if (!haloMorphBatch) return;
      scene?.remove(haloMorphBatch.object);
      haloMorphBatch.dispose();
      haloMorphBatch = null;
    };
    if (duration && scene && haloObjects.length) {
      haloMorphBatch = createMorphHaloBatch(haloObjects);
      if (haloMorphBatch) {
        scene.add(haloMorphBatch.object);
        for (const object of haloObjects) object.visible = false;
      }
    }
    if (duration && scene && nodeObjectById.size) {
      nodeMorphBatch = createMorphNodeBatch(
        renderNodes,
        selectedId,
        neighbors,
        size.height * Math.min(window.devicePixelRatio || 1, 2),
      );
      scene.add(nodeMorphBatch.object);
      for (const object of nodeObjectById.values()) object.visible = false;
    }
    if (duration && scene && explicitEdgeObjects.length) {
      let explicitFloatCapacity = 0;
      for (const object of explicitEdgeObjects) {
        const edge = object.userData.edge as GraphEdge;
        const sourceId = endpointId(edge.source);
        const targetId = endpointId(edge.target);
        const sourceStart = starts.get(sourceId);
        const targetStart = starts.get(targetId);
        const sourceEnd = targetById.get(sourceId);
        const targetEnd = targetById.get(targetId);
        if (!sourceStart || !targetStart || !sourceEnd || !targetEnd) continue;
        explicitFloatCapacity += Math.max(
          edgeSegmentPositions(edge, sourceStart, targetStart).length,
          edgeSegmentPositions(edge, sourceEnd, targetEnd).length,
        );
      }
      explicitMorphPositions = new Float32Array(explicitFloatCapacity);
      explicitMorphColors = new Float32Array(explicitFloatCapacity);
      const geometry = new THREE.BufferGeometry();
      explicitMorphPositionAttribute = new THREE.BufferAttribute(explicitMorphPositions, 3).setUsage(THREE.DynamicDrawUsage);
      geometry.setAttribute("position", explicitMorphPositionAttribute);
      geometry.setAttribute("color", new THREE.BufferAttribute(explicitMorphColors, 3).setUsage(THREE.DynamicDrawUsage));
      explicitMorphLine = new THREE.LineSegments(geometry, new THREE.LineBasicMaterial({
        vertexColors: true,
        transparent: true,
        opacity: 0.68,
        depthWrite: false,
        toneMapped: false,
      }));
      explicitMorphLine.name = "explicit-morph-batch";
      explicitMorphLine.frustumCulled = false;
      explicitMorphLine.renderOrder = 1;
      scene.add(explicitMorphLine);
      for (const object of explicitEdgeObjects) object.visible = false;
      updateExplicitMorphLine();
    }
    if (duration && scene && semanticEdgeObjects.length) {
      semanticMorphPositions = new Float32Array(semanticEdgeObjects.length * 6);
      const geometry = new THREE.BufferGeometry();
      semanticMorphPositionAttribute = new THREE.BufferAttribute(semanticMorphPositions, 3).setUsage(THREE.DynamicDrawUsage);
      geometry.setAttribute("position", semanticMorphPositionAttribute);
      const firstSemanticEdge = semanticEdgeObjects[0]!.userData.edge as GraphEdge;
      semanticMorphLine = new THREE.LineSegments(geometry, new THREE.LineBasicMaterial({
        color: firstSemanticEdge.color,
        transparent: true,
        opacity: 0.12,
        depthWrite: false,
      }));
      semanticMorphLine.name = "semantic-morph-batch";
      semanticMorphLine.frustumCulled = false;
      semanticMorphLine.renderOrder = -1;
      scene.add(semanticMorphLine);
      for (const object of semanticEdgeObjects) object.visible = false;
      updateSemanticMorphLine();
    }
    let settleTimer: number | null = null;
    let frameCount = 0;
    let sampledFrameCount = 0;
    let sampledFrameDuration = 0;
    let externalStallCount = 0;
    const animationStartedAt = performance.now();
    const cameraPosition = viewMode === "2d"
      ? { x: 0, y: 0, z: Math.max(220, map2DLayout.extent * 2.5) }
      : { x: 210, y: 155, z: 245 };
    viewModeRef.current = viewMode;
    configureNavigationControls(controls, viewMode);
    if (container) {
      container.dataset.viewTransitioning = duration ? "true" : "false";
      container.dataset.morphProgress = "0";
      container.dataset.morphFrameCount = "0";
      container.dataset.morphFps = "0";
      container.dataset.morphDirectNodeCount = String(nodeObjectById.size);
      container.dataset.morphExplicitEdgeCount = String(explicitEdgeObjects.length);
      container.dataset.morphSemanticEdgeCount = String(semanticEdgeObjects.length);
      container.dataset.morphSemanticBatched = semanticMorphLine ? "true" : "false";
      container.dataset.morphNodesBatched = nodeMorphBatch ? "true" : "false";
      container.dataset.morphHalosBatched = haloMorphBatch ? "true" : "false";
      container.dataset.morphExplicitBatched = explicitMorphLine ? "true" : "false";
    }
    graphRef.current?.cameraPosition(
      cameraPosition,
      { x: 0, y: 0, z: 0 },
      duration,
    );

    const applyProgress = (rawProgress: number) => {
      const progress = easeInOutCubic(rawProgress);
      flatnessRef.current = startFlatness + (targetFlatness - startFlatness) * progress;
      let maximumDepth = 0;
      for (const node of renderNodes) {
        const start = starts.get(node.id)!;
        const target = targetById.get(node.id)!;
        node.x = start.x + (target.x - start.x) * progress;
        node.y = start.y + (target.y - start.y) * progress;
        node.z = start.z + (target.z - start.z) * progress;
        node.fx = node.x;
        node.fy = node.y;
        node.fz = node.z;
        nodeObjectById.get(node.id)?.position.set(node.x, node.y, node.z);
        maximumDepth = Math.max(maximumDepth, Math.abs(node.z));
      }
      nodeMorphBatch?.updatePositions(renderNodes);
      updateExplicitMorphLine();
      updateSemanticMorphLine();
      syncHaloTransforms();
      haloMorphBatch?.update();
      positionCommunityLabels();
      if (container) {
        container.dataset.morphProgress = rawProgress.toFixed(3);
        container.dataset.mapDepth = maximumDepth.toFixed(3);
      }
    };

    const finish = () => {
      applyProgress(1);
      updateEdgeObjects(edgeObjects);
      const explicitBufferStable = !explicitMorphLine || explicitMorphLine.geometry.getAttribute("position") === explicitMorphPositionAttribute;
      const semanticBufferStable = !semanticMorphLine || semanticMorphLine.geometry.getAttribute("position") === semanticMorphPositionAttribute;
      removeHaloMorphBatch();
      for (const object of haloObjects) object.visible = true;
      removeNodeMorphBatch();
      for (const object of nodeObjectById.values()) object.visible = true;
      removeExplicitMorphLine();
      for (const object of explicitEdgeObjects) object.visible = true;
      removeSemanticMorphLine();
      for (const object of semanticEdgeObjects) object.visible = true;
      if (duration && semanticEdgeObjects.length) {
        const fadeStartedAt = performance.now();
        const fadeDuration = 210;
        const fadeSemanticEdges = (now: number) => {
          const progress = Math.min(1, (now - fadeStartedAt) / fadeDuration);
          const opacityFactor = 0.55 + 0.45 * easeInOutCubic(progress);
          for (const object of semanticEdgeObjects) {
            object.material.opacity = Number(object.userData.baseOpacity ?? object.material.opacity) * opacityFactor;
          }
          if (progress < 1) edgeFadeFrameRef.current = requestAnimationFrame(fadeSemanticEdges);
          else {
            edgeFadeFrameRef.current = null;
            restoreEdgeOpacity(semanticEdgeObjects);
          }
        };
        edgeFadeFrameRef.current = requestAnimationFrame(fadeSemanticEdges);
      } else restoreEdgeOpacity(edgeObjects);
      if (container) {
        const elapsedSeconds = Math.max(0.001, (performance.now() - animationStartedAt) / 1000);
        container.dataset.viewTransitioning = "false";
        container.dataset.morphFrameCount = String(frameCount);
        container.dataset.morphFps = duration && sampledFrameDuration > 0
          ? (sampledFrameCount * 1000 / sampledFrameDuration).toFixed(1)
          : "0";
        container.dataset.morphWallDuration = duration ? (elapsedSeconds * 1000).toFixed(0) : "0";
        container.dataset.morphExternalStalls = String(externalStallCount);
        container.dataset.morphExplicitBufferStable = String(explicitBufferStable);
        container.dataset.morphSemanticBufferStable = String(semanticBufferStable);
      }
      graphRef.current?.cameraPosition(cameraPosition, { x: 0, y: 0, z: 0 }, 0);
      controls?.update?.();
      let settleAttempts = 0;
      const settleScene = () => {
        syncHaloTransforms();
        positionCommunityLabels();
        updateSceneDiagnostics();
        settleAttempts += 1;
        if (settleAttempts < 3) settleTimer = window.setTimeout(settleScene, 260);
      };
      settleTimer = window.setTimeout(settleScene, 80);
      if (nodeObjectById.size < renderNodes.length) graphRef.current?.refresh?.();
    };

    if (!duration) {
      finish();
      return () => { if (settleTimer !== null) clearTimeout(settleTimer); };
    }
    let elapsed = 0;
    let previousFrameAt = performance.now();
    const frame = (now: number) => {
      frameCount += 1;
      const frameDuration = Math.max(0, now - previousFrameAt);
      if (frameDuration <= 120) {
        sampledFrameCount += 1;
        sampledFrameDuration += frameDuration;
      } else externalStallCount += 1;
      elapsed += Math.min(34, frameDuration);
      previousFrameAt = now;
      const progress = Math.min(1, elapsed / duration);
      applyProgress(progress);
      if (progress < 1) morphFrameRef.current = requestAnimationFrame(frame);
      else {
        morphFrameRef.current = null;
        finish();
      }
    };
    morphFrameRef.current = requestAnimationFrame(frame);
    return () => {
      if (morphFrameRef.current !== null) cancelAnimationFrame(morphFrameRef.current);
      morphFrameRef.current = null;
      if (edgeFadeFrameRef.current !== null) cancelAnimationFrame(edgeFadeFrameRef.current);
      edgeFadeFrameRef.current = null;
      removeHaloMorphBatch();
      for (const object of haloObjects) object.visible = true;
      removeNodeMorphBatch();
      for (const object of nodeObjectById.values()) object.visible = true;
      removeExplicitMorphLine();
      for (const object of explicitEdgeObjects) object.visible = true;
      removeSemanticMorphLine();
      for (const object of semanticEdgeObjects) object.visible = true;
      restoreEdgeOpacity(edgeObjects);
      if (settleTimer !== null) clearTimeout(settleTimer);
    };
  }, [diagnosticsEnabled, graph.generatedAt, graph.nodes, map2DLayout, positionCommunityLabels, renderNodes, sceneReadyTick, syncHaloTransforms, viewMode]);

  return (
    <div
      ref={containerRef}
      role="region"
      aria-label="Interactive Memory Map"
      aria-describedby="memory-graph-keyboard-help"
      className="relative h-full min-h-0 w-full overflow-hidden"
      data-testid="memory-graph"
      data-view-mode={viewMode}
      data-left-drag-action={viewMode === "2d" ? "pan" : "rotate"}
      data-view-transitioning="false"
      data-active-edge-count={activeEdges.length}
      data-active-neighbor-count={neighbors.size}
      data-selected-id={selectedId ?? ""}
      data-history-changed-count={changedNodeIds?.size ?? 0}
      data-direction-arrows="false"
      data-focused-community={focusedCommunityId ?? ""}
      data-focused-community-member-count={focusedCommunityId ? (haloMembersByGroup.get(focusedCommunityId)?.length ?? 0) : 0}
      data-2d-min-node-gap={map2DLayout.minimumNodeGap.toFixed(3)}
      data-2d-min-community-gap={map2DLayout.minimumCommunityGap.toFixed(3)}
      onPointerMove={handlePointerMove}
      onPointerLeave={() => setHoveredGroup(null)}
    >
      <p id="memory-graph-keyboard-help" className="sr-only">노드와 community를 키보드로 탐색하려면 Memory Map 검색 버튼 또는 Control/Command+K를 사용하세요.</p>
      <ForceGraph3D
        ref={graphRef} width={size.width} height={size.height} graphData={graphData} nodeId="id"
        backgroundColor="#080808" showNavInfo={false} enableNodeDrag={false} cooldownTicks={0} warmupTicks={0} d3AlphaMin={1}
        nodeThreeObject={renderNodeObject}
        nodeLabel={renderNodeTooltip}
        linkThreeObject={renderLinkObject}
        linkPositionUpdate={updateRenderedLinkPosition}
        linkCurvature={() => 0}
        linkDirectionalArrowLength={RELATION_DIRECTION_ARROW_LENGTH}
        linkLabel={renderLinkTooltip}
        onNodeClick={handleNodeClick} onBackgroundClick={handleBackgroundClick}
      />
      {labelsOn && <div ref={labelLayerRef} className="pointer-events-none absolute inset-0 z-20 overflow-hidden" aria-label="Community labels">
        {haloGroups.map((semanticGroup) => <div
          key={semanticGroup.id}
          data-group-label={semanticGroup.id}
          className="absolute whitespace-nowrap rounded px-2 py-1 text-[11px] font-medium leading-none opacity-0 transition-colors duration-100 will-change-transform"
          style={{ left: 0, top: 0, transform: "translate3d(0px,0px,0)", color: COMMUNITY_LABEL_STYLE.color, backgroundColor: COMMUNITY_LABEL_STYLE.backgroundColor }}
        >{communityLabelTitle(semanticGroup.label)}</div>)}
      </div>}
    </div>
  );
});
