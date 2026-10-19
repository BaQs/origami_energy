import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "test",
  use: {
    baseURL: "http://localhost:4173",
    viewport: { width: 412, height: 800 },
  },
  webServer: {
    command: "node test/server.mjs",
    url: "http://localhost:4173/test/mock/index.html",
    reuseExistingServer: !process.env.CI,
  },
});
