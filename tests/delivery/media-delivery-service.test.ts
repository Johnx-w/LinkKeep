import { afterEach, describe, expect, it } from "vitest";
import { TransientMediaStore } from "@/application/transient-media-store";
import { MediaDeliveryService } from "@/delivery/media-delivery-service";
import { LinkKeepStore } from "@/storage/store";
import type { PinnedStreamResponse } from "@/security/pinned-request";

const stores: LinkKeepStore[] = [];
afterEach(() => { for (const store of stores.splice(0)) store.close(); });
const jpeg = Buffer.alloc(8192);
Buffer.from([0xff,0xd8,0xff,0xe0,0,0x10,0x4a,0x46,0x49,0x46,0,1,0xff,0xd9]).copy(jpeg);
function setup(chunks: Uint8Array[] = [jpeg], budget = 10000, mime = "image/jpeg") {
  const mediaStore = new TransientMediaStore();
  const stored = mediaStore.put({ platform: "douyin", postId: "123456", item: {
    id: "media-1", index: 0, kind: "image",
    source: { url: "https://www.douyinpic.com/test.jpg", quality: "platform-distribution", cleanSource: null },
  } });
  const store = new LinkKeepStore(":memory:"); stores.push(store);
  let consumed = 0; let destroyed = false;
  const service = new MediaDeliveryService({
    mediaStore, usageStore: store, monthlyBudgetCents: budget, costPerGbCents: 80,
    validateUrl: async (url) => ({ url: new URL(url), addresses: ["93.184.216.34"] }),
    openStream: async () => ({
      status: 200, headers: new Headers({ "content-type": mime }),
      body: {
        async *[Symbol.asyncIterator]() { for (const chunk of chunks) { consumed += chunk.byteLength; yield chunk; } },
        destroy() { destroyed = true; },
      }, async close() { destroyed = true; },
    } satisfies PinnedStreamResponse),
  });
  return { service, token: stored.token, store, consumed: () => consumed, destroyed: () => destroyed };
}
describe("媒体传输硬边界", () => {
  it("预算耗尽后在访问来源媒体前拒绝预览和下载", async () => {
    const fixture = setup();
    fixture.store.addProxyUsage(new Date().toISOString().slice(0,7), 1024, 10000);
    await expect(fixture.service.proxy(fixture.token, new AbortController().signal)).rejects.toThrow("PROXY_BUDGET_EXHAUSTED");
    await expect(fixture.service.preview(fixture.token, new AbortController().signal)).rejects.toThrow("PROXY_BUDGET_EXHAUSTED");
    expect(fixture.consumed()).toBe(0);
  });
  it("预览也结算流量，并在结束时释放预留额度", async () => {
    const fixture = setup();
    const result = await fixture.service.preview(fixture.token, new AbortController().signal);
    expect((await new Response(result.body).arrayBuffer()).byteLength).toBe(jpeg.length);
    expect(fixture.store.proxyUsage(new Date().toISOString().slice(0,7))).toEqual({ bytes: jpeg.length, costCents: 1 });
    expect(fixture.destroyed()).toBe(true);
  });
  it("慢客户端不会驱动源文件无限读取，取消后立即释放连接", async () => {
    const fixture = setup([jpeg, Buffer.alloc(100_000)]);
    const result = await fixture.service.proxy(fixture.token, new AbortController().signal);
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(fixture.consumed()).toBe(jpeg.length);
    await result.body.cancel();
    expect(fixture.destroyed()).toBe(true);
    expect(fixture.store.proxyUsage(new Date().toISOString().slice(0,7)).costCents).toBe(1);
  });
  it("无 Content-Length 的流也不能越过剩余预算", async () => {
    const fixture = setup([jpeg, Buffer.alloc(14 * 1024 ** 2)], 1);
    const result = await fixture.service.proxy(fixture.token, new AbortController().signal);
    await expect(new Response(result.body).arrayBuffer()).rejects.toThrow("PROXY_BUDGET_EXHAUSTED");
    expect(fixture.store.proxyUsage(new Date().toISOString().slice(0,7)).costCents).toBe(1);
    expect(fixture.destroyed()).toBe(true);
  });
  it("媒体伪装被拒绝且失败传输也计量", async () => {
    const fixture = setup([new TextEncoder().encode("<html>not an image</html>")]);
    await expect(fixture.service.proxy(fixture.token, new AbortController().signal)).rejects.toThrow("UNSAFE_MEDIA");
    expect(fixture.store.proxyUsage(new Date().toISOString().slice(0,7)).costCents).toBe(1);
    expect(fixture.destroyed()).toBe(true);
  });
});
