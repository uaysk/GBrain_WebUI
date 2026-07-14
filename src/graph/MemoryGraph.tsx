import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import ForceGraph3D from "react-force-graph-3d";
import * as THREE from "three";
import { LineSegments2 } from "three/examples/jsm/lines/LineSegments2.js";
import type { GraphEdge, GraphNode, GraphResponse } from "../types";
import { COMMUNITY_LABEL_STYLE, communityLabelTitle, connectedNodeIdsForGroup, pixelAlignedLabelOrigin } from "./community-label";
import { createMap2DLayout, easeInOutCubic, type MapViewMode } from "./layout-2d";
import { createMorphHaloBatch, type MorphHaloBatch } from "./morph-halo-batch";
import { createMorphNodeBatch, type MorphNodeBatch } from "./morph-node-batch";
import { createEdgeObject, createNodeObject, edgeSegmentPositions, updateEdgeObject } from "./rendering";

export interface GraphControls { fit: () => void; reset: () => void }
interface Props { graph: GraphResponse; viewMode: MapViewMode; labelsOn: boolean; semanticOn: boolean; explicitOn: boolean; selectedId: string | null; onSelect: (id: string | null) => void }
type RenderEdge = GraphEdge & { bundledEdges?: GraphEdge[] };

const endpointId = (value: string | GraphNode) => typeof value === "string" ? value : value.id;
const escapeHtml = (value: string) => value.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]!));
const relationPriority: Record<GraphEdge["family"], number> = { temporal: 6, hierarchy: 5, provenance: 4, association: 3, mention: 2, semantic: 1, custom: 0 };

