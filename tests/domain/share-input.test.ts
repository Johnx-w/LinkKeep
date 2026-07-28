import { describe, expect, it } from "vitest";

import { parseShareInput } from "@/domain/share-input";

describe("分享输入解析器", () => {
  it("从抖音分享文本提取唯一官方短链", () => {
    expect(
      parseShareInput("复制打开抖音，看看作品 https://v.douyin.com/AbCd12/ 更多内容"),
    ).toEqual({
      platform: "douyin",
      url: "https://v.douyin.com/AbCd12/",
    });
  });

  it("接受小红书官方帖子链接", () => {
    expect(
      parseShareInput("https://www.xiaohongshu.com/explore/65aabbccddeeff0011223344"),
    ).toEqual({
      platform: "xiaohongshu",
      url: "https://www.xiaohongshu.com/explore/65aabbccddeeff0011223344",
    });
  });

  it("拒绝一次输入多个链接", () => {
    expect(() =>
      parseShareInput(
        "https://v.douyin.com/AbCd12/ https://www.xiaohongshu.com/explore/65aabbccddeeff0011223344",
      ),
    ).toThrowError("MULTIPLE_LINKS");
  });

  it("拒绝混淆官方域名", () => {
    expect(() =>
      parseShareInput("https://www.douyin.com.evil.example/video/123"),
    ).toThrowError("UNSUPPORTED_LINK");
  });
});
