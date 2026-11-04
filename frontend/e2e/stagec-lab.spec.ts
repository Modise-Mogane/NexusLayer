import { expect, test } from "@playwright/test";

const API = "http://localhost:8001";

test("physics lab calculates and responds to parameters", async ({ page }) => {
  await page.goto("/physics", { waitUntil: "domcontentloaded" });
  await expect(page.getByText("L2-engineering-calc").first()).toBeVisible({ timeout: 15000 });

  // Radio defaults produce a link budget.
  await expect(page.getByText("Free-space path loss").first()).toBeVisible();
  const before = await page.getByText("Link margin").first().locator("..").innerText();

  // Doubling the distance must worsen the margin (physics responds).
  await page.getByLabel("Distance").fill("10");
  await page.getByLabel("Distance").press("Enter");
  await page.waitForTimeout(800);
  const after = await page.getByText("Link margin").first().locator("..").innerText();
  expect(after).not.toEqual(before);

  // Quantum teleportation states the classical requirement honestly.
  await page.getByRole("button", { name: /Quantum teleportation/ }).click();
  await expect(page.getByText("L2-engineering-calc").first()).toBeVisible({ timeout: 15000 });
  await expect(page.getByText(/2 classical bits/).first()).toBeVisible();
  await expect(page.getByText(/light speed/).first()).toBeVisible();

  // BB84 detects the eavesdropper.
  await page.getByRole("button", { name: /BB84 key distribution/ }).click();
  await expect(page.getByText("sifted key length", { exact: false }).first()).toBeVisible({ timeout: 15000 });
  await page.getByRole("switch", { name: /Eavesdropper/ }).click();
  await expect(page.getByText(/INSECURE/).first()).toBeVisible({ timeout: 15000 });
});

test("link inspector opens prefilled physics", async ({ page, request }) => {
  const topo = await (await request.get(`${API}/api/scenarios/shared_world`)).json();
  const wifi = topo.topology.links.find((l: { technology: string }) =>
    /wi-fi/i.test(l.technology)
  ) ?? topo.topology.links[0];
  await page.goto(`/physics?scenario=shared_world&link=${wifi.id}`, { waitUntil: "domcontentloaded" });
  await expect(page.getByText(/Prefilled from/).first()).toBeVisible({ timeout: 15000 });
  await expect(page.getByText("L2-engineering-calc").first()).toBeVisible();
});

test("inter-device message delivers with traced hops", async ({ page }) => {
  await page.goto("/simulation?scenario=shared_world", { waitUntil: "domcontentloaded" });
  await expect(page.locator("canvas").first()).toBeVisible({ timeout: 30000 });
  await page.waitForTimeout(4000);

  const panel = page.locator("aside").nth(0);
  await panel.getByLabel("Message source device").selectOption("plane-phone");
  await panel.getByLabel("Message destination device").selectOption("laptop-1");
  await panel.getByRole("button", { name: "Send message" }).click();
  await expect(panel.getByText(/delivered/).first()).toBeVisible({ timeout: 15000 });
  // Hop trace with per-hop tech and a physics cross-link.
  await expect(panel.getByText(/Cabin Phone →/).first()).toBeVisible();
  await expect(panel.getByRole("link", { name: "physics" }).first()).toBeVisible();
  await expect(panel.getByText(/total .* ms/).first()).toBeVisible();
});

test("architecture and world deep-link both ways", async ({ page }) => {
  // Architecture → world: focus a tower.
  await page.goto("/simulation?scenario=shared_world&focus=city-bs-2", { waitUntil: "domcontentloaded" });
  await expect(page.locator("canvas").first()).toBeVisible({ timeout: 30000 });
  await expect(page.locator("aside").nth(1).getByText("South City Cell").first()).toBeVisible({ timeout: 15000 });
  // Cross-link back to the studio exists on the inspected node.
  await expect(
    page.locator("aside").nth(1).getByRole("link", { name: "Open in Architecture →" })
  ).toBeVisible();

  // World → architecture: the same node opens selected with its imagery.
  await page.goto("/architecture?scenario=shared_world&select=city-bs-2", { waitUntil: "domcontentloaded" });
  const inspector = page.locator("aside").nth(1);
  await expect(inspector.getByText("South City Cell").first()).toBeVisible({ timeout: 15000 });
  await expect(page.getByText(/from the 3D world/).first()).toBeVisible();
  await expect(inspector.locator("svg").first()).toBeVisible();
  await expect(inspector.getByRole("link", { name: "View in 3D →" })).toBeVisible();
});

test("global assistant converses and survives navigation", async ({ page }) => {
  await page.goto("/simulation?scenario=shared_world", { waitUntil: "domcontentloaded" });
  await expect(page.locator("canvas").first()).toBeVisible({ timeout: 30000 });

  // Live toggle exists and starts OFF (mic never auto-opens).
  const live = page.getByRole("button", { name: /Live Assistant/ });
  await expect(live).toBeVisible();
  await expect(live).toHaveAttribute("aria-pressed", "false");

  // Drawer opens; use deterministic local mode for stable assertions.
  await page.getByRole("button", { name: "Open assistant conversation" }).click();
  const drawer = page.getByRole("complementary", { name: "Live assistant" });
  await expect(drawer).toBeVisible();
  await drawer.getByRole("button", { name: "Assistant settings" }).click();
  await drawer.getByRole("switch", { name: "Use AI provider" }).click();
  await drawer.getByRole("button", { name: "Assistant settings" }).click();
  // Send a contextual text question.
  await drawer.getByLabel("Message the assistant").fill("How is the network performing?");
  await drawer.getByRole("button", { name: "Send", exact: true }).click();
  // Generous timeout: the shared backend also serves parallel spec workers.
  await expect(drawer.getByText(/Network assessment|Connected endpoints|Simulation status/).first()).toBeVisible({
    timeout: 90000,
  });

  // Conversation survives route changes (shell-level session).
  await page.goto("/physics", { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: "Open assistant conversation" }).click();
  const drawer2 = page.getByRole("complementary", { name: "Live assistant" });
  await expect(drawer2.getByText("How is the network performing?").first()).toBeVisible({ timeout: 10000 });

  // Voice capability is reported honestly in settings.
  await drawer2.getByRole("button", { name: "Assistant settings" }).click();
  await expect(drawer2.getByText(/Voice input:/).first()).toBeVisible();
});

test("control showcase and hardware deep link", async ({ page, request }) => {
  await page.goto("/design", { waitUntil: "domcontentloaded" });
  await expect(page.getByText("Antenna gain").first()).toBeVisible({ timeout: 15000 });
  await expect(page.getByRole("switch", { name: "Radio enabled" })).toBeVisible();

  const devices = await (await request.get(`${API}/api/hardware`)).json();
  const list = Array.isArray(devices) ? devices : devices.devices;
  expect(list.length).toBeGreaterThan(0);
  const target = list[0];
  await page.goto(`/hardware?device=${encodeURIComponent(target.device_id)}`, {
    waitUntil: "domcontentloaded",
  });
  await expect(page.getByText(target.name).first()).toBeVisible({ timeout: 15000 });
});
