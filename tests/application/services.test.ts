import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  statuses: vi.fn(), enabled: vi.fn(), chromium: vi.fn(), parse: vi.fn(),
  store: { setPlatformEnabled: vi.fn(), isPlatformEnabled: vi.fn(() => true), isPostBlocked: vi.fn(() => false), recordPlatformFailure: vi.fn(() => false), recordPlatformSuccess: vi.fn() },
}));
vi.mock("@/config/env", () => ({ env: { ENABLE_DOUYIN: true, ENABLE_XIAOHONGSHU: true } }));
vi.mock("@/storage/server-store", () => ({ getStore: () => ({ ...mocks.store, platformStatuses: mocks.statuses }) }));
vi.mock("@/platforms/chromium-path", () => ({ resolveChromiumPath: mocks.chromium }));
vi.mock("@/platforms/public-page-loader", () => ({ createPublicPageLoader: () => undefined, standardBrowserRenderer: undefined }));
vi.mock("@/application/transient-media-store", () => ({ getTransientMediaStore: () => ({}) }));
vi.mock("@/platforms/public-metadata-adapter", () => ({
  DouyinPublicAdapter: class { platform = "douyin"; parse = mocks.parse; },
  XiaohongshuPublicAdapter: class { platform = "xiaohongshu"; parse = mocks.parse; },
}));

describe("开发解析服务初始化", () => {
  beforeEach(() => {
    vi.resetModules(); vi.clearAllMocks();
    globalThis.__linkKeepParseService = undefined;
    globalThis.__linkKeepParseServicePromise = undefined;
    mocks.statuses.mockReturnValue([]);
    mocks.chromium.mockResolvedValue(undefined);
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    globalThis.__linkKeepParseService = undefined;
    globalThis.__linkKeepParseServicePromise = undefined;
  });
  it("开发启动恢复自动熔断的平台，保留运营者手动停用的平台", async () => {
    vi.stubEnv("NODE_ENV", "development");
    mocks.statuses.mockReturnValue([
      { platform: "douyin", enabled: false, disabledReason: "automatic-circuit-breaker" },
      { platform: "xiaohongshu", enabled: false, disabledReason: "manual" },
    ]);
    await (await import("@/application/services")).getParseService();
    expect(mocks.store.setPlatformEnabled).toHaveBeenCalledExactlyOnceWith("douyin", true);
  });
  it("开发热更新重新初始化解析配置，普通请求仍复用服务", async () => {
    vi.stubEnv("NODE_ENV", "development");
    const first = await import("@/application/services");
    await first.getParseService(); await first.getParseService();
    expect(mocks.chromium).toHaveBeenCalledTimes(1);
    vi.resetModules();
    await (await import("@/application/services")).getParseService();
    expect(mocks.chromium).toHaveBeenCalledTimes(2);
  });
  it("生产模式不恢复熔断，并跨模块复用服务", async () => {
    vi.stubEnv("NODE_ENV", "production");
    mocks.statuses.mockReturnValue([{ platform: "douyin", enabled: false, disabledReason: "automatic-circuit-breaker" }]);
    await (await import("@/application/services")).getParseService();
    vi.resetModules();
    await (await import("@/application/services")).getParseService();
    expect(mocks.chromium).toHaveBeenCalledTimes(1);
    expect(mocks.store.setPlatformEnabled).not.toHaveBeenCalled();
  });
});
