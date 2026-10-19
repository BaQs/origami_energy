import { expect, test } from "@playwright/test";

const open = async (page, query) => {
  await page.goto(`/test/mock/index.html?${query}`);
  await page.evaluate(() => window.ready);
};
const card = (page, layout) => page.locator(`origami-energy`).filter({ has: page.locator(`ha-card.${layout}`) });

test("the summary shows today's cost and use for electricity, gas and water", async ({ page }) => {
  await open(page, "fixture=summary");
  const summary = card(page, "summary");
  await expect(summary.locator(".vcol")).toHaveCount(3);
  await expect(summary).toContainText("Electricity");
  await expect(summary).toContainText("kWh");
  await expect(summary).toContainText("m³");
  await expect(summary).toContainText(/€\d/);
});

test("tapping an energy opens the navigation path on that energy", async ({ page }) => {
  await open(page, "fixture=summary");
  await card(page, "summary").locator('.vcol[data-v="gas"]').click();
  expect(await page.evaluate(() => location.hash)).toBe("#energy");
  expect(await page.evaluate(() => window.__origamiEnergyView.src)).toBe("gas");
  expect(await page.evaluate(() => window.events.some((e) => e.type === "location-changed"))).toBe(true);
});

test("the banner shows the total, the tariff and the current power", async ({ page }) => {
  await open(page, "fixture=banner");
  const banner = card(page, "banner");
  await expect(banner).toContainText("Peak hours");
  await expect(banner).toContainText("1,240 W");
});

test("the tiles show the total and one tile per energy", async ({ page }) => {
  await open(page, "fixture=tiles");
  await expect(card(page, "tiles").locator(".tile")).toHaveCount(4);
});

test("the details view switches periods and energies", async ({ page }) => {
  await open(page, "fixture=details");
  const details = card(page, "details");
  await expect(details).toContainText("Today");
  await details.locator('button[data-act="per"][data-v="week"]').click();
  await expect(details).toContainText("This week");
  await details.locator('button[data-act="src"][data-v="water"]').click();
  await expect(details).toContainText("Water · This week");
  await expect(details).toContainText("No water");
});

test("the details view opens on the energy a tile asked for", async ({ page }) => {
  await open(page, "fixture=details&src=elec");
  await expect(card(page, "details")).toContainText("Electricity · Today");
  await expect(card(page, "details")).toContainText("Off-peak hours");
});

test("texts follow the language of Home Assistant", async ({ page }) => {
  await open(page, "fixture=summary&lang=fr");
  await expect(card(page, "summary")).toContainText("Électricité");
  await expect(card(page, "summary")).toContainText(/\d,\d\d\s€/);
});

test("amounts use the currency of Home Assistant", async ({ page }) => {
  await open(page, "fixture=summary&currency=USD");
  await expect(card(page, "summary")).toContainText(/\$\d/);
});

test("an error from Home Assistant shows on the card", async ({ page }) => {
  await open(page, "fixture=banner&error=Unauthorized");
  await expect(card(page, "banner")).toContainText("Error: Unauthorized");
});
