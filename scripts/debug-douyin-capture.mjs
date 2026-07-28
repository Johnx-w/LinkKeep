import { chromium } from "playwright-core";

const exe =
  process.env.PLAYWRIGHT_CHROME_PATH ||
  "C:\\Users\\Johnson\\AppData\\Local\\ms-playwright\\chromium-1228\\chrome-win64\\chrome.exe";

const ids = process.argv.slice(2);
const targets =
  ids.length > 0
    ? ids
    : ["7638487192944582833", "7662346162057301282", "7530000000000000000"];

const withRoute = process.env.WITH_ROUTE !== "0";
const withDnsGate = process.env.WITH_DNS_GATE === "1";

async function captureOne(id) {
  const browser = await chromium.launch({
    executablePath: exe,
    headless: true,
    args: ["--disable-blink-features=AutomationControlled"],
  });
  try {
    const context = await browser.newContext({
      userAgent:
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36",
      serviceWorkers: "block",
    });
    const page = await context.newPage();
    let captured = null;
    let detailStatus = null;

    page.on("response", async (response) => {
      if (!/\/aweme\/v1\/web\/aweme\/detail\//iu.test(response.url())) return;
      detailStatus = response.status();
      if (captured) return;
      try {
        const payload = await response.json();
        if (payload.aweme_detail) {
          captured = {
            type: payload.aweme_detail.aweme_type,
            images: Array.isArray(payload.aweme_detail.images)
              ? payload.aweme_detail.images.length
              : 0,
            desc: String(payload.aweme_detail.desc ?? "").slice(0, 40),
          };
        }
      } catch (error) {
        console.log(JSON.stringify({ id, jsonError: String(error) }));
      }
    });

    if (withRoute) {
      page.route("**/*", async (route) => {
        const requestUrl = new URL(route.request().url());
        if (!["http:", "https:"].includes(requestUrl.protocol)) {
          await route.abort();
          return;
        }
        if (withDnsGate && requestUrl.protocol !== "https:") {
          await route.abort();
          return;
        }
        await route.continue();
      });
    }

    const started = Date.now();
    const url = `https://www.douyin.com/video/${id}`;
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 15_000 });
    try {
      await page.waitForResponse(
        (response) =>
          /\/aweme\/v1\/web\/aweme\/detail\//iu.test(response.url()) &&
          response.ok(),
        { timeout: 10_000 },
      );
      await page.waitForTimeout(400);
    } catch (error) {
      console.log(
        JSON.stringify({
          id,
          waitError: error.message,
        }),
      );
    }

    const html = await page.content();
    const payload = captured ? JSON.stringify(captured) : "";
    console.log(
      JSON.stringify({
        id,
        withRoute,
        withDnsGate,
        finalUrl: page.url(),
        ms: Date.now() - started,
        detailStatus,
        captured,
        htmlBytes: Buffer.byteLength(html, "utf8"),
        payloadBytes: Buffer.byteLength(payload, "utf8"),
      }),
    );
  } finally {
    await browser.close();
  }
}

for (const id of targets) {
  await captureOne(id);
}
