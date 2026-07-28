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
  let detail = null;
  page.on("response", async (response) => {
    if (!response.url().includes("/aweme/v1/web/aweme/detail/")) return;
    try {
      detail = await response.json();
    } catch {
      // ignore
    }
  });

  // Force video route for note IDs.
  await page.goto(
    "https://www.douyin.com/video/7638487192944582833?previous_page=web_code_link",
    { waitUntil: "domcontentloaded", timeout: 30000 },
  );
  await page.waitForTimeout(8000);
  await writeFile(
    "artifacts/validation/note-as-video-detail.json",
    JSON.stringify(detail, null, 2),
  );
  const aweme = detail?.aweme_detail;
  console.log(
    JSON.stringify(
      {
        has: Boolean(aweme),
        awemeType: aweme?.aweme_type,
        images: aweme?.images?.length,
        desc: aweme?.desc?.slice?.(0, 80),
        firstImage: aweme?.images?.[0]?.url_list?.slice?.(0, 1),
        video: Boolean(aweme?.video?.play_addr),
      },
      null,
      2,
    ),
  );
} finally {
  await browser.close();
}
