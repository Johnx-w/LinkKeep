import { describe, expect, it } from "vitest";

import { mediaFilename } from "@/domain/filename";

describe("可读安全文件名", () => {
  it("清除路径字符并保留帖子编号和序号", () => {
    expect(
      mediaFilename({
        platform: "xiaohongshu",
        author: "../测试/作者",
        title: '夏日:*?"记录',
        postId: "65aabbccddeeff0011223344",
        index: 0,
        extension: "webp",
      }),
    ).toBe("测试-作者-夏日-记录-65aabbccddeeff0011223344-01.webp");
  });

  it("元数据缺失时退回平台名称", () => {
    expect(
      mediaFilename({
        platform: "douyin",
        postId: "7450000000000000000",
        index: 1,
        extension: "mp4",
      }),
    ).toBe("douyin-7450000000000000000-02.mp4");
  });
});
