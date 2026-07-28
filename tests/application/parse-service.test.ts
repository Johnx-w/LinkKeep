import { describe, expect, it } from "vitest";

import type { PlatformAdapter } from "@/domain/media";
import { ParseService } from "@/application/parse-service";
import { TransientMediaStore } from "@/application/transient-media-store";

const adapter: PlatformAdapter = {
  platform: "douyin",
  supports: () => true,
  async parse(_url, context) {
    return {
      platform: "douyin",
      postId: "7450000000000000000",
      canonicalUrl: "https://www.douyin.com/video/7450000000000000000",
      sourceAttributionUrl:
        "https://www.douyin.com/video/7450000000000000000",
      title: "公开测试视频",
      parsedAt: context.now.toISOString(),
      media: [
        {
          id: "7450000000000000000-1",
          index: 0,
          kind: "video",
          source: {
            url: "https://www.douyin.com/media/video.mp4",
            mimeType: "video/mp4",
            quality: "platform-distribution",
            cleanSource: null,
          },
        },
      ],
    };
  },
};

describe("解析服务", () => {
  it("解析成功后只向访客返回短期媒体令牌", async () => {
    const mediaStore = new TransientMediaStore(15 * 60 * 1000);
    const service = new ParseService({
      adapters: [adapter],
      mediaStore,
      operations: {
        isPlatformEnabled: () => true,
        isPostBlocked: () => false,
        recordPlatformFailure: () => false,
        recordPlatformSuccess: () => undefined,
      },
    });

    const result = await service.parse(
      "https://www.douyin.com/video/7450000000000000000",
      {
        now: new Date("2026-07-27T12:00:00.000Z"),
        requestId: "req_test",
      },
    );

    expect(result.media[0]).toMatchObject({
      kind: "video",
      token: expect.any(String),
    });
    expect(JSON.stringify(result)).not.toContain("media/video.mp4");
  });

  it("帖子停止解析后不返回媒体", async () => {
    const service = new ParseService({
      adapters: [adapter],
      mediaStore: new TransientMediaStore(),
      operations: {
        isPlatformEnabled: () => true,
        isPostBlocked: () => true,
        recordPlatformFailure: () => false,
        recordPlatformSuccess: () => undefined,
      },
    });

    await expect(
      service.parse(
        "https://www.douyin.com/video/7450000000000000000",
        {
          now: new Date("2026-07-27T12:00:00.000Z"),
          requestId: "req_test",
        },
      ),
    ).rejects.toThrowError("CONTENT_BLOCKED");
  });
});
