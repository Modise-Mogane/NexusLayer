import { defineConfig } from "@playwright/test";

/* Requires a running stack (docker compose up). Set PLAYWRIGHT_CHROMIUM_PATH
   to a system Chrome/Chromium binary to skip the Playwright browser download. */
export default defineConfig({
  testDir: "./e2e",
  timeout: 120000,
  retries: 0,
  // Cap parallelism: each worker renders a SwiftShader WebGL canvas against
  // one shared backend; uncapped workers starve the sim-handover tests and
  // flake rotationally. Three workers keeps the suite deterministic here.
  workers: 3,
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://localhost:3000",
    launchOptions: {
      executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH || undefined,
      args: ["--no-sandbox", "--use-gl=swiftshader", "--enable-unsafe-swiftshader", "--disable-dev-shm-usage"],
    },
  },
});
