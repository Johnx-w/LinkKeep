import { describe, expect, it } from "vitest";

import { TransientMediaStore } from "@/application/transient-media-store";
import { MediaDeliveryService } from "@/delivery/media-delivery-service";

describe("受预算约束的媒体代理", () => {
  it("月度预算耗尽后在访问来源媒体前拒绝代理", async () => {
    const mediaStore = new TransientMediaStore();
    const stored = mediaStore.put({
      platform: "douyin",
      postId: "7450000000000000000",
      item: {
        id: "media-1",
        index: 0,
        kind: "video",
        source: {
          url: "https://www.douyinvod.com/media/video.mp4",
          quality: "platform-distribution",
          cleanSource: null,
        },
      },
    });
    const service = new MediaDeliveryService({
      mediaStore,
      usageStore: {
        proxyUsage: () => ({ bytes: 1024, costCents: 10_000 }),
        addProxyUsage: () => {
          throw new Error("usage should not change");
        },
      },
      monthlyBudgetCents: 10_000,
      costPerGbCents: 80,
    });

    await expect(
      service.proxy(stored.token, new AbortController().signal),
    ).rejects.toThrowError("PROXY_BUDGET_EXHAUSTED");
  });
});
