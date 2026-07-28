import { chromium } from "playwright-core";

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

try {
  const context = await browser.newContext({
    locale: "zh-CN",
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36",
  });
  const page = await context.newPage();
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 20000 });
  await page.waitForTimeout(3000);
  const html = await page.content();
  const title = await page.title();
  console.log(
    JSON.stringify(
      {
        title,
        url: page.url(),
        len: html.length,
        ogVideo: /og:video/i.test(html),
        ogImage: /og:image/i.test(html),
        playAddr: /play_addr|playAddr|aweme_detail/i.test(html),
        snippet: html.replace(/\s+/g, " ").slice(0, 600),
      },
      null,
      2,
    ),
  );
} finally {
  await browser.close();
}
