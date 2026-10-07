import { describe, expect, it } from "vitest";
import { TransientMediaStore } from "@/application/transient-media-store";

describe("临时结果容量和到期", () => {
  it("未过期结果达到上限时拒绝新增，到期后可释放容量", () => {
    const store = new TransientMediaStore(1000, 1);
    const now = new Date("2026-09-30T00:00:00Z");
    const media = { platform: "douyin" as const, postId: "123", item: { id: "1", index: 0, kind: "image" as const, source: { url: "https://www.douyinpic.com/test.jpg", quality: "platform-distribution" as const, cleanSource: null } } };
    const first = store.put(media, now);
    expect(() => store.put(media, now)).toThrow("SERVICE_BUSY");
    expect(store.get(first.token, new Date(now.getTime()+1000))).toBeNull();
    expect(() => store.put(media, new Date(now.getTime()+1000))).not.toThrow();
  });
});
