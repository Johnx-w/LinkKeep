import { chromium } from "playwright-core";
import { writeFile, mkdir } from "node:fs/promises";

const chrome =
  process.env.PLAYWRIGHT_EXECUTABLE_PATH ||
  "C:\\Users\\Johnson\\AppData\\Local\\ms-playwright\\chromium-1228\\chrome-win64\\chrome.exe";

const url =
  "https://www.douyin.com/video/7664631087289065189?previous_page=web_code_link";

const browser = await chromium.launch({
  executablePath: chrome,
  headless: true,
  args: ["--disable-dev-shm-usage", "--no-first-run"],
});

const mediaUrls = [];
try {
  const context = await browser.newContext({
    locale: "zh-CN",
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36",
  });
  const page = await context.newPage();
  page.on("response", async (response) => {
    const responseUrl = response.url();
    if (
      /douyinvod|playwm|play\/|aweme\/v1|web\/api/iu.test(responseUrl) ||
      /video\/tos|obj\/|mime_type=video/iu.test(responseUrl)
    ) {
      mediaUrls.push({
        url: responseUrl.slice(0, 300),
        status: response.status(),
        type: response.headers()["content-type"],
      });
    }
  });
  await page.goto(url, { waitUntil: "networkidle", timeout: 30000 }).catch(() => undefined);
  await page.waitForTimeout(5000);
  const html = await page.content();
  await mkdir("artifacts/validation", { recursive: true });
  await writeFile("artifacts/validation/douyin-browser.html", html);
  const markers = {
    RENDER_DATA: html.includes("RENDER_DATA"),
    INITIAL: /__INITIAL|SSR_HYDRATED_DATA|_ROUTER_DATA|__NEXT_DATA__/iu.test(html),
    videoTag: /<video[\s>]/iu.test(html),
    srcMp4: /https:\/\/[^"'\s]+\.mp4/iu.test(html),
    vod: /douyinvod\.com/iu.test(html),
  };
  console.log(JSON.stringify({ markers, mediaUrls: mediaUrls.slice(0, 20), count: mediaUrls.length }, null, 2));
} finally {
  await browser.close();
}
