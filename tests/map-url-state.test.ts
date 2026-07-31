import { describe, expect, test } from "bun:test";
import {
  createMapUrlTransition,
  parseMapUrlState,
  patchMapUrlState,
  serializeMapUrlState,
} from "../src/graph/map-url-state";
import {
  GRAPH_EXPLORER_STORAGE_KEY,
  LEGACY_GRAPH_EXPLORER_STORAGE_KEY,
  persistGraphExplorerState,
  readGraphExplorerState,
} from "../src/hooks/useGraphExplorerState";

describe("Map public URL state", () => {
  test("round-trips public keys and preserves unrelated parameters", () => {
    const base = new URLSearchParams("utm=control&utm=map&graphDiagnostics=1");
    const params = serializeMapUrlState({
      node: "기본::topics/기억 지도",
      community: null,
      view: "2d",
      dreamRun: 417,
    }, base);

    expect(parseMapUrlState(params)).toEqual({
      node: "기본::topics/기억 지도",
      community: null,
      view: "2d",
      dreamRun: 417,
    });
    expect(params.getAll("utm")).toEqual(["control", "map"]);
    expect(params.get("graphDiagnostics")).toBe("1");
  });

  test("keeps node and community mutually exclusive with node precedence for malformed URLs", () => {
    expect(parseMapUrlState("node=source%3A%3Anote&community=community-1&view=3d")).toEqual({
      node: "source::note",
      community: null,
      view: "3d",
      dreamRun: null,
    });

    const community = patchMapUrlState("node=source%3A%3Anote&keep=yes", { community: "community-2" });
    expect(community.get("node")).toBeNull();
    expect(community.get("community")).toBe("community-2");
    expect(community.get("keep")).toBe("yes");

    const node = patchMapUrlState(community, { node: "source::other" });
    expect(node.get("node")).toBe("source::other");
    expect(node.get("community")).toBeNull();
  });

  test("fails closed for invalid view and Dream job identifiers", () => {
    expect(parseMapUrlState("view=4d&dreamRun=-1")).toEqual({ node: null, community: null, view: null, dreamRun: null });
    expect(parseMapUrlState("dreamRun=9007199254740992").dreamRun).toBeNull();

    const canonical = serializeMapUrlState({ node: null, community: null, view: null, dreamRun: null }, "view=4d&dreamRun=oops&keep=1");
    expect(canonical.toString()).toBe("keep=1");
  });

  test("returns push/replace transition intent without touching browser history", () => {
    const pushed = createMapUrlTransition("keep=1&view=3d", { node: "default::new" }, "push");
    expect(pushed.historyMode).toBe("push");
    expect(pushed.state).toEqual({ node: "default::new", community: null, view: "3d", dreamRun: null });
    expect(pushed.search).toBe("?keep=1&view=3d&node=default%3A%3Anew");

    const replaced = createMapUrlTransition(pushed.params, { view: "2d" }, "replace");
    expect(replaced.historyMode).toBe("replace");
    expect(replaced.state.view).toBe("2d");
    expect(replaced.params.get("keep")).toBe("1");
  });
});

describe("Map explorer storage migration", () => {
  test("loads v2 settings into the v3 shape while public URL state takes precedence", () => {
    const values = new Map<string, string>([[LEGACY_GRAPH_EXPLORER_STORAGE_KEY, JSON.stringify({
      selectedId: "legacy::node",
      viewMode: "3d",
      timelineOn: false,
      semanticThreshold: 0.72,
      explicitFamilies: ["mention", "invalid"],
    })]]);
    const state = readGraphExplorerState({ getItem: (key) => values.get(key) ?? null }, "?node=url%3A%3Anode&view=2d");
    expect(state.selectedId).toBe("url::node");
    expect(state.viewMode).toBe("2d");
    expect(state.timelineOn).toBe(false);
    expect(state.semanticThreshold).toBe(0.72);
    expect(state.explicitFamilies).toEqual(["mention"]);

    const communityState = readGraphExplorerState(
      { getItem: (key) => values.get(key) ?? null },
      "?community=community-1",
    );
    expect(communityState.selectedId).toBeNull();
  });

  test("keeps URL navigation usable when storage reads or writes fail", () => {
    const state = readGraphExplorerState({ getItem: () => { throw new Error("blocked"); } }, "?node=default%3A%3Atopic&view=2d");
    expect(state.selectedId).toBe("default::topic");
    expect(state.viewMode).toBe("2d");
    expect(persistGraphExplorerState({ setItem: () => { throw new Error("quota"); } }, state)).toBe(false);
    const writes = new Map<string, string>();
    expect(persistGraphExplorerState({ setItem: (key, value) => { writes.set(key, value); } }, state)).toBe(true);
    expect(writes.has(GRAPH_EXPLORER_STORAGE_KEY)).toBe(true);
  });
});
