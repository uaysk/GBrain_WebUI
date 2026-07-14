import { expect, test } from "@playwright/test";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";

const sizes = [
  { width: 1440, height: 1000 },
  { width: 1920, height: 1200 },
  { width: 2560, height: 1600 },
];

test("captures and validates the requested viewports", async ({ browser }) => {
  test.setTimeout(120_000);
  mkdirSync("screenshots", { recursive: true });
  const target = process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:3000";
  const consoleErrors: string[] = [];
  const failedRequests: string[] = [];
  const password = process.env.APP_AUTH_PASSWORD ?? readFileSync(".env", "utf8").match(/^APP_AUTH_PASSWORD=(.+)$/m)?.[1]?.trim();
  if (!password) throw new Error("APP_AUTH_PASSWORD is required for Playwright");
  const observe = (page: Awaited<ReturnType<typeof browser.newPage>>) => {
    page.on("console", (message) => { if (message.type() === "error") consoleErrors.push(message.text()); });
    page.on("requestfailed", (request) => failedRequests.push(`${request.method()} ${request.url()} ${request.failure()?.errorText}`));
  };
  const visibleTooltipText = (page: Awaited<ReturnType<typeof browser.newPage>>) => page.evaluate(() => {
    const content = document.querySelector<HTMLElement>(".graph-tooltip");
    const root = content?.closest<HTMLElement>(".scene-tooltip, .float-tooltip-kap") ?? content?.parentElement;
    if (!content || !root) return "";
    const style = getComputedStyle(root);
    const bounds = root.getBoundingClientRect();
    const visible = style.display !== "none" && style.visibility !== "hidden" && Number(style.opacity) > 0.05
      && bounds.width > 0 && bounds.height > 0 && bounds.right > 0 && bounds.bottom > 0
      && bounds.left < innerWidth && bounds.top < innerHeight;
    return visible ? content.textContent?.trim() ?? "" : "";
  });
  const login = async (page: Awaited<ReturnType<typeof browser.newPage>>) => {
    await page.goto(target, { waitUntil: "domcontentloaded" });
    const passwordInput = page.getByLabel("비밀번호");
    if (await passwordInput.isVisible()) {
      await passwordInput.fill(password);
      const loginResponse = page.waitForResponse((response) => response.url().includes("/auth/login") && response.request().method() === "POST");
      await page.getByRole("button", { name: "로그인" }).click();
      expect((await loginResponse).status()).toBe(303);
      await page.waitForLoadState("networkidle");
    }
  };
  const loginContext = await browser.newContext({ viewport: { width: 1440, height: 1000 }, ignoreHTTPSErrors: true });
  const loginPage = await loginContext.newPage(); observe(loginPage);
  await loginPage.goto(target, { waitUntil: "domcontentloaded" });
  await expect(loginPage.getByRole("heading", { name: "GBrain 3D Memory Map" })).toBeVisible();
  await expect(loginPage.getByLabel("비밀번호")).toBeVisible();
  await loginPage.screenshot({ path: "screenshots/gbrain-memory-map-login.png" });
  await loginContext.close();
  const warmupContext = await browser.newContext({ viewport: { width: 960, height: 720 }, ignoreHTTPSErrors: true });
  const warmupPage = await warmupContext.newPage(); observe(warmupPage);
  await login(warmupPage);
  const sessionCookie = (await warmupContext.cookies()).find((cookie) => cookie.name === "gbrain_session");
  expect(sessionCookie).toMatchObject({ httpOnly: true, secure: true, sameSite: "Strict" });
  await expect(warmupPage.getByTestId("memory-graph")).toBeVisible();
  await warmupPage.waitForTimeout(900);
  await warmupPage.screenshot({ path: "/tmp/gbrain-playwright-webgl-warmup.png" });
  await warmupContext.close();
  for (const size of sizes) {
    const context = await browser.newContext({ viewport: size, ignoreHTTPSErrors: true });
    const page = await context.newPage(); observe(page);
    await login(page);
    await expect(page.getByTestId("db-status")).toContainText("DB connected");
    await expect(page.getByTestId("memory-graph")).toBeVisible();
    await expect(page.getByLabel("Graph legend")).toBeVisible();
    await expect(page.getByLabel("Graph legend")).toContainText("concept · circle");
    await expect(page.getByLabel("Graph legend")).toContainText("project · square");
    await expect(page.getByLabel("Graph legend")).toContainText("Billboard = always camera-facing");
    await page.waitForTimeout(1800);
    const overflow = await page.evaluate(() => ({ x: document.documentElement.scrollWidth > document.documentElement.clientWidth, y: document.documentElement.scrollHeight > document.documentElement.clientHeight }));
    expect(overflow).toEqual({ x: false, y: false });
    await page.mouse.move(size.width - 24, size.height - 24);
    await page.waitForTimeout(120);
    const screenshotPath = `screenshots/gbrain-memory-map-${size.width}x${size.height}.png`;
    await page.screenshot({ path: screenshotPath });
    await page.waitForTimeout(180);
    await page.screenshot({ path: screenshotPath });
    await context.close();
  }
  const interactionContext = await browser.newContext({ viewport: { width: 1440, height: 1000 }, ignoreHTTPSErrors: true });
  const page = await interactionContext.newPage(); observe(page);
  await login(page);
  await page.waitForTimeout(1500);
  const memoryGraph = page.getByTestId("memory-graph");
  const viewModeToggle = page.getByTestId("view-mode-toggle");
  await expect(memoryGraph).toHaveAttribute("data-view-mode", "3d");
  await expect(memoryGraph).toHaveAttribute("data-view-transitioning", "false");
  expect(Number(await memoryGraph.getAttribute("data-map-depth"))).toBeGreaterThan(1);
  const initialSpatialState = await memoryGraph.evaluate((element) => ({
    coordinateMode: element.dataset.coordinateMode,
    sceneDepth: Number(element.dataset.sceneDepth),
    nodeCount: Number(element.dataset.sceneNodeCount),
    nodePositionError: Number(element.dataset.sceneNodePositionError),
    haloCenterError: Number(element.dataset.haloCenterError),
    haloContainmentError: Number(element.dataset.haloContainmentError),
    cameraX: Number(element.dataset.cameraX),
    cameraY: Number(element.dataset.cameraY),
  }));
  expect(initialSpatialState.coordinateMode).toBe("3d");
  expect(initialSpatialState.sceneDepth).toBeGreaterThan(1);
  expect(initialSpatialState.nodeCount).toBeGreaterThan(150);
  expect(initialSpatialState.nodePositionError).toBeLessThan(0.001);
  expect(initialSpatialState.haloCenterError).toBeLessThan(0.001);
  expect(initialSpatialState.haloContainmentError).toBeLessThan(0.001);
  expect(Math.abs(initialSpatialState.cameraX)).toBeGreaterThan(1);
  expect(Math.abs(initialSpatialState.cameraY)).toBeGreaterThan(1);

  // Measure a clean transition before taking the mid-morph WebGL screenshot,
  // because screenshot capture intentionally blocks requestAnimationFrame.
  await viewModeToggle.click();
  await expect.poll(() => memoryGraph.getAttribute("data-view-transitioning"), { timeout: 3_000 }).toBe("false");
  await page.waitForTimeout(120);
  const cleanMorphPerformance = await memoryGraph.evaluate((element) => ({
    frames: Number(element.dataset.morphFrameCount),
    fps: Number(element.dataset.morphFps),
    wallDuration: Number(element.dataset.morphWallDuration),
    externalStalls: Number(element.dataset.morphExternalStalls),
    directNodes: Number(element.dataset.morphDirectNodeCount),
    nodesBatched: element.dataset.morphNodesBatched,
    semanticBatched: element.dataset.morphSemanticBatched,
    halosBatched: element.dataset.morphHalosBatched,
    explicitBatched: element.dataset.morphExplicitBatched,
    coordinateMode: element.dataset.coordinateMode,
    sceneDepth: Number(element.dataset.sceneDepth),
    sceneNodeCount: Number(element.dataset.sceneNodeCount),
    sceneNodePositionError: Number(element.dataset.sceneNodePositionError),
    haloCenterError: Number(element.dataset.haloCenterError),
    haloContainmentError: Number(element.dataset.haloContainmentError),
    cameraX: Number(element.dataset.cameraX),
    cameraY: Number(element.dataset.cameraY),
  }));
  writeFileSync("screenshots/morph-performance.json", `${JSON.stringify(cleanMorphPerformance, null, 2)}\n`);
  expect(cleanMorphPerformance.frames).toBeGreaterThan(20);
  expect(cleanMorphPerformance.fps).toBeGreaterThan(20);
  expect(cleanMorphPerformance.directNodes).toBeGreaterThan(150);
  expect(cleanMorphPerformance.nodesBatched).toBe("true");
  expect(cleanMorphPerformance.semanticBatched).toBe("true");
  expect(cleanMorphPerformance.halosBatched).toBe("true");
  expect(cleanMorphPerformance.explicitBatched).toBe("true");
  expect(cleanMorphPerformance.coordinateMode).toBe("2d");
  expect(cleanMorphPerformance.sceneDepth).toBeLessThan(0.001);
  expect(cleanMorphPerformance.sceneNodeCount).toBe(cleanMorphPerformance.directNodes);
  expect(cleanMorphPerformance.sceneNodePositionError).toBeLessThan(0.001);
  expect(cleanMorphPerformance.haloCenterError).toBeLessThan(0.001);
  expect(cleanMorphPerformance.haloContainmentError).toBeLessThan(0.001);
  expect(Math.abs(cleanMorphPerformance.cameraX)).toBeLessThan(0.001);
  expect(Math.abs(cleanMorphPerformance.cameraY)).toBeLessThan(0.001);
  await viewModeToggle.click();
  await expect(page.getByRole("heading", { name: "GBrain 3D Memory Map" })).toBeVisible();
  await expect.poll(() => memoryGraph.getAttribute("data-view-transitioning"), { timeout: 3_000 }).toBe("false");
  await page.waitForTimeout(280);

  await viewModeToggle.click();
  await expect(page.getByRole("heading", { name: "GBrain 2D Memory Map" })).toBeVisible();
  await expect(viewModeToggle).toHaveAttribute("aria-label", "3D 맵으로 전환");
  await page.waitForTimeout(240);
  const morphState = await memoryGraph.evaluate((element) => ({
    transitioning: element.dataset.viewTransitioning,
    progress: Number(element.dataset.morphProgress),
    depth: Number(element.dataset.mapDepth),
  }));
  expect(morphState.transitioning).toBe("true");
  expect(morphState.progress).toBeGreaterThan(0);
  expect(morphState.progress).toBeLessThan(1);
  expect(morphState.depth).toBeGreaterThan(0);
  await memoryGraph.screenshot({ path: "screenshots/gbrain-memory-map-3d-to-2d-morph.png" });
  await expect.poll(() => memoryGraph.getAttribute("data-view-transitioning"), { timeout: 3_000 }).toBe("false");
  await page.waitForTimeout(450);
  const flatState = await memoryGraph.evaluate((element) => ({
    mode: element.dataset.viewMode,
    depth: Number(element.dataset.mapDepth),
    nodeGap: Number(element.dataset["2dMinNodeGap"]),
    communityGap: Number(element.dataset["2dMinCommunityGap"]),
    morphFrames: Number(element.dataset.morphFrameCount),
    morphFps: Number(element.dataset.morphFps),
    directNodes: Number(element.dataset.morphDirectNodeCount),
    explicitEdges: Number(element.dataset.morphExplicitEdgeCount),
    semanticEdges: Number(element.dataset.morphSemanticEdgeCount),
    nodesBatched: element.dataset.morphNodesBatched,
    semanticBatched: element.dataset.morphSemanticBatched,
    halosBatched: element.dataset.morphHalosBatched,
    explicitBatched: element.dataset.morphExplicitBatched,
    coordinateMode: element.dataset.coordinateMode,
    sceneDepth: Number(element.dataset.sceneDepth),
    sceneNodeCount: Number(element.dataset.sceneNodeCount),
    sceneNodePositionError: Number(element.dataset.sceneNodePositionError),
    haloCenterError: Number(element.dataset.haloCenterError),
    haloContainmentError: Number(element.dataset.haloContainmentError),
    cameraX: Number(element.dataset.cameraX),
    cameraY: Number(element.dataset.cameraY),
  }));
  expect(flatState.mode).toBe("2d");
  expect(flatState.depth).toBeLessThan(0.001);
  expect(flatState.nodeGap).toBeGreaterThan(0.75);
  expect(flatState.communityGap).toBeGreaterThan(13.5);
  expect(flatState.directNodes).toBeGreaterThan(150);
  expect(flatState.explicitEdges).toBeGreaterThan(0);
  expect(flatState.semanticEdges).toBeGreaterThan(100);
  expect(flatState.nodesBatched).toBe("true");
  expect(flatState.semanticBatched).toBe("true");
  expect(flatState.halosBatched).toBe("true");
  expect(flatState.explicitBatched).toBe("true");
  expect(flatState.morphFrames).toBeGreaterThan(20);
  expect(flatState.coordinateMode).toBe("2d");
  expect(flatState.sceneDepth).toBeLessThan(0.001);
  expect(flatState.sceneNodeCount).toBe(flatState.directNodes);
  expect(flatState.sceneNodePositionError).toBeLessThan(0.001);
  expect(flatState.haloCenterError).toBeLessThan(0.001);
  expect(flatState.haloContainmentError).toBeLessThan(0.001);
  expect(Math.abs(flatState.cameraX)).toBeLessThan(0.001);
  expect(Math.abs(flatState.cameraY)).toBeLessThan(0.001);
  await page.getByRole("button", { name: "Fit graph" }).click();
  await page.waitForTimeout(620);
  await expect(memoryGraph).toHaveAttribute("data-view-mode", "2d");
  const labelsInsideViewport = await page.locator("[data-group-label]").evaluateAll((elements) => elements.filter((element) => {
    const bounds = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    return Number(style.opacity) > 0.05 && bounds.width > 0 && bounds.height > 0
      && bounds.right > 0 && bounds.bottom > 0 && bounds.left < innerWidth && bounds.top < innerHeight;
  }).length);
  expect(labelsInsideViewport).toBeGreaterThan(10);
  await page.screenshot({ path: "screenshots/gbrain-memory-map-2d.png" });
  await page.waitForTimeout(180);
  await page.screenshot({ path: "screenshots/gbrain-memory-map-2d.png" });
  const communityLabels = page.locator("[data-group-label]");
  await expect(communityLabels.first()).toBeVisible();
  await expect(communityLabels.filter({ hasText: "No retained relation" })).toHaveCount(0);
  const labelPresentation = await communityLabels.evaluateAll((elements) => elements.map((element) => {
    const html = element as HTMLElement;
    const style = getComputedStyle(html);
    return {
      left: html.dataset.labelLeft ?? "",
      top: html.dataset.labelTop ?? "",
      transform: html.style.transform,
      color: style.color,
      background: style.backgroundColor,
    };
  }));
  expect(labelPresentation.every((label) => Number.isInteger(Number.parseFloat(label.left)) && Number.isInteger(Number.parseFloat(label.top)))).toBe(true);
  expect(labelPresentation.every((label) => label.transform.replaceAll(" ", "") === `translate3d(${label.left}px,${label.top}px,0px)`)).toBe(true);
  expect(labelPresentation.every((label) => label.color === "rgba(255, 255, 255, 0.3)" && label.background === "rgba(0, 0, 0, 0.4)")).toBe(true);
  let haloTextRevealed = false;
  let haloHoverPoint: { x: number; y: number } | null = null;
  for (let y = 220; y <= 820 && !haloTextRevealed; y += 36) for (let x = 420; x <= 1080; x += 36) {
    await page.mouse.move(x, y);
    await page.waitForTimeout(18);
    haloTextRevealed = await communityLabels.evaluateAll((elements) => elements.some((element) => getComputedStyle(element).color === "rgb(255, 255, 255)"));
    if (haloTextRevealed) { haloHoverPoint = { x, y }; break; }
  }
  expect(haloTextRevealed).toBe(true);
  expect(haloHoverPoint).not.toBeNull();
  await page.mouse.move(haloHoverPoint!.x, haloHoverPoint!.y);
  await page.waitForTimeout(180);
  const focusedPresentation = await communityLabels.evaluateAll((elements) => elements.map((element) => {
    const style = getComputedStyle(element);
    return { color: style.color, background: style.backgroundColor };
  }));
  expect(focusedPresentation.filter((label) => label.color === "rgb(255, 255, 255)" && label.background === "rgba(0, 0, 0, 0.58)")).toHaveLength(1);
  expect(focusedPresentation.filter((label) => label.color === "rgba(255, 255, 255, 0.09)" && label.background === "rgba(0, 0, 0, 0.16)")).toHaveLength(focusedPresentation.length - 1);
  const hoverFocus = await page.getByTestId("memory-graph").evaluate((element) => ({ group: element.dataset.hoveredGroup, count: Number(element.dataset.hoverFocusCount) }));
  expect(hoverFocus.group).toMatch(/^group-/);
  expect(hoverFocus.count).toBeGreaterThan(0);
  await page.waitForTimeout(120);
  await page.screenshot({ path: "screenshots/gbrain-memory-map-halo-hover.png" });
  await page.waitForTimeout(180);
  await page.screenshot({ path: "screenshots/gbrain-memory-map-halo-hover.png" });
  await page.mouse.move(20, 20);
  await expect.poll(() => communityLabels.evaluateAll((elements) => elements.every((element) =>
    getComputedStyle(element).color === "rgba(255, 255, 255, 0.3)")), { timeout: 1_000 }).toBe(true);
  await viewModeToggle.click();
  await expect(page.getByRole("heading", { name: "GBrain 3D Memory Map" })).toBeVisible();
  await expect.poll(() => memoryGraph.getAttribute("data-view-transitioning"), { timeout: 3_000 }).toBe("false");
  await page.waitForTimeout(450);
  expect(Number(await memoryGraph.getAttribute("data-map-depth"))).toBeGreaterThan(1);
  const restoredSpatialState = await memoryGraph.evaluate((element) => ({
    coordinateMode: element.dataset.coordinateMode,
    sceneDepth: Number(element.dataset.sceneDepth),
    nodePositionError: Number(element.dataset.sceneNodePositionError),
    haloCenterError: Number(element.dataset.haloCenterError),
    haloContainmentError: Number(element.dataset.haloContainmentError),
    cameraX: Number(element.dataset.cameraX),
    cameraY: Number(element.dataset.cameraY),
  }));
  expect(restoredSpatialState.coordinateMode).toBe("3d");
  expect(restoredSpatialState.sceneDepth).toBeGreaterThan(1);
  expect(restoredSpatialState.nodePositionError).toBeLessThan(0.001);
  expect(restoredSpatialState.haloCenterError).toBeLessThan(0.001);
  expect(restoredSpatialState.haloContainmentError).toBeLessThan(0.001);
  expect(Math.abs(restoredSpatialState.cameraX)).toBeGreaterThan(1);
  expect(Math.abs(restoredSpatialState.cameraY)).toBeGreaterThan(1);
  const canvas = page.locator("canvas");
  const box = await canvas.boundingBox();
  expect(box).not.toBeNull();
  let nodeTooltipPoint: { x: number; y: number } | null = null;
  const clusterCenters = [{ x: 760, y: 585 }, { x: 610, y: 455 }, { x: 830, y: 650 }, { x: 700, y: 535 }];
  for (const center of clusterCenters) {
    for (let dy = -42; dy <= 42 && !nodeTooltipPoint; dy += 8) {
      for (let dx = -42; dx <= 42; dx += 8) {
        const point = { x: center.x + dx, y: center.y + dy };
        await page.mouse.move(point.x, point.y);
        await page.waitForTimeout(62);
        const tooltip = await visibleTooltipText(page);
        if (tooltip.includes("Type ·") && tooltip.includes("Chunks ·")) { nodeTooltipPoint = point; break; }
      }
    }
    if (nodeTooltipPoint) break;
  }
  expect(nodeTooltipPoint).not.toBeNull();
  await page.screenshot({ path: "screenshots/gbrain-memory-map-tooltip.png" });
  let edgeTooltipFound = false;
  for (let y = 576; y <= 614 && !edgeTooltipFound; y += 6) {
    for (let x = 360; x <= 1080; x += 6) {
      await page.mouse.move(x, y);
      await page.waitForTimeout(56);
      const tooltip = await visibleTooltipText(page);
      if (tooltip.includes("Pattern ·") && (tooltip.includes("solid") || tooltip.includes("dashed/dotted"))) { edgeTooltipFound = true; break; }
    }
  }
  expect(edgeTooltipFound).toBe(true);
  await page.screenshot({ path: "screenshots/gbrain-memory-map-edge-tooltip.png" });
  let clickPoint: { x: number; y: number } | null = null;
  for (let dy = -10; dy <= 10 && !clickPoint; dy += 2) for (let dx = -10; dx <= 10; dx += 2) {
    const point = { x: nodeTooltipPoint!.x + dx, y: nodeTooltipPoint!.y + dy };
    await page.mouse.move(point.x, point.y);
    await page.waitForTimeout(62);
    const tooltip = await visibleTooltipText(page);
    if (tooltip.includes("Type ·") && tooltip.includes("Chunks ·")) { clickPoint = point; break; }
  }
  expect(clickPoint).not.toBeNull();
  await page.mouse.click(clickPoint!.x, clickPoint!.y);
  await expect(page.getByTestId("selected-summary")).toContainText("1-hop highlighted");
  await page.waitForTimeout(250);
  await page.screenshot({ path: "screenshots/gbrain-memory-map-selected.png" });
  await interactionContext.close();
  expect(consoleErrors).toEqual([]);
  expect(failedRequests).toEqual([]);
});
