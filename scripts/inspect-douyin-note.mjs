import { chromium } from "playwright-core";
import { writeFile } from "node:fs/promises";

const chrome =
  process.env.PLAYWRIGHT_EXECUTABLE_PATH ||
  "C:\\Users\\Johnson\\AppData\\Local\\ms-playwright\\chromium-1228\\chrome-win64\\chrome.exe";

const browser = await chromium.launch({
  executablePath: chrome,
  headless: true,
  args: ["--disable-dev-shm-usage", "--no-first-run"],
});

try {
  const context = await browser.newContext({
    locale: "zh-CN",
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36",
  });
  const page = await context.newPage();
  const apis = [];
  page.on("response", async (response) => {
    const url = response.url();
    if (!/aweme|note|detail|item/iu.test(url)) return;
    if (!url.includes("douyin.com")) return;
    let preview = null;
    try {
      if ((response.headers()["content-type"] ?? "").includes("json")) {
        const json = await response.json();
        preview = JSON.stringify(json).slice(0, 500);
        if (json.aweme_detail || json.aweme_list || json.notes || json.data) {
          await writeFile(
            `artifacts/validation/note-api-${apis.length}.json`,
            JSON.stringify(json, null, 2).slice(0, 100_000),
          );
        }
      }
    } catch {
      // ignore
    }
    apis.push({ status: response.status(), url: url.slice(0, 250), preview });
  });

  await page.goto(
    "https://www.douyin.com/note/7638487192944582833?previous_page=web_code_link",
    { waitUntil: "domcontentloaded", timeout: 30000 },
  );
  await page.waitForTimeout(10000);
  console.log(JSON.stringify(apis.slice(0, 40), null, 2));
} finally {
  await browser.close();
}
