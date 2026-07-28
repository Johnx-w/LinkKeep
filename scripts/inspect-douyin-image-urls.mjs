import { chromium } from "playwright-core";

const exe =
  process.env.PLAYWRIGHT_EXECUTABLE_PATH ||
  "C:\\Users\\Johnson\\AppData\\Local\\ms-playwright\\chromium-1228\\chrome-win64\\chrome.exe";
const id = process.argv[2] ?? "7638487192944582833";

const browser = await chromium.launch({ executablePath: exe, headless: true });
const page = await browser.newPage();
const detailPromise = page.waitForResponse(
  (response) =>
    /\/aweme\/v1\/web\/aweme\/detail\//iu.test(response.url()) &&
    response.ok(),
  { timeout: 15_000 },
);
await page.goto(`https://www.douyin.com/video/${id}`, {
  waitUntil: "domcontentloaded",
  timeout: 20_000,
});
const detail = await detailPromise;
const aweme = (await detail.json()).aweme_detail;
const image = aweme.images?.[0];
console.log(
  JSON.stringify(
    {
      type: aweme.aweme_type,
      wh: image ? `${image.width}x${image.height}` : null,
      download: image?.download_url_list ?? [],
      urls: image?.url_list ?? [],
    },
    null,
    2,
  ),
);
await browser.close();
