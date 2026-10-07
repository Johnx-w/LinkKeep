import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";

const mocked = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock("undici", () => ({
  request: mocked.request,
  Agent: class {
    constructor(public options: { connect: { lookup: (host: string, options: { all?: boolean }, callback: (error: null, address: string, family: number) => void) => void } }) {}
    async destroy() {}
  },
}));
import { pinnedRequest } from "@/security/pinned-request";

class TestBody extends EventEmitter {
  destroyed = false;
  constructor(private readonly chunks: Uint8Array[] = []) { super(); }
  destroy() {
    this.destroyed = true;
    queueMicrotask(() => this.emit("error", Object.assign(new Error("discarded"), { code: "UND_ERR_ABORTED" })));
  }
  async *[Symbol.asyncIterator]() { for (const chunk of this.chunks) yield chunk; }
}
const options = { url: new URL("https://www.douyin.com/start"), addresses: ["93.184.216.34"], signal: new AbortController().signal, maximumBytes: 10 };

describe("固定 DNS 请求体处置", () => {
  it("临时连接失败只重试一次，并切换到另一已核验地址，不重新解析 DNS", async () => {
    const contacted: string[] = [];
    mocked.request.mockImplementationOnce(async (_url, { dispatcher }) => {
      dispatcher.options.connect.lookup("www.douyin.com", {}, (_error: null, address: string) => contacted.push(address));
      throw Object.assign(new Error("edge timeout"), { code: "UND_ERR_CONNECT_TIMEOUT" });
    }).mockImplementationOnce(async (_url, { dispatcher }) => {
      dispatcher.options.connect.lookup("www.douyin.com", {}, (_error: null, address: string) => contacted.push(address));
      return { statusCode: 200, headers: {}, body: new TestBody([new Uint8Array([1, 2, 3])]) };
    });
    const response = await pinnedRequest({ ...options, addresses: ["93.184.216.34", "93.184.216.35"] });
    expect(contacted).toEqual(["93.184.216.34", "93.184.216.35"]);
    expect([...response.body]).toEqual([1, 2, 3]);
  });
  it("主动丢弃重定向响应不会触发未处理的流错误", async () => {
    const body = new TestBody();
    mocked.request.mockResolvedValueOnce({ statusCode: 302, headers: { location: "/video/123" }, body });
    const response = await pinnedRequest(options);
    expect(response.status).toBe(302);
    expect(body.destroyed).toBe(true);
    expect(body.listenerCount("error")).toBe(1);
  });
  it("超出声明大小仍拒绝，并避免主动销毁导致进程崩溃", async () => {
    const body = new TestBody();
    mocked.request.mockResolvedValueOnce({ statusCode: 200, headers: { "content-length": "100" }, body });
    await expect(pinnedRequest(options)).rejects.toThrow("MEDIA_TOO_LARGE");
    expect(body.destroyed).toBe(true);
  });
  it("按实际读取字节回调，流超过上限时已读取的字节也计量", async () => {
    const onBytes = vi.fn();
    const body = new TestBody([new Uint8Array(6), new Uint8Array(6)]);
    mocked.request.mockResolvedValueOnce({ statusCode: 200, headers: {}, body });
    await expect(pinnedRequest({ ...options, onBytes })).rejects.toThrow("MEDIA_TOO_LARGE");
    expect(onBytes.mock.calls.map(([bytes]) => bytes)).toEqual([6, 6]);
  });
});
