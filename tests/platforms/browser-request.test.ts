import { describe, expect, it } from "vitest";
import { fetchBrowserResource, createBrowserRequestDependencies } from "@/platforms/browser-request";
import { validatePublicNetworkUrl, validatePublicPlatformUrl } from "@/security/url-guard";
import { DomainError } from "@/domain/errors";

describe("浏览器固定 DNS 出口", () => {
  const signal = new AbortController().signal;
  it("同一渲染的并发资源共用已核验 DNS 地址，保留各自路径并继续拒绝私网和不安全协议", async () => {
    let lookups = 0;
    const guards = createBrowserRequestDependencies({ url: new URL("https://www.douyin.com/video/123"), platform: "douyin", addresses: ["93.184.216.34"] }, async (host) => {
      lookups++;
      return host === "private.test" ? ["127.0.0.1"] : ["93.184.216.35"];
    });
    const resources = await Promise.all(["a.js", "b.js", "c.js"].map((path) => guards.validateNetwork(new URL(`https://cdn.test/${path}`))));
    expect(lookups).toBe(1);
    expect(resources.map((resource) => resource.url.pathname)).toEqual(["/a.js", "/b.js", "/c.js"]);
    expect(resources.every((resource) => resource.addresses[0] === "93.184.216.35")).toBe(true);
    await expect(guards.validateNetwork(new URL("http://cdn.test/a.js"))).rejects.toThrow("UNSAFE_LINK");
    await expect(guards.validateNetwork(new URL("https://private.test/a.js"))).rejects.toThrow("UNSAFE_LINK");
  });
  it("保留匿名浏览器详情所需的头字段，站外重定向不携带抖音标识或认证头", async () => {
    const sent: Array<Record<string, string> | undefined> = [];
    await fetchBrowserResource(new URL("https://www.douyin.com/detail"), signal, 1024, false, "douyin", {
      validateNetwork: (url) => validatePublicNetworkUrl(url, async () => ["93.184.216.34"]),
      validatePlatform: validatePublicPlatformUrl,
      request: async ({ url, headers }) => {
        sent.push(headers);
        return url.hostname === "www.douyin.com"
          ? { status: 302, headers: new Headers({ location: "https://cdn.test/final" }), body: new Uint8Array() }
          : { status: 200, headers: new Headers(), body: new Uint8Array() };
      },
    }, { headers: { uifid: "anonymous-id", "sec-ch-ua-platform": '"Linux"', authorization: "private" }, cookiesFor: async () => "", storeCookies: async () => undefined });
    expect(sent[0]).toMatchObject({ uifid: "anonymous-id", "sec-ch-ua-platform": '"Linux"' });
    expect(sent[1]?.uifid).toBeUndefined();
    expect(sent.every((headers) => headers?.authorization === undefined)).toBe(true);
  });
  it("把已核验地址交给实际请求，后续 DNS 变化不能改变连接目标", async () => {
    let address = "93.184.216.34";
    const result = await fetchBrowserResource(new URL("https://www.douyin.com/video/123"), signal, 1024, true, "douyin", {
      validateNetwork: (url) => validatePublicNetworkUrl(url, async () => [address]),
      validatePlatform: (url) => validatePublicPlatformUrl(url, async () => [address]),
      request: async (options) => {
        address = "127.0.0.1";
        if (options.addresses[0] !== "93.184.216.34") throw new Error("connection was not pinned");
        return { status: 200, headers: new Headers(), body: new TextEncoder().encode("safe") };
      },
    });
    expect(result.body.toString()).toBe("safe");
  });
  it("DNS 验证失败时绝不发出请求", async () => {
    let contacted = false;
    await expect(fetchBrowserResource(new URL("https://cdn.test/script.js"), signal, 1024, false, "douyin", {
      validateNetwork: async () => { throw new DomainError("PARSE_FAILED"); },
      validatePlatform: validatePublicPlatformUrl,
      request: async () => { contacted = true; throw new Error("unexpected request"); },
    })).rejects.toThrow("PARSE_FAILED");
    expect(contacted).toBe(false);
  });
  it("返回重定向之前拒绝私网目标", async () => {
    await expect(fetchBrowserResource(new URL("https://cdn.test/start"), signal, 1024, false, "douyin", {
      validateNetwork: (url) => validatePublicNetworkUrl(url, async (host) => host === "private.test" ? ["127.0.0.1"] : ["93.184.216.34"]),
      validatePlatform: validatePublicPlatformUrl,
      request: async () => ({ status: 302, headers: new Headers({ location: "https://private.test/" }), body: new Uint8Array() }),
    })).rejects.toThrow("UNSAFE_LINK");
  });
  it("逐跳保留匿名会话，并按目标 URL 获取 Cookie，禁止把前一站 Cookie 复制到另一站", async () => {
    const sent: Array<{ host: string; cookie?: string; referer?: string }> = [];
    const session = new Map<string, string>();
    const result = await fetchBrowserResource(new URL("https://www.douyin.com/start"), signal, 1024, false, "douyin", {
      validateNetwork: (url) => validatePublicNetworkUrl(url, async () => ["93.184.216.34"]),
      validatePlatform: validatePublicPlatformUrl,
      request: async ({ url, headers }) => {
        sent.push({ host: url.hostname, cookie: headers?.cookie, referer: headers?.referer });
        return url.pathname === "/start"
          ? { status: 302, headers: new Headers({ location: "https://cdn.douyin.com/final", "set-cookie": "anon=one" }), body: new Uint8Array() }
          : { status: 200, headers: new Headers(), body: new TextEncoder().encode("safe") };
      },
    }, {
      headers: { referer: "https://www.douyin.com/video/123", authorization: "must-not-forward" },
      cookiesFor: async (url) => session.get(url.hostname) ?? "",
      storeCookies: async (url, headers) => { if (headers.get("set-cookie")) session.set(url.hostname, "anon=one"); },
    });
    expect(result.body.toString()).toBe("safe");
    expect(sent).toEqual([
      { host: "www.douyin.com", cookie: undefined, referer: "https://www.douyin.com/video/123" },
      { host: "cdn.douyin.com", cookie: undefined, referer: "https://www.douyin.com/video/123" },
    ]);
    expect(session.get("www.douyin.com")).toBe("anon=one");
  });
});
