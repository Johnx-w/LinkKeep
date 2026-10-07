import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const store = vi.hoisted(() => ({ consumeRate: vi.fn(), acquireLease: vi.fn(), releaseLease: vi.fn() }));
vi.mock("@/storage/server-store", () => ({ getStore: () => store }));
vi.mock("@/security/client-ip", () => ({ clientIp: () => "127.0.0.1" }));
vi.mock("@/config/env", () => ({ env: { DAILY_ID_SECRET: "development-test-secret", VALIDATION_TOKEN: "" } }));
import { admitRequest } from "@/security/request-admission";

describe("调试解析准入", () => {
  const request = new Request("http://localhost:3000/api/parse");
  beforeEach(() => {
    vi.clearAllMocks();
    store.consumeRate.mockReturnValue({ allowed: false, retryAfterSeconds: 60 });
    store.acquireLease.mockReturnValue("test-lease");
  });
  afterEach(() => vi.unstubAllEnvs());
  it("开发解析不消耗或受次数配额限制，但完成后释放并发租约", () => {
    vi.stubEnv("NODE_ENV", "development");
    const release = admitRequest(request, "parse");
    expect(store.consumeRate).not.toHaveBeenCalled();
    release(); release();
    expect(store.releaseLease).toHaveBeenCalledExactlyOnceWith("test-lease");
  });
  it("生产解析仍执行配额，配额耗尽时不占用浏览器", () => {
    vi.stubEnv("NODE_ENV", "production");
    expect(() => admitRequest(request, "parse")).toThrow("RATE_LIMITED");
    expect(store.consumeRate).toHaveBeenCalled();
    expect(store.acquireLease).not.toHaveBeenCalled();
  });
  it("开发模式仍限制重叠解析，避免同时启动过多浏览器", () => {
    vi.stubEnv("NODE_ENV", "development");
    store.acquireLease.mockReturnValue(null);
    expect(() => admitRequest(request, "parse")).toThrow("SERVICE_BUSY");
  });
  it("开发媒体传输仍执行独立额度", () => {
    vi.stubEnv("NODE_ENV", "development");
    expect(() => admitRequest(request, "media")).toThrow("RATE_LIMITED");
    expect(store.consumeRate).toHaveBeenCalled();
  });
});
