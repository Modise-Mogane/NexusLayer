import { expect, test } from "@playwright/test";

const API = process.env.E2E_API_URL ?? "http://localhost:8001";

test("overview shows backend-connected status", async ({ page }) => {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await expect(page.locator("text=Backend connected").first()).toBeVisible({ timeout: 15000 });
});

test("hardware library lists key devices", async ({ page }) => {
  await page.goto("/hardware", { waitUntil: "domcontentloaded" });
  await expect(page.locator("text=Coastal LTE Base Station").first()).toBeVisible({ timeout: 15000 });
  await expect(page.locator("text=Ship Communication System").first()).toBeVisible({ timeout: 15000 });
});

test("maritime 3D simulation runs and hands over", async ({ page }) => {
  await page.goto("/simulation", { waitUntil: "domcontentloaded" });
  await expect(page.locator("canvas").first()).toBeVisible({ timeout: 30000 });
  await page.waitForTimeout(3000);
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));

  await page.getByRole("button", { name: "Reset" }).click();
  await page.getByLabel("Simulation speed").selectOption("20x");
  await page.getByRole("button", { name: "Run" }).click();
  await page.getByRole("button", { name: "Sail out" }).click();
  let handover = false;
  for (let i = 0; i < 30; i++) {
    await page.waitForTimeout(2000);
    const state = await page.evaluate((api) => fetch(`${api}/api/simulation/state`).then((r) => r.json()), API);
    if (state.connectivity === "degraded" && state.active_route.node_ids[1] === "satellite-1") {
      handover = true;
      break;
    }
  }
  expect(handover).toBe(true);
  await expect(page.locator("text=Handover in progress").first()).toBeVisible({ timeout: 10000 });
  expect(errors).toEqual([]);
  await page.getByRole("button", { name: "Pause" }).click();
  await page.getByRole("button", { name: "Reset" }).click();
});

test("vehicle corridor drives and hands over west to east", async ({ page }) => {
  await page.goto("/simulation?scenario=vehicle_corridor", { waitUntil: "domcontentloaded" });
  await expect(page.locator("canvas").first()).toBeVisible({ timeout: 30000 });
  await page.waitForTimeout(3000);
  await page.getByRole("button", { name: "Reset" }).click();
  await page.getByLabel("Simulation speed").selectOption("20x");
  await page.getByRole("button", { name: "Run" }).click();
  let handover = false;
  for (let i = 0; i < 45; i++) {
    await page.waitForTimeout(2000);
    const state = await page.evaluate(
      (api) => fetch(`${api}/api/simulation/state?scenario_id=vehicle_corridor`).then((r) => r.json()),
      API
    );
    if (state.active_route?.node_ids?.[1] === "bs-east-1") {
      handover = true;
      break;
    }
  }
  expect(handover).toBe(true);
  await page.getByRole("button", { name: "Pause" }).click();
  await page.getByRole("button", { name: "Reset" }).click();
});

