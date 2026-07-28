import { describe, expect, it } from "vitest";

import { validatePublicPlatformUrl } from "@/security/url-guard";

describe("平台 URL 安全校验", () => {
  it("允许解析到公网地址的小红书官方链接", async () => {
    await expect(
      validatePublicPlatformUrl(
        "https://www.xiaohongshu.com/explore/65aabbccddeeff0011223344",
        async () => ["93.184.216.34"],
      ),
    ).resolves.toMatchObject({ platform: "xiaohongshu" });
  });

  it("拒绝解析到私网地址的官方主机", async () => {
    await expect(
      validatePublicPlatformUrl(
        "https://v.douyin.com/AbCd12/",
        async () => ["127.0.0.1"],
      ),
    ).rejects.toThrowError("UNSAFE_LINK");
  });

  it("拒绝含账号信息或端口的链接", async () => {
    await expect(
      validatePublicPlatformUrl(
        "https://user@www.douyin.com:8443/video/123",
        async () => ["93.184.216.34"],
      ),
    ).rejects.toThrowError("UNSAFE_LINK");
  });
});
