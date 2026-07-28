import { chromium } from "playwright-core";

const chrome =
  process.env.PLAYWRIGHT_EXECUTABLE_PATH ||
  "C:\\Users\\Johnson\\AppData\\Local\\ms-playwright\\chromium-1228\\chrome-win64\\chrome.exe";

const browser = await chromium.launch({
  executablePath: chrome,
  headless: true,
  args: ["--disable-dev-shm-usage", "--no-first-run"],
});

const hits = [];
try {
  const context = await browser.newContext({
    locale: "zh-CN",
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36",
  });
  const page = await context.newPage();
  page.on("response", async (response) => {
    const type = response.headers()["content-type"] ?? "";
    const url = response.url();
    if (
      type.startsWith("video/") ||
      type.includes("mpegurl") ||
      /\/aweme\/|item\/detail|detail\/|play\/|playwm/iu.test(url)
    ) {
      hits.push({
        status: response.status(),
        type,
        url: url.slice(0, 400),
      });
    }
  });

  await page.goto(
    "https://www.douyin.com/video/7664631087289065189?previous_page=web_code_link",
    { waitUntil: "domcontentloaded", timeout: 30000 },
  );
  await page.waitForTimeout(8000);
  try {
    await page.click("video", { timeout: 3000 });
  } catch {
    // ignore
  }
  await page.waitForTimeout(5000);
  console.log(JSON.stringify(hits.slice(0, 30), null, 2));
  console.log("count", hits.length);
} finally {
  await browser.close();
}