test("architecture studio renders, edits, and persists topology", async ({ page }) => {
  await page.goto("/architecture", { waitUntil: "domcontentloaded" });
  await expect(page.locator(".react-flow__node").first()).toBeVisible({ timeout: 30000 });
  await page.waitForTimeout(1500);
  // Nodes must be actually visible (regression: visibility:hidden measurement bug).
  const visibilities = await page.evaluate(() =>
    [...document.querySelectorAll(".react-flow__node")].map(
      (n) => getComputedStyle(n).visibility
    )
  );
  expect(visibilities.length).toBeGreaterThanOrEqual(5);
  expect(visibilities.every((v) => v === "visible")).toBe(true);
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));

  // Add a router: appears immediately, selected, shown in inspector.
  await page.selectOption("select >> nth=2", "router");
  await page.getByRole("button", { name: "Add to canvas" }).click();
  const newId = await page.evaluate(
    () =>
      [...document.querySelectorAll(".react-flow__node")]
        .map((n) => n.getAttribute("data-id") ?? "")
        .find((id) => id.startsWith("node-")) ?? ""
  );
  expect(newId).not.toBe("");
  await expect(page.locator(`.react-flow__node[data-id="${newId}"]`)).toBeVisible();
  await expect(page.locator("aside").getByText("New router").first()).toBeVisible();

  // Connect router to the satellite gateway via handle drag.
  const src = page.locator(`.react-flow__node[data-id="${newId}"] .react-flow__handle.source`);
  const dst = page.locator(".react-flow__node[data-id='sat-gateway-1'] .react-flow__handle.target");
  const sb = (await src.boundingBox())!;
  const db = (await dst.boundingBox())!;
  await page.mouse.move(sb.x + sb.width / 2, sb.y + sb.height / 2);
  await page.mouse.down();
  await page.mouse.move(db.x + db.width / 2, db.y + db.height / 2, { steps: 20 });
  await page.mouse.up();
  await expect(page.locator(".react-flow__edge")).toHaveCount(6, { timeout: 5000 });
  await expect(page.locator("text=Unsaved changes")).toBeVisible();

  // Undo removes the link, redo restores it.
  await page.getByRole("button", { name: "Undo" }).click();
  await expect(page.locator(".react-flow__edge")).toHaveCount(5, { timeout: 5000 });
  await page.getByRole("button", { name: "Redo" }).click();
  await expect(page.locator(".react-flow__edge")).toHaveCount(6, { timeout: 5000 });

  // Save (maritime is read-only: saves as a new scenario), reload, verify.
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.locator("text=Saved as new scenario")).toBeVisible({ timeout: 15000 });
  const banner = await page.locator("text=Saved as new scenario").innerText();
  const sid = banner.replace("Saved as new scenario", "").split(" ")[1].trim();
  await page.goto(`/architecture?scenario=${sid}`, { waitUntil: "domcontentloaded" });
  await expect(page.locator(".react-flow__node")).toHaveCount(6, { timeout: 30000 });
  await expect(page.locator(".react-flow__edge")).toHaveCount(6, { timeout: 10000 });
  const vis2 = await page.evaluate(() =>
    [...document.querySelectorAll(".react-flow__node")].map(
      (n) => getComputedStyle(n).visibility
    )
  );
  expect(vis2.every((v) => v === "visible")).toBe(true);
  expect(errors).toEqual([]);
});

test("research submission and deterministic assessment", async ({ page }) => {
  await page.goto("/research", { waitUntil: "domcontentloaded" });
  await page.locator('input[placeholder="Research title"]').fill(`E2E finding ${Date.now()}`);
  await page.locator('textarea[placeholder^="Problem"]').fill("Handover latency was measured at 250 ms in harbor trials.");
  await page.getByRole("button", { name: "Submit finding" }).click();
  await expect(page.locator("text=Request assessment").first()).toBeVisible({ timeout: 15000 });
  await page.getByRole("button", { name: "Request assessment" }).click();
  await expect(page.locator("text=Verdict:").first()).toBeVisible({ timeout: 15000 });
});

test("shared world routes all endpoints and fails over offshore", async ({ page }) => {
  await page.goto("/simulation?scenario=shared_world", { waitUntil: "domcontentloaded" });
  await expect(page.locator("canvas").first()).toBeVisible({ timeout: 30000 });
  await page.waitForTimeout(3000);
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));

  await page.getByRole("button", { name: "Reset" }).click();
  await expect(page.locator("text=Endpoints (10)").first()).toBeVisible({ timeout: 15000 });
  await page.getByLabel("Simulation speed").selectOption("20x");
  await page.getByRole("button", { name: "Run" }).click();
  let failedOver = false;
  for (let i = 0; i < 45; i++) {
    await page.waitForTimeout(2000);
    const state = await page.evaluate(
      (api) => fetch(`${api}/api/simulation/state?scenario_id=shared_world`).then((r) => r.json()),
      API
    );
    const eps = Object.fromEntries(state.endpoint_routes.map((e: { endpoint_id: string }) => [e.endpoint_id, e]));
    const ship = eps["ship-1"];
    const phone = eps["ship-phone"];
    if (ship?.route?.node_ids?.includes("ship-sat") && phone?.route?.node_ids?.includes("ship-sat")) {
      failedOver = true;
      const wifi = state.links.find((l: { id: string }) => l.id === "link-shipphone-ap");
      expect(wifi.suitable).toBe(true);
      expect(phone.traffic_suitable).toBe(false);
      break;
    }
  }
  expect(failedOver).toBe(true);

  // Endpoint selection shows the full route; report summarizes the run.
  await page.getByRole("button", { name: /Ship Phone/ }).first().click();
  await expect(page.locator("text=Route to internet").first()).toBeVisible({ timeout: 10000 });
  await page.getByRole("button", { name: "Report" }).click();
  await expect(page.locator("text=After-action report").first()).toBeVisible({ timeout: 10000 });
  await expect(page.locator("text=Recommendations").first()).toBeVisible();
  await page.getByRole("button", { name: "Close" }).click();

  expect(errors).toEqual([]);
  await page.getByRole("button", { name: "Pause" }).click();
  await page.getByRole("button", { name: "Reset" }).click();
});

