import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { LinkKeepStore } from "@/storage/store";
import { POST } from "@/app/api/feedback/route";
import { GET as adminState, POST as adminAction } from "@/app/api/admin/operations/route";

let store: LinkKeepStore;
let adminAllowed = false;

vi.mock("@/config/env", () => ({ env: {
  APP_ORIGIN: "https://linkkeep.test",
  DAILY_ID_SECRET: "feedback-test-secret-not-used-for-production",
  TRUST_PROXY_HEADERS: true,
} }));
vi.mock("@/storage/server-store", () => ({ getStore: () => store }));
vi.mock("@/security/admin-request", () => ({ requireAdmin: async (request?: Request, csrfRequired?: boolean) => {
  if (!adminAllowed) throw new Error("UNAUTHORIZED");
  if (csrfRequired && request?.headers.get("x-csrf-token") !== "feedback-test-csrf") throw new Error("INVALID_CSRF");
  return { csrf: "feedback-test-csrf" };
} }));

beforeEach(() => { store = new LinkKeepStore(":memory:"); adminAllowed = false; });
afterEach(() => { store.close(); });

function request(data: unknown, origin = "https://linkkeep.test") {
  return new Request("https://linkkeep.test/api/feedback", {
    method: "POST",
    headers: { origin, "content-type": "application/json", "x-real-ip": "203.0.113.42" },
    body: JSON.stringify(data),
  });
}

describe("站内问题反馈", () => {
  it("建议无需邮箱或链接即可提交，后台可以处理", async () => {
    const response = await POST(request({ message: "希望增加更清晰的错误说明" }));
    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({ reference: "feedback-1" });
    expect(store.listOpenFeedback()).toEqual([expect.objectContaining({
      message: "希望增加更清晰的错误说明", contactEmail: "", problemUrl: "", status: "open",
    })]);
    expect(store.resolveFeedback(1)).toBe(true);
    expect(store.listOpenFeedback()).toEqual([]);
    expect(store.resolveFeedback(1)).toBe(false);
  });

  it("保存访客主动提供的问题链接和联系邮箱", async () => {
    const data = { message: "此链接解析失败，请帮助检查", problemUrl: "https://www.douyin.com/video/123456", contactEmail: "visitor@test.invalid", website: "" };
    expect((await POST(request(data))).status).toBe(201);
    expect(store.listOpenFeedback()[0]).toMatchObject(dataWithoutHoneypot(data));
  });

  it.each(["not a URL", "javascript:alert(1)", "https://user:password@site.test/post"])("拒绝不安全的问题链接 %s", async (problemUrl) => {
    expect((await POST(request({ message: "链接测试，请帮助检查", problemUrl }))).status).toBe(400);
    expect(store.listOpenFeedback()).toEqual([]);
  });

  it("拒绝跨站请求、超大输入和诱捕字段", async () => {
    expect((await POST(request({ message: "问题反馈测试" }, "https://other.test"))).status).toBe(403);
    expect((await POST(request({ message: "x".repeat(21 * 1024) }))).status).toBe(413);
    expect((await POST(request({ message: "问题反馈测试", website: "spam" }))).status).toBe(400);
    expect(store.listOpenFeedback()).toEqual([]);
  });

  it("提交限额在保存前生效", async () => {
    for (let index = 0; index < 3; index++) {
      expect((await POST(request({ message: "问题反馈测试" }))).status).toBe(201);
    }
    const limited = await POST(request({ message: "问题反馈测试" }));
    expect(limited.status).toBe(429);
    expect(Number(limited.headers.get("retry-after"))).toBeGreaterThan(0);
    expect(store.listOpenFeedback()).toHaveLength(3);
  });

  it("访客反馈由管理员读取和处理，未认证请求不能读取", async () => {
    await POST(request({ message: "下载失败，请帮忙查看" }));
    expect((await adminState()).status).toBe(401);
    adminAllowed = true;
    const state = await adminState();
    expect(state.headers.get("cache-control")).toContain("no-store");
    expect((await state.json()).feedback).toEqual([expect.objectContaining({ message: "下载失败，请帮忙查看" })]);
    const actionRequest = new Request("https://linkkeep.test/api/admin/operations", {
      method: "POST", headers: { "content-type": "application/json", "x-csrf-token": "feedback-test-csrf" },
      body: JSON.stringify({ action: "resolve-feedback", feedbackId: 1 }),
    });
    expect((await adminAction(actionRequest)).status).toBe(200);
    expect((await (await adminState()).json()).feedback).toEqual([]);
  });

  it("后台处理反馈需要 CSRF，未知反馈编号返回404", async () => {
    const id = store.createFeedback({ message: "问题反馈测试", contactEmail: "", problemUrl: "" });
    adminAllowed = true;
    const makeAction = (feedbackId: number, csrf: string) => new Request("https://linkkeep.test/api/admin/operations", {
      method: "POST", headers: { "content-type": "application/json", "x-csrf-token": csrf },
      body: JSON.stringify({ action: "resolve-feedback", feedbackId }),
    });
    expect((await adminAction(makeAction(id, "wrong"))).status).toBe(403);
    expect(store.listOpenFeedback()).toHaveLength(1);
    expect((await adminAction(makeAction(999, "feedback-test-csrf"))).status).toBe(404);
  });
});

function dataWithoutHoneypot(data: { message: string; problemUrl: string; contactEmail: string }) {
  return { message: data.message, problemUrl: data.problemUrl, contactEmail: data.contactEmail };
}
