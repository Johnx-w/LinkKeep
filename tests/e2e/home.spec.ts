import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";
import JSZip from "jszip";

test("访客可以解析并选择公开媒体", async ({ page }) => {
  await page.route("**/api/parse", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        requestId: "req_e2e",
        result: {
          platform: "xiaohongshu",
          postId: "65aabbccddeeff0011223344",
          title: "授权测试图集",
          author: "测试作者",
          sourceAttributionUrl:
            "https://www.xiaohongshu.com/explore/65aabbccddeeff0011223344",
          parsedAt: "2026-07-27T00:00:00.000Z",
          media: [
            {
              id: "media-1",
              index: 0,
              kind: "image",
              token: "a".repeat(43),
              expiresAt: "2026-07-27T00:30:00.000Z",
              mimeType: "image/webp",
              quality: "platform-distribution",
              cleanSource: null,
            },
            {
              id: "media-2",
              index: 1,
              kind: "image",
              token: "b".repeat(43),
              expiresAt: "2026-07-27T00:30:00.000Z",
              mimeType: "image/webp",
              quality: "platform-distribution",
              cleanSource: null,
            },
          ],
        },
      }),
    });
  });

  await page.goto("/zh");
  await page
    .getByLabel("分享链接或分享文本")
    .fill(
      "https://www.xiaohongshu.com/explore/65aabbccddeeff0011223344",
    );
  await page.getByRole("button", { name: "开始解析" }).click();

  await expect(page.getByRole("heading", { name: "授权测试图集" })).toBeVisible();
  await expect(page.getByRole("button", { name: "下载所选 (2)" })).toBeVisible();
  await expect(page.getByText("平台分发版")).toHaveCount(2);
});

test("手机宽度核心流程没有横向溢出", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 800 });
  await page.goto("/en");

  await expect(
    page.getByRole("heading", {
      name: "Parse & download watermark-free videos/images from multiple platforms",
    }),
  ).toBeVisible();
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > window.innerWidth,
  );
  expect(overflow).toBe(false);
});

test("页脚提供条款、隐私和版权投诉入口", async ({ page }) => {
  await page.goto("/zh");
  await expect(page.getByRole("link", { name: "服务条款" })).toHaveAttribute(
    "href",
    "/zh/terms",
  );
  await expect(page.getByRole("link", { name: "隐私政策" })).toHaveAttribute(
    "href",
    "/zh/privacy",
  );
  await expect(page.getByRole("link", { name: "版权投诉" })).toHaveAttribute(
    "href",
    "/zh/copyright",
  );
});

for (const actual of [
  { mime: "image/png", extension: "png", data: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aS3sAAAAASUVORK5CYII=", "base64") },
  { mime: "image/heic", extension: "heic", data: Buffer.from("000000186674797068656963000000006d69663168656963", "hex") },
]) {
test(`所选图片生成可打开的 ZIP，按实际 ${actual.extension} 类型命名并保留原始字节`, async ({ page }) => {
  test.setTimeout(60_000);
  await page.route("**/api/parse", (route) => route.fulfill({ json: { requestId: "req_zip", result: {
    platform: "douyin", postId: "123456", title: "ZIP 测试", sourceAttributionUrl: "https://www.douyin.com/video/123456", parsedAt: new Date().toISOString(),
    media: [0,1].map((index) => ({ id: String(index), index, kind: "image", token: (index ? "b" : "a").repeat(43), expiresAt: new Date(Date.now()+900000).toISOString(), mimeType: "image/jpeg", quality: "platform-distribution", cleanSource: null })),
  } } }));
  await page.route("**/api/media/**", (route) => route.fulfill({ status: 200, contentType: actual.mime, body: actual.data }));
  await page.goto("/zh");
  await page.getByLabel("分享链接或分享文本").fill("https://www.douyin.com/video/123456");
  await page.getByRole("button", { name: "开始解析" }).click();
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "下载所选 (2)" }).click();
  const completed = await download;
  expect(completed.suggestedFilename()).toBe("douyin-123456.zip");
  const filename = await completed.path();
  const archive = await JSZip.loadAsync(await readFile(filename!));
  const entries = Object.values(archive.files).filter((entry) => !entry.dir);
  expect(entries).toHaveLength(2);
  for (const entry of entries) {
    expect(entry.name.endsWith(`.${actual.extension}`)).toBe(true);
    expect(await entry.async("nodebuffer")).toEqual(actual.data);
  }
});
}