test("agent chat answers, streams, and persists", async ({ page }) => {
  await page.goto("/ai", { waitUntil: "domcontentloaded" });
  await expect(page.locator("text=Active:").first()).toBeVisible({ timeout: 15000 });
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));

  // Deterministic mode: no model calls, tool-grounded reply.
  await page.getByLabel("Live AI").uncheck();
  await page.locator("textarea[placeholder*='Ask about']").fill("How is the network performing?");
  await page.getByRole("button", { name: "Send", exact: true }).click();
  // Reply streams in (SSE frames asserted in backend tests) and persists.
  await expect(page.locator("text=availability").first()).toBeVisible({ timeout: 30000 });
  // Follow-up in the same conversation.
  await page.locator("textarea[placeholder*='Ask about']").fill("Which endpoint has the highest latency?");
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await expect(page.locator("text=local_deterministic").nth(1)).toBeVisible({ timeout: 30000 });
  // Reload: conversation persists in history.
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(page.locator("text=How is the network performing?").first()).toBeVisible({ timeout: 15000 });
  expect(errors).toEqual([]);
});

test("knowledge upload, search, and source registry", async ({ page }) => {
  await page.goto("/knowledge", { waitUntil: "domcontentloaded" });
  await expect(page.locator("text=RFC 9293 — TCP").first()).toBeVisible({ timeout: 15000 });
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));

  await page.getByRole("button", { name: /Documents/ }).click();
  const uploaded = await page.evaluate(async () => {
    const content = "# E2E unique passage\nThe zebra-striped backhaul carries mango traffic.";
    const form = new FormData();
    form.append("file", new File([content], "e2e-note.md", { type: "text/markdown" }));
    const res = await fetch("http://localhost:8001/api/knowledge/upload", { method: "POST", body: form });
    return (await res.json()) as { id: string; title: string };
  });
  expect(uploaded.id).toMatch(/^doc-/);
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: /Documents/ }).click();
  await expect(page.locator("text=e2e-note.md").first()).toBeVisible({ timeout: 15000 });

  await page.getByRole("button", { name: "Search", exact: true }).click();
  await page.locator("input[placeholder*='Search indexed']").fill("zebra-striped mango backhaul");
  await page.locator("input[placeholder*='Search indexed']").press("Enter");
  await expect(page.locator("text=zebra-striped").first()).toBeVisible({ timeout: 15000 });

  // Cleanup via API; registry tab shows ingested sources from the sweep.
  await page.evaluate((id) => fetch(`http://localhost:8001/api/knowledge/${id}`, { method: "DELETE" }), uploaded.id);
  await page.getByRole("button", { name: /Sources/ }).click();
  await expect(page.locator("text=indexed").first()).toBeVisible({ timeout: 15000 });
  expect(errors).toEqual([]);
});

test("coverage analysis proposes and saves a scenario", async ({ page }) => {
  await page.goto("/coverage", { waitUntil: "domcontentloaded" });
  await expect(page.locator("text=Highland Valley").first()).toBeVisible({ timeout: 15000 });
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));

  await page.locator("text=Highland Valley").first().click();
  await page.getByRole("button", { name: "Analyze selected region" }).click();
  await expect(page.locator("text=coverage_gap").first()).toBeVisible({ timeout: 15000 });
  await page.getByRole("button", { name: "Save as scenario & simulate" }).first().click();
  await expect(page.locator("text=Saved as scenario").first()).toBeVisible({ timeout: 15000 });

  // Jobs tab: manual reassessment run is logged.
  await page.getByRole("button", { name: /Scheduled jobs/ }).click();
  await page.getByRole("button", { name: "Run now" }).first().click();
  await page.getByRole("button", { name: "Runs" }).first().click();
  await page.locator("details summary").first().click();
  await expect(page.locator("text=highland-valley").first()).toBeVisible({ timeout: 30000 });
  expect(errors).toEqual([]);
});
