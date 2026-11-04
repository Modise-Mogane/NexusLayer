import { expect, test } from "@playwright/test";

/* UI-audit regressions: labeled engineering forms, unit-aware fields, and
   no raw structured data in user-facing lists. */

test("research form is labeled and findings read as rows", async ({ page }) => {
  await page.goto("/research", { waitUntil: "domcontentloaded" });
  // Visible labels, not placeholder-only fields.
  await expect(page.getByText("RESEARCH TITLE", { exact: false }).first()).toBeVisible({
    timeout: 15000,
  });
  await expect(page.getByText("Technical assumptions").first()).toBeVisible();
  await expect(page.getByText("Measurements and test results").first()).toBeVisible();

  // Submit via the labeled form (placeholders kept for input targeting).
  await page.locator('input[placeholder="Research title"]').fill(`Audit probe ${Date.now()}`);
  await page.locator('textarea[placeholder^="Problem"]').fill("Audit probe claim.");
  await page.getByRole("button", { name: "Submit finding" }).click();
  await expect(page.getByText(/saved|submitted/i).first()).toBeVisible({ timeout: 30000 });
  // Findings list is hairline rows with a status, not gray slabs.
  await expect(page.getByText(/Audit probe/).first()).toBeVisible();
});

test("hardware engineering uses labeled unit-aware fields", async ({ page }) => {
  await page.goto("/hardware-engineering", { waitUntil: "domcontentloaded" });
  await expect(page.getByText("Transmit power").first()).toBeVisible({ timeout: 15000 });
  await expect(page.getByText("Receiver sensitivity").first()).toBeVisible();
  await expect(page.getByText("Mbps", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("dBm", { exact: true }).first()).toBeVisible();
  // Feasibility check runs and reports a verdict.
  await page.getByRole("button", { name: "Run feasibility check" }).click();
  await expect(page.getByText(/Verdict:/).first()).toBeVisible({ timeout: 30000 });
});

test("analysis shows guidance, not raw dumps, when empty", async ({ page }) => {
  await page.goto("/analysis", { waitUntil: "domcontentloaded" });
  await expect(page.getByText("Handover history").first()).toBeVisible({ timeout: 15000 });
  await expect(page.getByRole("link", { name: "Run the simulation" }).first()).toBeVisible();
});
