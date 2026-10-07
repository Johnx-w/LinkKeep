import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  launch: vi.fn(),
  waitForResponse: vi.fn(),
  goto: vi.fn(),
  close: vi.fn(),
  content: vi.fn(),
}));
vi.mock("playwright-core", () => ({ chromium: { launch: mocks.launch } }));
vi.mock("@/security/url-guard", () => ({
  validatePublicPlatformUrl: async (url: URL | string) => ({ url: new URL(url), platform: "douyin", addresses: ["93.184.216.34"] }),
  validatePublicNetworkUrl: vi.fn(),
}));

import { standardBrowserRenderer } from "@/platforms/public-page-loader";

describe("抖音有效详情等待", () => {
  it("忽略 200 空响应和其他帖子，收到请求帖子的有效详情后才结束", async () => {
    process.env.PLAYWRIGHT_EXECUTABLE_PATH = "/test/chromium";
    const accepted: boolean[] = [];
    type Response = { url(): string; ok(): boolean; json(): Promise<unknown> };
    let predicate: (response: Response) => Promise<boolean>;
    let resolveDetail: (response: Response) => void;
    mocks.waitForResponse.mockImplementation((callback) => {
      predicate = callback;
      return new Promise<Response>((resolve) => { resolveDetail = resolve; });
    });
    mocks.goto.mockImplementation(async () => {
      for (const id of [undefined, "999", "123"]) {
        const response = {
          url: () => "https://www.douyin.com/aweme/v1/web/aweme/detail/",
          ok: () => true,
          json: async () => {
            if (!id) throw new SyntaxError("Empty response");
            return { aweme_detail: { aweme_id: id, video: { width: 1440, height: 2560 } } };
          },
        };
        const matches = await predicate(response);
        accepted.push(matches);
        if (matches) resolveDetail(response);
      }
    });
    const page = { setDefaultNavigationTimeout: vi.fn(), waitForResponse: mocks.waitForResponse, goto: mocks.goto, url: () => "https://www.douyin.com/video/123", content: mocks.content };
    const context = { routeWebSocket: vi.fn(), newPage: async () => page, route: vi.fn() };
    mocks.launch.mockResolvedValue({ newContext: async () => context, close: mocks.close });
    const result = await standardBrowserRenderer(new URL("https://www.douyin.com/video/123"), new AbortController().signal);
    expect(accepted).toEqual([false, false, true]);
    expect(result.html).toContain('"aweme_id":"123"');
    expect(result.html).not.toContain('"aweme_id":"999"');
    expect(mocks.content).not.toHaveBeenCalled();
    expect(mocks.close).toHaveBeenCalledOnce();
    delete process.env.PLAYWRIGHT_EXECUTABLE_PATH;
  });
});
