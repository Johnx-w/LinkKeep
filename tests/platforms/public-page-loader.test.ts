import { describe, expect, it, vi } from "vitest";

import {
  createPublicPageLoader,
  type PageRequester,
} from "@/platforms/public-page-loader";

describe("公开页面加载器", () => {
  it("抖音短链逐跳校验后直接渲染帖子，不重复请求用不到的 HTML", async () => {
    const requester = vi.fn(async () => ({ status: 302, headers: new Headers({ location: "https://www.douyin.com/video/7450000000000000000" }), body: "" }));
    const browserRenderer = vi.fn(async (url: URL) => ({ finalUrl: url.toString(), html: "captured detail" }));
    const loader = createPublicPageLoader({ requester, browserRenderer, validate: async (url) => ({ url: new URL(url), platform: "douyin", addresses: ["93.184.216.34"] }) });
    const page = await loader(new URL("https://v.douyin.com/AbCd12/"), new AbortController().signal);
    expect(page.html).toBe("captured detail");
    expect(requester).toHaveBeenCalledTimes(1);
    expect(browserRenderer.mock.calls[0][0].pathname).toBe("/video/7450000000000000000");
  });

  it("直接浏览器渲染仍拒绝跨平台跳转和登录页", async () => {
    for (const finalUrl of ["https://www.xiaohongshu.com/explore/test", "https://www.douyin.com/login"]) {
      const loader = createPublicPageLoader({ browserRenderer: async () => ({ finalUrl, html: "restricted" }), validate: async (url) => { const parsed = new URL(url); return { url: parsed, platform: parsed.hostname === "www.douyin.com" ? "douyin" : "xiaohongshu", addresses: ["93.184.216.34"] }; } });
      await expect(loader(new URL("https://www.douyin.com/video/7450000000000000000"), new AbortController().signal)).rejects.toThrow(finalUrl.includes("xiaohongshu") ? "UNSAFE_LINK" : "CONTENT_RESTRICTED");
    }
  });
  it("官方登录页跳转明确返回受限错误，不把它当成帖子不存在", async () => {
    const loader = createPublicPageLoader({
      requester: async (url) => url.pathname === "/login"
        ? { status: 200, headers: new Headers({ "content-type": "text/html" }), body: '<script>window.__INITIAL_STATE__={}</script>' }
        : { status: 302, headers: new Headers({ location: "/login" }), body: "" },
      validate: async (url) => ({ url: new URL(url), platform: "xiaohongshu", addresses: ["93.184.216.34"] }),
    });
    await expect(loader(new URL("https://www.xiaohongshu.com/explore/test"), new AbortController().signal)).rejects.toThrow("CONTENT_RESTRICTED");
  });
  it("逐跳校验官方短链并返回最终公开页面", async () => {
    const requester: PageRequester = async (url) => {
      if (url.hostname === "v.douyin.com") {
        return {
          status: 302,
          headers: new Headers({
            location: "https://www.douyin.com/video/7450000000000000000",
          }),
          body: "",
        };
      }
      return {
        status: 200,
        headers: new Headers({ "content-type": "text/html; charset=utf-8" }),
        body: '<meta property="og:video" content="https://www.douyin.com/media/video.mp4">',
      };
    };

    const loader = createPublicPageLoader({
      requester,
      validate: async (url) => ({
        url: new URL(url),
        platform: "douyin",
        addresses: ["93.184.216.34"],
      }),
    });

    await expect(
      loader(
        new URL("https://v.douyin.com/AbCd12/"),
        new AbortController().signal,
      ),
    ).resolves.toMatchObject({
      finalUrl: "https://www.douyin.com/video/7450000000000000000",
    });
  });

  it("拒绝跳转到非官方主机", async () => {
    const loader = createPublicPageLoader({
      requester: async () => ({
        status: 302,
        headers: new Headers({ location: "https://evil.example/payload" }),
        body: "",
      }),
      validate: async (url) => {
        const parsed = new URL(url);
        if (parsed.hostname === "evil.example") {
          throw new Error("UNSUPPORTED_LINK");
        }
        return {
          url: parsed,
          platform: "douyin",
          addresses: ["93.184.216.34"],
        };
      },
    });

    await expect(
      loader(
        new URL("https://v.douyin.com/AbCd12/"),
        new AbortController().signal,
      ),
    ).rejects.toThrowError("UNSUPPORTED_LINK");
  });

  it("仅在普通页面缺少公开元数据时使用标准浏览器兜底", async () => {
    const loader = createPublicPageLoader({
      requester: async () => ({
        status: 200,
        headers: new Headers({ "content-type": "text/html" }),
        body: "<html><body><div id='app'></div></body></html>",
      }),
      browserRenderer: async () => ({
        finalUrl: "https://www.douyin.com/video/7450000000000000000",
        html: '<meta property="og:video" content="https://www.douyin.com/media/video.mp4">',
      }),
      validate: async (url) => ({
        url: new URL(url),
        platform: "douyin",
        addresses: ["93.184.216.34"],
      }),
    });

    const page = await loader(
      new URL("https://www.douyin.com/video/7450000000000000000"),
      new AbortController().signal,
    );

    expect(page.html).toContain("og:video");
  });
});
