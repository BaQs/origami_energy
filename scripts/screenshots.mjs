// Renders the README images listed in test/shots.json, light and dark side by side, with the mock and the
// Origami theme in test/mock/theme.local.css. The theme is not part of this repository (see CLAUDE.md).
import { chromium } from "@playwright/test";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import "../test/server.mjs";

const root = new URL("..", import.meta.url).pathname;
if (!existsSync(`${root}test/mock/theme.local.css`)) {
  console.log("test/mock/theme.local.css is missing, see CLAUDE.md");
  process.exit(1);
}
mkdirSync(`${root}images`, { recursive: true });
const shots = JSON.parse(readFileSync(`${root}test/shots.json`, "utf8"));
const browser = await chromium.launch();
const page = await browser.newPage({ deviceScaleFactor: 2, viewport: { width: 900, height: 1200 } });
for (const shot of shots) {
  const query = new URLSearchParams({ theme: "both", width: String(shot.width ?? 402), ...shot.params, fixture: shot.fixture });
  await page.goto(`http://localhost:4173/test/mock/index.html?${query}`);
  await page.evaluate(() => window.ready);
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(shot.wait ?? 400);
  // height crops long cards such as the details view to their top part
  const box = await page.locator("#page").boundingBox();
  await page.screenshot({ path: `${root}images/${shot.name}.png`, clip: { ...box, height: Math.min(box.height, shot.height ?? box.height) } });
  console.log(`images/${shot.name}.png`);
}
await browser.close();
process.exit(0);
