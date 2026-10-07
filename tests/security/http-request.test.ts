import { afterEach, describe, expect, it, vi } from "vitest";
import { env } from "@/config/env";
import { readLimitedJson, requireSameOrigin } from "@/security/http-request";

describe("本机开发同源校验", () => {
  const originalOrigin = env.APP_ORIGIN;
  afterEach(() => { env.APP_ORIGIN = originalOrigin; vi.unstubAllEnvs(); });
  function request(origin?: string, target = "http://localhost:3000/api/parse", site?: string, host?: string) {
    return new Request(target, { headers: { ...(origin ? { origin } : {}), ...(site ? { "sec-fetch-site": site } : {}), ...(host ? { host } : {}) } });
  }
  it("开发模式接受同端口 localhost、IPv4 和 IPv6 本机入口", () => {
    vi.stubEnv("NODE_ENV", "development");
    env.APP_ORIGIN = "http://127.0.0.1:3000";
    for (const origin of ["http://localhost:3000", "http://127.0.0.1:3000", "http://[::1]:3000"]) {
      expect(() => requireSameOrigin(request(origin))).not.toThrow();
    }
    env.APP_ORIGIN = "http://localhost:3000";
    expect(() => requireSameOrigin(request("http://127.0.0.1:3000", "http://127.0.0.1:3000/api/parse"))).not.toThrow();
  });
  it("生产模式仍只接受配置的精确来源", () => {
    vi.stubEnv("NODE_ENV", "production");
    env.APP_ORIGIN = "http://127.0.0.1:3000";
    expect(() => requireSameOrigin(request("http://127.0.0.1:3000"))).not.toThrow();
    expect(() => requireSameOrigin(request("http://localhost:3000"))).toThrow("INVALID_ORIGIN");
    expect(() => requireSameOrigin(request("http://192.168.74.1:3000", "http://192.168.74.1:3000/api/parse"))).toThrow("INVALID_ORIGIN");
  });
  it("开发模式允许当前局域网入口访问自己的 API", () => {
    vi.stubEnv("NODE_ENV", "development");
    env.APP_ORIGIN = "http://127.0.0.1:3000";
    expect(() => requireSameOrigin(request("http://192.168.74.1:3000", "http://192.168.74.1:3000/api/parse", undefined, "192.168.74.1:3000"))).not.toThrow();
    expect(() => requireSameOrigin(request("http://192.168.74.1:3000", "http://localhost:3000/api/parse", undefined, "192.168.74.1:3000"))).not.toThrow();
    expect(() => requireSameOrigin(request("http://192.168.74.1:3000", "http://localhost:3000/api/parse"))).toThrow("INVALID_ORIGIN");
    expect(() => requireSameOrigin(request("http://192.168.74.2:3000", "http://192.168.74.2:3000/api/parse"))).toThrow("INVALID_ORIGIN");
  });
  it("拒绝其他端口、协议、伪装域名、跨站请求和缺失来源", () => {
    vi.stubEnv("NODE_ENV", "development");
    env.APP_ORIGIN = "http://127.0.0.1:3000";
    for (const origin of [undefined, "null", "http://localhost:3001", "https://localhost:3000", "http://localhost.attacker.test:3000", "http://localhost:3000/"]) {
      expect(() => requireSameOrigin(request(origin))).toThrow("INVALID_ORIGIN");
    }
    expect(() => requireSameOrigin(request("http://localhost:3000", "http://localhost:3000/api/parse", "cross-site"))).toThrow("INVALID_ORIGIN");
    expect(() => requireSameOrigin(request("http://localhost:3000", "http://192.168.1.2:3000/api/parse"))).toThrow("INVALID_ORIGIN");
  });
});

describe("请求体硬限制", () => {
  it("没有长度头的流式大请求也在解析前拒绝", async () => {
    const request = new Request("http://localhost", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ value: "x".repeat(200) }) });
    await expect(readLimitedJson(request, 100)).rejects.toMatchObject({ status: 413 });
  });
  it("接受有界 JSON 并拒绝非 JSON", async () => {
    await expect(readLimitedJson(new Request("http://localhost", { method: "POST", headers: { "content-type": "application/json" }, body: '{"ok":true}' }))).resolves.toEqual({ ok: true });
    await expect(readLimitedJson(new Request("http://localhost", { method: "POST", body: "hello" }))).rejects.toMatchObject({ status: 415 });
  });
});
