import { describe, expect, it, vi } from "vitest";
import type { BrowserContext } from "playwright-core";
import { storeBrowserCookies } from "@/platforms/browser-cookies";

describe("匿名浏览器 Cookie", () => {
  it("保留多个 Cookie 的域、路径、HTTPOnly 与过期属性，拒绝其他站点的域", async () => {
    const addCookies = vi.fn();
    const headers = new Headers();
    headers.append("set-cookie", "anon=one; Path=/; Domain=.douyin.com; Secure; HttpOnly; SameSite=Lax; Max-Age=60");
    headers.append("set-cookie", "page=two; Path=/video");
    headers.append("set-cookie", "bad=three; Domain=evil.example");
    await storeBrowserCookies({ addCookies } as unknown as BrowserContext, new URL("https://www.douyin.com/video/123"), headers);
    expect(addCookies).toHaveBeenCalledOnce();
    const cookies = addCookies.mock.calls[0][0];
    expect(cookies).toHaveLength(2);
    expect(cookies[0]).toMatchObject({ name: "anon", value: "one", domain: ".douyin.com", path: "/", httpOnly: true, secure: true, sameSite: "Lax" });
    expect(cookies[0].expires).toBeGreaterThan(Date.now() / 1000);
    expect(cookies[1]).toMatchObject({ name: "page", domain: "www.douyin.com", path: "/video", expires: -1 });
  });
});
