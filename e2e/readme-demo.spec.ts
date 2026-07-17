import { expect, test, type Page } from "@playwright/test";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
      timelineOn: false,
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
  await expect(page.getByTestId("timeline-toggle")).toHaveAttribute("aria-pressed", "false");
  await expect(page.getByTestId("graph-timeline")).toHaveCount(0);
  return graph;
}

async function captureFrame(page: Page, framesDirectory: string, frame: number) {
  await page.screenshot({ path: join(framesDirectory, `frame-${String(frame).padStart(4, "0")}.png`) });
  return frame + 1;
}

async function captureRepeatedFrames(page: Page, framesDirectory: string, startFrame: number, count: number) {
  let frame = startFrame;
  for (let index = 0; index < count; index += 1) frame = await captureFrame(page, framesDirectory, frame);
  return frame;
}

function renderGif(framesDirectory: string) {
  const outputPath = "screenshots/gbrain-demo-memory-map.gif";
  const result = spawnSync("ffmpeg", [
    "-hide_banner", "-loglevel", "error", "-y",
    "-framerate", "12",
    "-i", join(framesDirectory, "frame-%04d.png"),
    "-filter_complex",
    "fps=12,split[gif][palette];[palette]palettegen=max_colors=256:stats_mode=diff[p];[gif][p]paletteuse=dither=sierra2_4a:diff_mode=rectangle",
    "-loop", "0",
    outputPath,
  ], { encoding: "utf8" });
  expect(result.status, result.stderr).toBe(0);
}

test("captures README images from synthetic GBrain memory", async ({ page }) => {
  test.setTimeout(90_000);
  mkdirSync("screenshots", { recursive: true });
  const framesDirectory = mkdtempSync(join(tmpdir(), "gbrain-readme-demo-"));
  await mockDemoApi(page);
  await page.goto("/", { waitUntil: "networkidle" });

  await setExplorerState(page, "3d", null);
  await page.reload({ waitUntil: "networkidle" });
  const graph3D = await waitForGraph(page, "3d");
  await page.getByRole("button", { name: "Fit graph" }).click();
  await page.waitForTimeout(500);
  await page.mouse.move(780, 28);
  await expect(graph3D).toHaveAttribute("data-selected-id", "");
  await expect.poll(() => page.evaluate((key) => JSON.parse(localStorage.getItem(key) ?? "null")?.timelineOn, EXPLORER_STORAGE_KEY)).toBe(false);
  await page.screenshot({ path: "screenshots/gbrain-demo-memory-map.png" });

  let frame = await captureRepeatedFrames(page, framesDirectory, 0, 8);
  await page.mouse.move(500, 540);
  await page.mouse.down();
  for (let step = 1; step <= 30; step += 1) {
    const progress = step / 30;
    await page.mouse.move(500 + 360 * progress, 540 - 100 * Math.sin(progress * Math.PI));
    frame = await captureFrame(page, framesDirectory, frame);
  }
  await page.mouse.up();
  frame = await captureRepeatedFrames(page, framesDirectory, frame, 6);

  await page.getByTestId("view-mode-toggle").click();
  await expect(graph3D).toHaveAttribute("data-view-mode", "2d");
  do {
    frame = await captureFrame(page, framesDirectory, frame);
  } while (await graph3D.getAttribute("data-view-transitioning") === "true");
  await expect(graph3D).toHaveAttribute("data-coordinate-mode", "2d");
  await expect(graph3D).toHaveAttribute("data-left-drag-action", "pan");
  await expect(page.getByTestId("graph-timeline")).toHaveCount(0);
  await page.getByRole("button", { name: "Fit graph" }).click();
  await page.waitForTimeout(520);
  frame = await captureRepeatedFrames(page, framesDirectory, frame, 12);
  expect(frame).toBeGreaterThan(50);
  renderGif(framesDirectory);
  rmSync(framesDirectory, { recursive: true });

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
