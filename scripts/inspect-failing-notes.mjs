import { chromium } from "playwright-core";
import { writeFile } from "node:fs/promises";

const chrome =
  process.env.PLAYWRIGHT_EXECUTABLE_PATH ||
  "C:\\Users\\Johnson\\AppData\\Local\\ms-playwright\\chromium-1228\\chrome-win64\\chrome.exe";

const ids = ["7638487192944582833", "7662346162057301282"];

const browser = await chromium.launch({
  executablePath: chrome,
  headless: true,
  args: ["--disable-dev-shm-usage", "--no-first-run"],
});

try {
  for (const id of ids) {
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
    await page.goto(`https://www.douyin.com/video/${id}`, {
      waitUntil: "domcontentloaded",
      timeout: 30000,
    });
    await page.waitForTimeout(10000);
    const aweme = detail?.aweme_detail;
    await writeFile(
      `artifacts/validation/failing-note-${id}.json`,
      JSON.stringify(
        {
          has: Boolean(aweme),
          type: aweme?.aweme_type,
          images: aweme?.images?.length,
          image0: aweme?.images?.[0],
          videoPlay: aweme?.video?.play_addr?.url_list?.slice?.(0, 1),
          desc: aweme?.desc,
        },
        null,
        2,
      ),
    );
    console.log(
      JSON.stringify({
        id,
        has: Boolean(aweme),
        type: aweme?.aweme_type,
        images: aweme?.images?.length,
        hasPlay: Boolean(aweme?.video?.play_addr?.url_list?.length),
      }),
    );
    await context.close();
  }
} finally {
  await browser.close();
}
