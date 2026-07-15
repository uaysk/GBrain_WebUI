import { expect, test, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";
import {
  DEMO_SELECTED_NODE_ID,
  demoGraph,
  demoNodeDetails,
  demoStatus,
  demoTimeline,
} from "../demo/gbrain-demo-memory";

const EXPLORER_STORAGE_KEY = "gbrain-memory-map:explorer-state:v2";

async function mockDemoApi(page: Page) {
  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());
    let payload: unknown;
    if (url.pathname === "/api/status") payload = demoStatus;
    else if (url.pathname === "/api/graph/history") payload = demoTimeline;
    else if (url.pathname === "/api/graph" || url.pathname === "/api/graph/rebuild") payload = demoGraph;
    else if (url.pathname === "/api/node-detail") payload = demoNodeDetails[url.searchParams.get("id") ?? ""];
    if (!payload) {
      await route.fulfill({ status: 404, contentType: "application/json", body: JSON.stringify({ error: "Demo resource not found" }) });
      return;
    }
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(payload) });
  });
}

async function setExplorerState(page: Page, viewMode: "2d" | "3d", selectedId: string | null) {
  await page.evaluate(({ key, mode, selected }) => {
    localStorage.setItem(key, JSON.stringify({
      selectedId: selected,
      viewMode: mode,
      timelineOn: true,
      communityLabelsOn: true,
      semanticOn: true,
      explicitOn: true,
      semanticThreshold: 0.65,
      explicitFamilies: ["mention", "association", "hierarchy", "provenance", "temporal", "custom"],
    }));
    localStorage.setItem("gbrain-memory-map:legend-expanded", "true");
  }, { key: EXPLORER_STORAGE_KEY, mode: viewMode, selected: selectedId });
}

async function waitForGraph(page: Page, viewMode: "2d" | "3d") {
  const graph = page.getByTestId("memory-graph");
  await expect(graph).toBeVisible();
  await expect(graph).toHaveAttribute("data-view-mode", viewMode);
  await page.waitForTimeout(1_350);
  await expect(graph).toHaveAttribute("data-view-transitioning", "false");
  await expect(page.getByTestId("db-status")).toContainText("DB connected");
  await expect(page.getByTestId("graph-timeline")).toBeVisible();
  return graph;
}

test("captures README images from synthetic GBrain memory", async ({ page }) => {
  test.setTimeout(90_000);
  mkdirSync("screenshots", { recursive: true });
  await mockDemoApi(page);
  await page.goto("/", { waitUntil: "networkidle" });

  await setExplorerState(page, "3d", null);
  await page.reload({ waitUntil: "networkidle" });
  const graph3D = await waitForGraph(page, "3d");
  await page.getByRole("button", { name: "Fit graph" }).click();
  await page.waitForTimeout(500);
  await page.mouse.move(780, 28);
  await expect(graph3D).toHaveAttribute("data-selected-id", "");
  await page.screenshot({ path: "screenshots/gbrain-demo-memory-map.png" });

  await setExplorerState(page, "2d", null);
  await page.reload({ waitUntil: "networkidle" });
  const graph2D = await waitForGraph(page, "2d");
  await page.getByRole("button", { name: "Fit graph" }).click();
  await page.waitForTimeout(500);
  await page.mouse.move(780, 28);
  await expect(graph2D).toHaveAttribute("data-left-drag-action", "pan");
  await page.screenshot({ path: "screenshots/gbrain-demo-memory-map-2d.png" });

  await setExplorerState(page, "3d", DEMO_SELECTED_NODE_ID);
  await page.reload({ waitUntil: "networkidle" });
  const focusedGraph = await waitForGraph(page, "3d");
  await expect(focusedGraph).toHaveAttribute("data-selected-id", DEMO_SELECTED_NODE_ID);
  await expect(page.getByTestId("node-context-panel")).toBeVisible();
  await expect(page.getByTestId("node-content")).toHaveAttribute("data-state", "ready");
  await expect(page.getByTestId("selected-summary")).toContainText("Knowledge Graph Prototype");
  await page.mouse.move(780, 28);
  await page.screenshot({ path: "screenshots/gbrain-demo-memory-map-focus.png" });
});
