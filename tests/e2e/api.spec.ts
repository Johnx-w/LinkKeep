import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";
import * as OTPAuth from "otpauth";

const origin = "https://127.0.0.1:3443";
test("生产 API 拒绝跨站与超大请求，入口覆盖伪造代理头", async ({ request }) => {
  const crossSite = await request.post("/api/parse", { headers: { origin: "https://foreign.test" }, data: { input: "hello" } });
  expect(crossSite.status()).toBe(403);
  const oversized = await request.post("/api/parse", { headers: { origin }, data: { input: "x".repeat(18000) } });
  expect(oversized.status()).toBe(413);
  for (let index = 0; index < 4; index++) {
    const response = await request.post("/api/parse", { headers: { origin, "x-real-ip": `203.0.113.${index + 1}` }, data: { input: "invalid" } });
    expect(response.status()).toBe(400);
  }
  const limited = await request.post("/api/parse", { headers: { origin, "x-real-ip": "203.0.113.99" }, data: { input: "invalid" } });
  expect(limited.status()).toBe(429);
});

test("后台需要密码与 TOTP，写操作还需要 CSRF", async ({ request }) => {
  const unauthenticated = await request.get("/api/admin/operations"); expect(unauthenticated.status()).toBe(401);
  const credentials = JSON.parse(await readFile("artifacts/e2e/operator.json", "utf8")) as { password: string; totp: string };
  const secondFactor = new OTPAuth.TOTP({ secret: OTPAuth.Secret.fromBase32(credentials.totp) }).generate();
  const login = await request.post("/api/admin/session", { headers: { origin }, data: { password: credentials.password, secondFactor } });
  expect(login.status()).toBe(200);
  expect(login.headers()["set-cookie"]).toContain("Secure");
  const session = await login.json() as { csrf: string };
  const action = { action: "block-post", platform: "douyin", postId: "123456", reason: "isolated-e2e-test" };
  expect((await request.post("/api/admin/operations", { headers: { origin }, data: action })).status()).toBe(403);
  expect((await request.post("/api/admin/operations", { headers: { origin, "x-csrf-token": session.csrf }, data: action })).status()).toBe(200);
  const state = await request.get("/api/admin/operations");
  expect(state.headers()["cache-control"]).toContain("no-store");
  expect((await state.json()).blockedPosts).toEqual(expect.arrayContaining([expect.objectContaining({ postId: "123456" })]));
  expect((await request.delete("/api/admin/session", { headers: { origin, "x-csrf-token": session.csrf } })).status()).toBe(200);
  expect((await request.get("/api/admin/operations")).status()).toBe(401);
});
