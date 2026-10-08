const { chromium } = require("playwright");
const assert = require("node:assert/strict");
(async () => {
  const browser = await chromium.launch({
    headless: true,
    ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH
      ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH }
      : {}),
    args: ["--no-sandbox"],
  });
  try {
    const context = await browser.newContext({
      viewport: { width: 390, height: 844 },
    });
    const page = await context.newPage();
    const base = process.env.PWA_TEST_URL || "http://localhost:3000";
    await page.goto(base, { waitUntil: "networkidle" });
    const manifest = await (
      await context.request.get(base + "/manifest.webmanifest")
    ).json();
    assert.equal(manifest.display, "standalone");
    assert.equal(manifest.start_url, "/");
    for (const icon of manifest.icons)
      assert.equal((await context.request.get(base + icon.src)).status(), 200);
    assert.ok(await page.locator('link[rel="apple-touch-icon"]').count());
    await page.evaluate(() => navigator.serviceWorker.ready);
    await page.reload({ waitUntil: "networkidle" });
    assert.ok(await page.evaluate(() => !!navigator.serviceWorker.controller));
    const cached = await page.evaluate(async () =>
      (
        await Promise.all(
          (await caches.keys()).map(async (key) =>
            (await (await caches.open(key)).keys()).map(
              (request) => new URL(request.url).pathname,
            ),
          ),
        )
      ).flat(),
    );
    assert.deepEqual(cached, ["/offline.html"]);
    await context.setOffline(true);
    await page.reload({ waitUntil: "domcontentloaded" });
    await page
      .getByRole("heading", { name: "Chưa có kết nối Internet" })
      .waitFor();
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      ),
      false,
    );
    await context.setOffline(false);
    await page.getByRole("link", { name: "Thử lại" }).click();
    await page.waitForLoadState("networkidle");
    assert.equal(
      await page
        .getByRole("heading", { name: "Chưa có kết nối Internet" })
        .count(),
      0,
    );
    console.log(
      "PASS: production manifest/icons, Apple icon, active service worker, only public offline notice cached, offline navigation and reconnection",
    );
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
