import { describe, expect, it } from "vitest";

import { validatePublicPlatformUrl, validatePublicMediaUrl } from "@/security/url-guard";

describe("平台 URL 安全校验", () => {
  it("允许抖音公开详情实际返回的新 CDN 别名", async () => {
    await expect(validatePublicMediaUrl("https://v5-dy-ov-experiment.zjcdn.com/video.mp4", "douyin", async () => ["93.184.216.34"])).resolves.toMatchObject({ addresses: ["93.184.216.34"] });
  });

  it("新 CDN 别名仍校验平台、完整主机名和公网 DNS", async () => {
    for (const host of ["v5-dy-ov-experiment.zjcdn.com.evil.example", "other.zjcdn.com"]) {
      await expect(validatePublicMediaUrl(`https://${host}/video.mp4`, "douyin", async () => ["93.184.216.34"])).rejects.toThrow("UNSAFE_MEDIA");
    }
    await expect(validatePublicMediaUrl("https://v5-dy-ov-experiment.zjcdn.com/video.mp4", "xiaohongshu", async () => ["93.184.216.34"])).rejects.toThrow("UNSAFE_MEDIA");
    await expect(validatePublicMediaUrl("https://v5-dy-ov-experiment.zjcdn.com/video.mp4", "douyin", async () => ["127.0.0.1"])).rejects.toThrow("UNSAFE_LINK");
  });
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
