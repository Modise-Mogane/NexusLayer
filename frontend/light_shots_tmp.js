const { chromium } = require("playwright");

const URLS = [
  ["light-overview", "/", 1600, 900],
  ["light-arch", "/architecture", 1600, 900],
  ["light-sim", "/simulation?scenario=shared_world", 1600, 900],
  ["light-physics", "/physics", 1600, 900],
  ["light-hardware", "/hardware", 1600, 900],
];

(async () => {
  const browser = await chromium.launch({
    executablePath: "/opt/google/chrome/chrome",
    args: ["--no-sandbox", "--use-gl=swiftshader", "--disable-dev-shm-usage"],
  });
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  for (const [name, url, w, h] of URLS) {
    await page.setViewportSize({ width: w, height: h });
    await page.goto(`http://localhost:3000${url}`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(4500);
    await page.screenshot({ path: `/tmp/${name}.png` });
    console.log(name, "ok");
  }
  console.log("pageerrors:", errors.length ? errors : "none");
  await browser.close();
})();
