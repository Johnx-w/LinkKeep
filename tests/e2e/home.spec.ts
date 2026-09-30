import { expect, test } from "@playwright/test";

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
      name: "Save public media you have the right to use",
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
