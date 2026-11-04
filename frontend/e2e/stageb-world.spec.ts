import { expect, test } from "@playwright/test";

test("rural gap: disconnected phone, region panel, coverage link", async ({ page }) => {
  await page.goto("/simulation?scenario=shared_world", { waitUntil: "domcontentloaded" });
  await expect(page.locator("canvas").first()).toBeVisible({ timeout: 30000 });
  await page.waitForTimeout(4000);

  // Disconnected rural endpoint explains itself.
  await page.getByRole("button", { name: "Saltmeadow Phone A" }).click();
  await expect(page.locator("aside").nth(1).getByText("No route — disconnected.")).toBeVisible({ timeout: 10000 });

  // Rural tint click opens the coverage-gap panel (open grass NE of the
  // settlement: inside the tint, clear of clickable nodes and buildings).
  await page.getByRole("button", { name: "Rural", exact: true }).first().click();
  await page.waitForTimeout(1200);
  const box = await page.locator("canvas").first().boundingBox();
  expect(box).not.toBeNull();
  await page.mouse.click(box!.x + box!.width * 0.41, box!.y + box!.height * 0.47);
  const inspector = page.locator("aside").nth(1);
  await expect(inspector.getByText("Saltmeadow Settlement").first()).toBeVisible({ timeout: 10000 });
  await expect(inspector.getByText("coverage: none")).toBeVisible();
  await expect(inspector.getByRole("link", { name: "Open Coverage Research" })).toBeVisible();
  // Places list drills into the school building.
  await inspector.getByRole("button", { name: "Saltmeadow School" }).click();
  await expect(inspector.getByText("No backhaul uplink exists.")).toBeVisible({ timeout: 10000 });
});

test("infrastructure placement persists to the scenario", async ({ page }) => {
  await page.goto("/simulation?scenario=shared_world", { waitUntil: "domcontentloaded" });
  await expect(page.locator("canvas").first()).toBeVisible({ timeout: 30000 });
  await page.waitForTimeout(4000);
  await page.getByRole("button", { name: "City", exact: true }).first().click();
  await page.waitForTimeout(1200);

  await page.locator("aside").nth(0).getByRole("button", { name: "South City Cell" }).click();
  const inspector = page.locator("aside").nth(1);
  await expect(inspector.getByText("base_station · city-bs-2")).toBeVisible({ timeout: 10000 });

  // Click-to-place on empty ground (bottom-left grass in city view).
  await inspector.getByRole("button", { name: "Place in world", exact: true }).click();
  const box = await page.locator("canvas").first().boundingBox();
  expect(box).not.toBeNull();
  await page.mouse.click(box!.x + box!.width * 0.12, box!.y + box!.height * 0.85);
  await page.waitForTimeout(1000);
  const moved = await page.evaluate(async () => {
    const r = await fetch("http://localhost:8001/api/simulation/state?scenario_id=shared_world");
    const s = await r.json();
    return (s.nodes.find((n: { id: string }) => n.id === "city-bs-2") as { world_position: { x_km: number } }).world_position;
  });
  expect(moved.x_km).not.toBeCloseTo(4.0, 0);

  // Persist + reload proves it stuck.
  await inspector.getByRole("button", { name: "Save placement", exact: true }).click();
  await expect(page.getByText(/Placement saved to scenario/)).toBeVisible({ timeout: 10000 });
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(page.locator("canvas").first()).toBeVisible({ timeout: 30000 });
  await page.waitForTimeout(3000);
  const saved = await page.evaluate(async () => {
    const r = await fetch("http://localhost:8001/api/scenarios/shared_world");
    const s = await r.json();
    return (s.topology.nodes.find((n: { id: string }) => n.id === "city-bs-2") as { world_position: { x_km: number } }).world_position;
  });
  expect(saved.x_km).toBeCloseTo(moved.x_km, 5);

  // Restore canonical geometry for other tests.
  await page.evaluate(async () => {
    await fetch("http://localhost:8001/api/scenarios/shared_world/nodes/city-bs-2", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ world_position: { x_km: 4, y_km: -10, altitude_m: 40 } }),
    });
  });
});

test("overlay modes and scenario focus", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto("/simulation?scenario=shared_world", { waitUntil: "domcontentloaded" });
  await expect(page.locator("canvas").first()).toBeVisible({ timeout: 30000 });
  await page.waitForTimeout(4000);

  const overlay = page.locator("select[title='Overlay mode: what the 3D view emphasizes']");
  for (const mode of ["clean", "coverage", "health", "topology", "traffic", "selected", "active"]) {
    await overlay.selectOption(mode);
    await page.waitForTimeout(400);
  }
  await expect(page.locator("canvas").first()).toBeVisible();

  // Scenario switch keeps one world, moves focus + description.
  await page.locator("select[title='Scenario']").selectOption("vehicle_corridor");
  await expect(page.getByText("Connected car drives the corridor road").first()).toBeVisible({ timeout: 15000 });
  await page.locator("select[title='Scenario']").selectOption("maritime_failover");
  await expect(page.getByText("Vessel sails from the harbor").first()).toBeVisible({ timeout: 15000 });
  expect(errors).toEqual([]);
});
