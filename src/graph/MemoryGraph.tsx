import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import ForceGraph3D from "react-force-graph-3d";
import * as THREE from "three";
import { LineSegments2 } from "three/examples/jsm/lines/LineSegments2.js";
import type { GraphEdge, GraphNode, GraphResponse } from "../types";
import { COMMUNITY_LABEL_STYLE, communityLabelTitle, pixelAlignedLabelOrigin } from "./community-label";
import { cameraPoseForNodes } from "./camera";
import { activeGraphEdges, bundleGraphEdges, connectedNodeIdsForGroup, endpointId, neighborIdsForNode, type GraphLayerSettings, type RenderEdge } from "./graph-layers";
import { createCommunityHaloMeshes, disposeHaloRoot, haloTransformForNodes, nodesInCommunityHalo } from "./halo";
import { createMap2DLayout, easeInOutCubic, type MapViewMode } from "./layout-2d";
import { configureNavigationControls } from "./navigation-controls";
import { createMorphHaloBatch, type MorphHaloBatch } from "./morph-halo-batch";
import { createMorphNodeBatch, type MorphNodeBatch } from "./morph-node-batch";
import { createEdgeObject, createNodeObject, edgeSegmentPositions, updateEdgeObject } from "./rendering";
import { RELATION_DIRECTION_ARROW_LENGTH } from "./visual-spec";

export interface GraphControls { fit: () => void; reset: () => void }
interface Props {
  graph: GraphResponse;
  viewMode: MapViewMode;
  labelsOn: boolean;
  layers: GraphLayerSettings;
  selectedId: string | null;
  changedNodeIds?: ReadonlySet<string>;
  onSelect: (id: string | null) => void;
  onCommunityFocus: (id: string | null) => void;
}

const escapeHtml = (value: string) => value.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]!));

