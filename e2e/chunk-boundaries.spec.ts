import { expect, test } from "@playwright/test";

function requestedModules(urls: string[]): string {
  return urls.map((url) => new URL(url).pathname.toLowerCase()).join("\n");
}

test("control initial load excludes the graph renderer stack", async ({ page }) => {
  const requests: string[] = [];
  page.on("request", (request) => requests.push(request.url()));
  await page.goto("/control", { waitUntil: "networkidle" });
  await expect(page.getByTestId("control-center")).toBeVisible();
  const modules = requestedModules(requests);
  expect(modules).not.toContain("memorygraph");
  expect(modules).not.toContain("react-force-graph");
  expect(modules).not.toMatch(/\/three(?:\.js|\/)/);
  expect(modules).not.toContain("umap-js");
});

test("map initial load excludes the Control Center implementation", async ({ page }) => {
  const requests: string[] = [];
  page.on("request", (request) => requests.push(request.url()));
  await page.goto("/", { waitUntil: "networkidle" });
  await expect(page.getByTestId("memory-graph")).toBeVisible();
  expect(requestedModules(requests)).not.toContain("/components/control/controlcenter");
});

test("selection reuses factories and morph buffers", async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto("/?graphDiagnostics=1", { waitUntil: "networkidle" });
  const graph = page.getByTestId("memory-graph");
  await expect(graph).toBeVisible();
  await expect.poll(async () => graph.evaluate((element) => (
    JSON.parse(element.dataset.nodeHoverPoints ?? "[]") as unknown[]
  ).length), { timeout: 10_000 }).toBeGreaterThan(0);
  await page.waitForTimeout(700);
  const searchDialog = page.getByRole("dialog", { name: "Memory Map 검색" });
  const searchInput = searchDialog.getByRole("combobox");

  const toggleSelection = async () => {
    await page.keyboard.press("Control+K");
    await expect(searchDialog).toBeVisible();
    await expect(searchInput).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(graph).not.toHaveAttribute("data-selected-id", "");
    await page.keyboard.press("Escape");
    await expect(graph).toHaveAttribute("data-selected-id", "");
  };
  await toggleSelection();
  const before = await graph.evaluate((element) => ({
    nodes: Number(element.dataset.nodeFactoryCount),
    edges: Number(element.dataset.edgeFactoryCount),
  }));
  for (let iteration = 0; iteration < 100; iteration += 1) await toggleSelection();
  const after = await graph.evaluate((element) => ({
    nodes: Number(element.dataset.nodeFactoryCount),
    edges: Number(element.dataset.edgeFactoryCount),
  }));
  expect(after).toEqual(before);

  await page.getByTestId("view-mode-toggle").click();
  await expect(graph).toHaveAttribute("data-view-transitioning", "false", { timeout: 5_000 });
  await expect(graph).toHaveAttribute("data-morph-explicit-buffer-stable", "true");
  await expect(graph).toHaveAttribute("data-morph-semantic-buffer-stable", "true");
});
