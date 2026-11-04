const { chromium } = require("playwright");

(async () => {
  const browser = await chromium.launch({
    executablePath: "/opt/google/chrome/chrome",
    args: ["--no-sandbox", "--use-gl=swiftshader", "--disable-dev-shm-usage"],
  });

  // 1. Drawer with a live AI prose reply (light theme).
  {
    const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    await page.goto("http://localhost:3000/simulation?scenario=shared_world", {
      waitUntil: "domcontentloaded",
    });
    await page.locator("canvas").first().waitFor({ timeout: 30000 });
    await page.getByRole("button", { name: "Open assistant conversation" }).click();
    const drawer = page.getByRole("complementary", { name: "Live assistant" });
    await drawer.getByLabel("Message the assistant").fill("Why is Saltmeadow Phone A disconnected?");
    await drawer.getByRole("button", { name: "Send", exact: true }).click();
    try {
      await drawer.getByText(/Saltmeadow|disconnected/i).nth(1).waitFor({ timeout: 120000 });
      await page.waitForTimeout(15000); // let the stream finish
    } catch {
      console.log("ai reply wait timed out (backend may be slow); screenshotting anyway");
    }
    await page.screenshot({ path: "/tmp/p2-assistant-reply.png" });
    console.log("assistant errors:", errors.length ? errors : "none");
    await page.close();
  }

  // 2. Tablet overview.
  {
    const page = await browser.newPage({ viewport: { width: 1024, height: 768 } });
    await page.goto("http://localhost:3000/", { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(4000);
    await page.screenshot({ path: "/tmp/p2-tablet-overview.png" });
    console.log("tablet ok");
    await page.close();
  }

  // 3. Reduced-motion overview (static render path).
  {
    const page = await browser.newPage({
      viewport: { width: 1600, height: 900 },
      reducedMotion: "reduce",
    });
    await page.goto("http://localhost:3000/", { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(3000);
    await page.screenshot({ path: "/tmp/p2-reduced-overview.png" });
    console.log("reduced ok");
    await page.close();
  }

  // 4. Showcase in light theme.
  {
    const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
    await page.goto("http://localhost:3000/design", { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(2500);
    await page.screenshot({ path: "/tmp/p2-showcase.png" });
    console.log("showcase ok");
    await page.close();
  }
  await browser.close();
})();