export const MemoryGraph = forwardRef<GraphControls, Props>(function MemoryGraph({ graph, viewMode, labelsOn, semanticOn, explicitOn, selectedId, onSelect }, ref) {
  const containerRef = useRef<HTMLDivElement>(null);
  const labelLayerRef = useRef<HTMLDivElement>(null);
  const haloRootRef = useRef<THREE.Group | null>(null);
  const haloRaycasterRef = useRef(new THREE.Raycaster());
  const hoveredGroupIdRef = useRef<string | null>(null);
  const viewModeRef = useRef<MapViewMode>(viewMode);
  const flatnessRef = useRef(viewMode === "2d" ? 1 : 0);
  const morphFrameRef = useRef<number | null>(null);
  const edgeFadeFrameRef = useRef<number | null>(null);
  const labelSizeRef = useRef(new Map<string, { width: number; height: number }>());
  const graphRef = useRef<any>(null);
  const [size, setSize] = useState({ width: 800, height: 600 });
  useEffect(() => {
    if (!containerRef.current) return;
    const observer = new ResizeObserver(([entry]) => entry && setSize({ width: Math.max(1, entry.contentRect.width), height: Math.max(1, entry.contentRect.height) }));
    observer.observe(containerRef.current); return () => observer.disconnect();
  }, []);
  const visibleEdges = useMemo<RenderEdge[]>(() => {
    const candidates = [...(explicitOn ? graph.explicitEdges : []), ...(semanticOn ? graph.semanticEdges : [])];
    const bundles = new Map<string, GraphEdge[]>();
    for (const edge of candidates) {
      const key = [endpointId(edge.source), endpointId(edge.target)].sort().join("\u0000");
      bundles.set(key, [...(bundles.get(key) ?? []), edge]);
    }
    return [...bundles.values()].map((edges) => {
      const sorted = [...edges].sort((left, right) => relationPriority[right.family] - relationPriority[left.family] || left.id.localeCompare(right.id));
      return { ...sorted[0]!, bundledEdges: sorted };
    });
  }, [graph, explicitOn, semanticOn]);
  const neighbors = useMemo(() => {
    const set = new Set<string>(); if (!selectedId) return set; set.add(selectedId);
    for (const edge of [...graph.explicitEdges, ...graph.semanticEdges]) {
      const source = endpointId(edge.source); const target = endpointId(edge.target);
      if (source === selectedId) set.add(target); if (target === selectedId) set.add(source);
    }
    return set;
  }, [graph, selectedId]);
  const renderNodeObject = useCallback((raw: object) => {
    const node = raw as GraphNode;
    const selected = node.id === selectedId;
    const adjacent = Boolean(selectedId && neighbors.has(node.id) && !selected);
    return createNodeObject(node, {
      selected,
      adjacent,
      dimmed: Boolean(selectedId && !neighbors.has(node.id)),
      showLabel: false,
    });
  }, [neighbors, selectedId]);
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
  const renderLinkTooltip = useCallback((raw: object) => {
    const edge = raw as RenderEdge;
    const relations = edge.bundledEdges ?? [edge];
    const details = relations.map((relation) => {
      const direction = relation.directed ? `${escapeHtml(endpointId(relation.source))} → ${escapeHtml(endpointId(relation.target))}` : "Undirected";
      const similarity = relation.similarity === null ? "" : ` · ${relation.similarity.toFixed(4)}`;
      return `<span>${escapeHtml(relation.linkType)} · ${direction}${similarity}</span>`;
    }).join("");
    return `<div class="graph-tooltip"><strong>${escapeHtml(edge.family)}${relations.length > 1 ? ` · ${relations.length} relations` : ""}</strong><span>Pattern · ${edge.dashPattern.length ? "dashed/dotted" : "solid"} · ${edge.width.toFixed(1)}px</span>${details}</div>`;
  }, []);
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
    connectedNodeIdsForGroup(graph.nodes, [...graph.explicitEdges, ...graph.semanticEdges], group.id),
  ])), [graph.explicitEdges, graph.nodes, graph.semanticEdges, graph.semanticGroups]);
  const syncHaloTransforms = useCallback(() => {
    const root = haloRootRef.current;
    if (!root) return;
    for (const semanticGroup of haloGroups) {
      const members = haloMembersByGroup.get(semanticGroup.id) ?? [];
      if (!members.length) continue;
      const minimum: [number, number, number] = [Infinity, Infinity, Infinity];
      const maximum: [number, number, number] = [-Infinity, -Infinity, -Infinity];
      for (const node of members) {
        const point = [Number(node.x ?? 0), Number(node.y ?? 0), Number(node.z ?? 0)];
        for (let axis = 0; axis < 3; axis += 1) {
          minimum[axis] = Math.min(minimum[axis]!, point[axis]!);
          maximum[axis] = Math.max(maximum[axis]!, point[axis]!);
        }
      }
      const center = minimum.map((value, axis) => (value + maximum[axis]!) / 2) as [number, number, number];
      const volumeRadii = minimum.map((value, axis) => Math.max(7, (maximum[axis]! - value) / 2 + 6)) as [number, number, number];
      const radii: [number, number, number] = [
        volumeRadii[0],
        volumeRadii[1],
        volumeRadii[2] * (1 - flatnessRef.current) + 1.35 * flatnessRef.current,
      ];
      for (const object of root.children) {
        if (!(object instanceof THREE.Mesh) || object.userData.haloGroupId !== semanticGroup.id) continue;
        object.position.set(...center);
        const scale = object.userData.haloLayer === "outer" ? 1.16 : 1;
        object.scale.set(radii[0] * scale, radii[1] * scale, radii[2] * scale);
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
  const fit = (duration = 500) => {
    if (viewModeRef.current === "2d") {
      graphRef.current?.cameraPosition({ x: 0, y: 0, z: Math.max(220, map2DLayout.extent * 2.5) }, { x: 0, y: 0, z: 0 }, duration);
      return;
    }
    graphRef.current?.zoomToFit(duration, 14);
  };
  const reset = (duration = 500) => graphRef.current?.cameraPosition(
    viewModeRef.current === "2d" ? { x: 0, y: 0, z: Math.max(220, map2DLayout.extent * 2.5) } : { x: 210, y: 155, z: 245 },
    { x: 0, y: 0, z: 0 },
    duration,
  );
  useImperativeHandle(ref, () => ({ fit: () => fit(), reset }));
  useEffect(() => {
    reset(0);
    const timer = window.setTimeout(() => fit(0), 250);
    return () => clearTimeout(timer);
  }, [graph.generatedAt, size.width, size.height]);

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

  useEffect(() => { hoveredGroupIdRef.current = null; }, [labelsOn]);

  useEffect(() => {
    const scene = graphRef.current?.scene?.() as THREE.Scene | undefined;
    if (!scene) return;
    const root = new THREE.Group();
    root.name = "leiden-community-halos";
    root.renderOrder = -10;
    for (const semanticGroup of haloGroups) {
      const geometry = new THREE.SphereGeometry(1, 24, 16);
      const inner = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({
        color: semanticGroup.color,
        transparent: true,
        opacity: 0.06,
        depthWrite: false,
        side: THREE.BackSide,
      }));
      inner.userData.groupId = semanticGroup.id;
      inner.userData.haloGroupId = semanticGroup.id;
      inner.userData.haloLayer = "inner";
      inner.userData.baseOpacity = inner.material.opacity;
      inner.name = "community-halo-hit-target";
      root.add(inner);
      const outer = new THREE.Mesh(geometry.clone(), new THREE.MeshBasicMaterial({
        color: semanticGroup.color,
        transparent: true,
        opacity: 0.038,
        depthWrite: false,
        side: THREE.BackSide,
        blending: THREE.AdditiveBlending,
      }));
      outer.userData.haloGroupId = semanticGroup.id;
      outer.userData.haloLayer = "outer";
      outer.userData.baseOpacity = outer.material.opacity;
      root.add(outer);
    }
    scene.add(root);
    haloRootRef.current = root;
    syncHaloTransforms();
    positionCommunityLabels();
    return () => {
      if (haloRootRef.current === root) haloRootRef.current = null;
      scene.remove(root);
      root.traverse((object) => {
        if (object instanceof THREE.Mesh) {
          object.geometry.dispose();
          if (Array.isArray(object.material)) object.material.forEach((material) => material.dispose());
          else object.material.dispose();
        }
      });
    };
  }, [graph.generatedAt, haloGroups, positionCommunityLabels, syncHaloTransforms]);

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

  const handlePointerMove = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    const camera = graphRef.current?.camera?.() as THREE.Camera | undefined;
    const root = haloRootRef.current;
    const container = containerRef.current;
    if (!camera || !root || !container) return;
    const bounds = container.getBoundingClientRect();
    const pointer = new THREE.Vector2(
      ((event.clientX - bounds.left) / bounds.width) * 2 - 1,
      -((event.clientY - bounds.top) / bounds.height) * 2 + 1,
    );
    const raycaster = haloRaycasterRef.current;
    raycaster.setFromCamera(pointer, camera);
    const hit = raycaster.intersectObjects(root.children.filter((object) => Boolean(object.userData.groupId)), false)[0];
    setHoveredGroup(typeof hit?.object.userData.groupId === "string" ? hit.object.userData.groupId : null);
  }, [setHoveredGroup]);

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
    if (controls) {
      controls.noRotate = viewMode === "2d";
      if ("enableRotate" in controls) controls.enableRotate = viewMode !== "2d";
    }
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
      settleTimer = window.setTimeout(() => {
        syncHaloTransforms();
        positionCommunityLabels();
        updateSceneDiagnostics();
      }, 80);
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
  }, [graph.generatedAt, graph.nodes, map2DLayout, positionCommunityLabels, renderNodes, syncHaloTransforms, viewMode]);

  return (
    <div
      ref={containerRef}
      className="relative h-full min-h-0 w-full overflow-hidden"
      data-testid="memory-graph"
      data-view-mode={viewMode}
      data-view-transitioning="false"
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
        linkDirectionalArrowLength={() => 0}
        linkLabel={renderLinkTooltip}
        onNodeClick={(raw: object) => onSelect((raw as GraphNode).id)} onBackgroundClick={() => onSelect(null)}
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
