import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  testMatch: "readme-demo.spec.ts",
  timeout: 90_000,
  workers: 1,
  use: {
    baseURL: "http://127.0.0.1:4174",
    viewport: { width: 1600, height: 1000 },
    headless: true,
  },
  webServer: {
    command: "bunx vite --host 127.0.0.1 --port 4174 --strictPort",
    url: "http://127.0.0.1:4174",
    reuseExistingServer: false,
    timeout: 120_000,
  },
  reporter: "line",
});
