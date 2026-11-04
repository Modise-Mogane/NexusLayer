import { expect, test } from "@playwright/test";

const API = process.env.E2E_API_URL ?? "http://localhost:8001";

test("device interfaces persist across reload", async ({ page }) => {
  await page.goto("/architecture", { waitUntil: "domcontentloaded" });
  await expect(page.locator(".react-flow__node").first()).toBeVisible({ timeout: 30000 });
  await page.waitForTimeout(1500);
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));

  // Select the ship; inspector shows its interfaces section.
  await page.locator(".react-flow__node[data-id='ship-1']").click();
  await expect(page.getByText("Interfaces / ports (")).toBeVisible({ timeout: 10000 });

  // Add a cellular port and save (maritime is read-only: forks a scenario).
  const portName = `lte-e2e-${Date.now() % 100000}`;
  await page.getByLabel("New port name").fill(portName);
  await page.getByLabel("New port kind").selectOption("cellular");
  await page.getByRole("button", { name: "Add", exact: true }).last().click();
  await expect(page.getByText(portName).first()).toBeVisible();
  await page.getByRole("button", { name: "Save interfaces" }).click();
  await expect(page.getByRole("button", { name: "Saved", exact: true })).toBeVisible({ timeout: 15000 });

  // Fork banner carries the new scenario id; reload proves persistence.
  const banner = await page.locator("text=Saved as new scenario").innerText();
  const sid = banner.replace("Saved as new scenario", "").split(" ")[1].trim();
  await page.goto(`/architecture?scenario=${sid}`, { waitUntil: "domcontentloaded" });
  await expect(page.locator(".react-flow__node[data-id='ship-1']").first()).toBeVisible({ timeout: 30000 });
  await page.locator(".react-flow__node[data-id='ship-1']").click();
  await expect(page.getByText(portName).first()).toBeVisible({ timeout: 10000 });

  // Cleanup the forked scenario.
  await page.evaluate(
    ([api, id]) => fetch(`${api}/api/scenarios/${id}`, { method: "DELETE" }),
    [API, sid] as [string, string]
  );
  expect(errors).toEqual([]);
});

test("link inspector shows medium, honest calculations, and security", async ({ page }) => {
  await page.goto("/architecture", { waitUntil: "domcontentloaded" });
  await expect(page.locator(".react-flow__node").first()).toBeVisible({ timeout: 30000 });
  await page.waitForTimeout(1500);
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));

  // Select the ship-to-shore cellular link.
  await page.locator(".react-flow__edge[data-id='link-ship-cellular']").click({ force: true });
  await expect(page.getByRole("button", { name: "Calculations" })).toBeVisible({ timeout: 10000 });

  // Physical medium explanation names the base station interaction.
  await page.getByRole("button", { name: "Medium" }).click();
  await expect(page.getByText("base station assigns time/frequency resources")).toBeVisible({ timeout: 10000 });

  // Calculations: budget is computed with inputs; SNR is honestly absent.
  await page.getByRole("button", { name: "Calculations" }).click();
  await expect(page.getByText("Radio link budget").first()).toBeVisible();
  await expect(page.getByText("Received power").first()).toBeVisible();
  await expect(page.getByText("Not calculated").first()).toBeVisible();

  // Security tab warns about hop-only scope; saving forks maritime.
  await page.getByRole("button", { name: "Security" }).click();
  await page.getByLabel("Security enabled in simulation").check();
  await page.getByRole("button", { name: "Save security" }).click();
  await expect(page.locator("text=Saved as new scenario")).toBeVisible({ timeout: 15000 });
  const banner = await page.locator("text=Saved as new scenario").innerText();
  const sid = banner.replace("Saved as new scenario", "").split(" ")[1].trim();
  await expect(page.getByText("Protects this hop only")).toBeVisible({ timeout: 10000 });

  // Port compatibility is enforced server-side: wifi vs cellular is rejected.
  const verdict = await page.evaluate(async (api) => {
    const res = await fetch(`${api}/api/compatibility/check-ports`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        source_port: { name: "w0", kind: "wifi", channel: "6" },
        target_port: { name: "c0", kind: "cellular", bands: ["B3"] },
      }),
    });
    return (await res.json()) as { compatible: boolean; reason: string };
  }, API);
  expect(verdict.compatible).toBe(false);

  await page.evaluate(
    ([api, id]) => fetch(`${api}/api/scenarios/${id}`, { method: "DELETE" }),
    [API, sid] as [string, string]
  );
  expect(errors).toEqual([]);
});
