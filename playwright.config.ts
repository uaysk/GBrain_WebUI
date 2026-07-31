import { defineConfig } from "@playwright/test";

const fixturePort = Number(process.env.E2E_FIXTURE_PORT || 43_101);
const webPort = Number(process.env.E2E_WEB_PORT || 45_173);

export default defineConfig({
  testDir: "./e2e",
  testMatch: ["control-center.spec.ts", "chunk-boundaries.spec.ts", "map-ux.spec.ts"],
  timeout: 60_000,
  use: {
    baseURL: `http://127.0.0.1:${webPort}`,
    headless: true,
  },
  webServer: [
    {
      command: `E2E_FIXTURE_PORT=${fixturePort} bun scripts/e2e-fixture-api.ts`,
      url: `http://127.0.0.1:${fixturePort}/api/status`,
      reuseExistingServer: false,
      timeout: 120_000,
    },
    {
      command: `VITE_API_TARGET=http://127.0.0.1:${fixturePort} bun run dev:web -- --port ${webPort} --strictPort`,
      url: `http://127.0.0.1:${webPort}`,
      reuseExistingServer: false,
      timeout: 120_000,
    },
  ],
  reporter: "line",
});