export const MemoryGraph = forwardRef<GraphControls, Props>(function MemoryGraph({ graph, viewMode, labelsOn, layers, selectedId, changedNodeIds, onSelect, onCommunityFocus }, ref) {
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
  const graphRef = useRef<any>(null);
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
  const activeEdges = useMemo(() => activeGraphEdges(graph, layers), [graph, layers]);
  const visibleEdges = useMemo<RenderEdge[]>(() => bundleGraphEdges(activeEdges), [activeEdges]);
  const visibleEdgesRef = useRef(visibleEdges);
  visibleEdgesRef.current = visibleEdges;
  const neighbors = useMemo(() => neighborIdsForNode(selectedId, activeEdges), [activeEdges, selectedId]);
  const renderNodeObject = useCallback((raw: object) => {
    const node = raw as GraphNode;
    const selected = node.id === selectedId;
    const adjacent = Boolean(selectedId && neighbors.has(node.id) && !selected);
    return createNodeObject(node, {
      selected,
      adjacent,
      dimmed: Boolean(selectedId && !neighbors.has(node.id)),
      showLabel: false,
      historyChanged: changedNodeIds?.has(node.id),
    });
  }, [changedNodeIds, neighbors, selectedId]);
  const renderNodeTooltip = useCallback((raw: object) => {
    const node = raw as GraphNode;
    const community = node.isUnclassified
      ? "Leiden · unclassified"
      : `Leiden internal-edge share · ${((node.communityStrength ?? 0) * 100).toFixed(0)}%`;
    return `<div class="graph-tooltip"><strong>${escapeHtml(node.title)}</strong><span>Type · ${escapeHtml(node.type)}</span><span>Community · ${escapeHtml(node.groupLabel)}</span><span>${community}</span><span>Source · ${escapeHtml(node.sourceName)}</span><span>Chunks · ${node.chunkCount}</span></div>`;
  }, []);
  const renderLinkObject = useCallback((raw: object) => {
    const edge = raw as GraphEdge;
    const emphasized = Boolean(selectedId && (endpointId(edge.source) === selectedId || endpointId(edge.target) === selectedId));
    return createEdgeObject(edge, emphasized, Boolean(selectedId && !emphasized));
  }, [selectedId]);
  const updateRenderedLinkPosition = useCallback((object: object, coordinates: object, raw: object) =>
    updateEdgeObject(object as THREE.Object3D, coordinates as { start: { x: number; y: number; z: number }; end: { x: number; y: number; z: number } }, raw as GraphEdge), []);
  const titleById = useMemo(() => new Map(graph.nodes.map((node) => [node.id, node.title])), [graph.nodes]);
  const renderLinkTooltip = useCallback((raw: object) => {
    const edge = raw as RenderEdge;
    const relations = edge.bundledEdges;
    const details = relations.map((relation) => {
      const source = titleById.get(endpointId(relation.source)) ?? endpointId(relation.source);
      const target = titleById.get(endpointId(relation.target)) ?? endpointId(relation.target);
      const direction = relation.directed ? `${escapeHtml(source)} → ${escapeHtml(target)}` : "Undirected";
      const similarity = relation.similarity === null ? "" : ` · ${relation.similarity.toFixed(4)}`;
      return `<span>${escapeHtml(relation.linkType)} · ${direction}${similarity}</span>`;
    }).join("");
    return `<div class="graph-tooltip"><strong>${escapeHtml(edge.family)}${relations.length > 1 ? ` · ${relations.length} relations` : ""}</strong><span>${edge.dashPattern.length ? "Dashed relation" : "Solid relation"}</span>${details}</div>`;
  }, [titleById]);
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
    nodesInCommunityHalo(renderNodes, group.id),
  ])), [haloGroups, renderNodes]);
  const hoverFocusByGroup = useMemo(() => new Map(graph.semanticGroups.map((group) => [
    group.id,
    connectedNodeIdsForGroup(graph.nodes, activeEdges, group.id),
  ])), [activeEdges, graph.nodes, graph.semanticGroups]);
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
      return { id: String(object.userData.haloGroupId), anchor: { x: (Math.min(...xs) + Math.max(...xs)) / 2, y: Math.min(...ys) - 8 } };
    });
    const elements = new Map([...layer.querySelectorAll<HTMLElement>("[data-group-label]")].map((element) => [element.dataset.groupLabel!, element]));
    for (const item of projected) {
      const element = elements.get(item.id);
      if (!element) continue;
      let labelSize = labelSizeRef.current.get(item.id);
      if (!labelSize) {
        labelSize = { width: element.offsetWidth, height: element.offsetHeight };
        labelSizeRef.current.set(item.id, labelSize);
      }
      const origin = pixelAlignedLabelOrigin(item.anchor, labelSize);
      const transform = `translate3d(${origin.left}px,${origin.top}px,0)`;
      if (element.style.transform !== transform) element.style.transform = transform;
      element.dataset.labelLeft = String(origin.left);
      element.dataset.labelTop = String(origin.top);
      element.style.opacity = "1";
    }
  }, [labelsOn, size]);
  const moveCameraToNodeIds = useCallback((ids: ReadonlySet<string>, duration = 500) => {
    const nodes = renderNodes.filter((node) => ids.has(node.id));
    const camera = graphRef.current?.camera?.() as THREE.Camera | undefined;
    const pose = cameraPoseForNodes(nodes, viewModeRef.current, {
      x: Number(camera?.position.x ?? 210),
      y: Number(camera?.position.y ?? 155),
      z: Number(camera?.position.z ?? 245),
    });
    if (pose) graphRef.current?.cameraPosition(pose.position, pose.target, duration);
  }, [renderNodes]);
  const fit = useCallback((duration = 500) => {
    if (viewModeRef.current === "2d") {
      graphRef.current?.cameraPosition({ x: 0, y: 0, z: Math.max(220, map2DLayout.extent * 2.5) }, { x: 0, y: 0, z: 0 }, duration);
      return;
    }
    graphRef.current?.zoomToFit(duration, 14);
  }, [map2DLayout.extent]);
  const reset = useCallback((duration = 500) => graphRef.current?.cameraPosition(
    viewModeRef.current === "2d" ? { x: 0, y: 0, z: Math.max(220, map2DLayout.extent * 2.5) } : { x: 210, y: 155, z: 245 },
    { x: 0, y: 0, z: 0 },
    duration,
  ), [map2DLayout.extent]);
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
    if (!selectedId && !skipClearFitRef.current && containerRef.current) containerRef.current.dataset.focusedCommunity = "";
    const dimensionChanging = viewModeRef.current !== viewMode;
    const timer = window.setTimeout(() => {
      if (selectedId && neighbors.size) moveCameraToNodeIds(neighbors);
      else if (previous && !skipClearFitRef.current) fit();
      skipClearFitRef.current = false;
    }, dimensionChanging ? 1140 : 90);
    return () => clearTimeout(timer);
  }, [activeEdges, graph.generatedAt, moveCameraToNodeIds, neighbors, selectedId, viewMode]);

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
      const container = containerRef.current;
      if (!camera || !container) return;
      container.dataset.cameraX = camera.position.x.toFixed(3);
      container.dataset.cameraY = camera.position.y.toFixed(3);
      container.dataset.cameraZ = camera.position.z.toFixed(3);
    };
    controls?.addEventListener?.("change", update);
    update();
    return () => controls?.removeEventListener?.("change", update);
  }, [sceneReadyTick]);

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
  }, [hoverFocusByGroup]);

  const clearCommunityFocus = useCallback((returnToOverview = true) => {
    const hadFocus = focusedCommunityIdRef.current !== null;
    focusedCommunityIdRef.current = null;
    skipClearFitRef.current = false;
    onCommunityFocus(null);
    if (containerRef.current) {
      containerRef.current.dataset.focusedCommunity = "";
      containerRef.current.dataset.focusedCommunityMemberCount = "0";
    }
    if (hadFocus && returnToOverview) fit();
    return hadFocus;
  }, [fit, onCommunityFocus]);

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
    const members = new Set((haloMembersByGroup.get(groupId) ?? []).map((node) => node.id));
    moveCameraToNodeIds(members);
    if (containerRef.current) {
      containerRef.current.dataset.focusedCommunity = groupId;
      containerRef.current.dataset.focusedCommunityMemberCount = String(members.size);
    }
  }, [clearCommunityFocus, haloGroupAt, haloMembersByGroup, moveCameraToNodeIds, onCommunityFocus, onSelect]);

  const handleNodeClick = useCallback((raw: object) => {
    clearCommunityFocus(false);
    onSelect((raw as GraphNode).id);
  }, [clearCommunityFocus, onSelect]);

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
    if (!focusedCommunityIdRef.current) return;
    clearCommunityFocus(false);
  }, [clearCommunityFocus, graph.generatedAt, viewMode]);

  useEffect(() => {
    if (!selectedId || !focusedCommunityIdRef.current) return;
    clearCommunityFocus(false);
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
    const nodeObjectById = new Map<string, THREE.Object3D>();
    const edgeObjects: LineSegments2[] = [];
    scene?.traverse((object) => {
      if (object.name === "memory-node-object" && typeof object.userData.nodeId === "string") {
        nodeObjectById.set(object.userData.nodeId, object);
      }
      if (object instanceof LineSegments2 && object.userData.edge) edgeObjects.push(object);
    });
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
      if (!container || !scene) return;
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
    let semanticMorphLine: THREE.LineSegments | null = null;
    let semanticMorphPositions: Float32Array<ArrayBuffer> | null = null;
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
      if (!explicitMorphLine) return;
      const positions: number[] = [];
      const colors: number[] = [];
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
          positions.push(segments[index]!, segments[index + 1]!, segments[index + 2]!);
          colors.push(color.r, color.g, color.b);
        }
      }
      explicitMorphLine.geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
      explicitMorphLine.geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
      explicitMorphLine.geometry.setDrawRange(0, positions.length / 3);
    };
    const removeExplicitMorphLine = () => {
      if (!explicitMorphLine) return;
      scene?.remove(explicitMorphLine);
      explicitMorphLine.geometry.dispose();
      (explicitMorphLine.material as THREE.Material).dispose();
      explicitMorphLine = null;
    };
    const removeSemanticMorphLine = () => {
      if (!semanticMorphLine) return;
      scene?.remove(semanticMorphLine);
      semanticMorphLine.geometry.dispose();
      (semanticMorphLine.material as THREE.Material).dispose();
      semanticMorphLine = null;
      semanticMorphPositions = null;
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
      explicitMorphLine = new THREE.LineSegments(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({
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
      geometry.setAttribute("position", new THREE.BufferAttribute(semanticMorphPositions, 3).setUsage(THREE.DynamicDrawUsage));
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
  }, [graph.generatedAt, graph.nodes, map2DLayout, positionCommunityLabels, renderNodes, sceneReadyTick, syncHaloTransforms, viewMode]);

  return (
    <div
      ref={containerRef}
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
      data-focused-community=""
      data-focused-community-member-count="0"
      data-2d-min-node-gap={map2DLayout.minimumNodeGap.toFixed(3)}
      data-2d-min-community-gap={map2DLayout.minimumCommunityGap.toFixed(3)}
      onPointerMove={handlePointerMove}
      onPointerLeave={() => setHoveredGroup(null)}
    >
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
