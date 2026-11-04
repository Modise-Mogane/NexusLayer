import { expect, test } from "@playwright/test";

const API = process.env.E2E_API_URL ?? "http://localhost:8001";

test("spacing a saved architecture preserves its world positions", async ({ page, request }) => {
  const response = await request.post(`${API}/api/scenarios/shared_world/duplicate`, {
    data: { name: "Layout verification" },
  });
  expect(response.ok()).toBeTruthy();
  const original = await response.json();
  try {
    await page.goto(`/architecture?scenario=${original.id}`, { waitUntil: "domcontentloaded" });
    await expect(page.locator(".react-flow__node")).toHaveCount(original.topology.nodes.length);
    const labels = page.getByRole("button", { name: /Link labels/ });
    await expect(labels).toHaveAttribute("aria-pressed", "false");
    await labels.click();
    await expect(labels).toHaveAttribute("aria-pressed", "true");
    await page.getByRole("button", { name: "Space layout" }).click();
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect(page.getByText(/Saved scenario/).first()).toBeVisible();
    const saved = await (await request.get(`${API}/api/scenarios/${original.id}`)).json();
    expect(saved.topology.nodes.map((node: { world_position: unknown }) => node.world_position))
      .toEqual(original.topology.nodes.map((node: { world_position: unknown }) => node.world_position));
    expect(saved.topology.nodes.map((node: { position: unknown }) => node.position))
      .not.toEqual(original.topology.nodes.map((node: { position: unknown }) => node.position));
  } finally {
    await request.delete(`${API}/api/scenarios/${original.id}`);
  }
});
