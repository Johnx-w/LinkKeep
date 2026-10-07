import { describe, expect, it } from "vitest";

import {
  createAdminSession,
  readAdminSession,
} from "@/security/admin-auth";
import { hashPassword, verifyPassword } from "@/security/password";
import { SignJWT } from "jose";

describe("运营后台认证", () => {
  it("公开旧密钥不能签发有效后台会话", async () => {
    const forged = await new SignJWT({ csrf: "attacker-controlled" }).setProtectedHeader({ alg: "HS256" }).setSubject("linkkeep-operator").setExpirationTime("2h").sign(new TextEncoder().encode("development-session-secret"));
    await expect(readAdminSession(forged)).resolves.toBeNull();
  });
  it("scrypt 密码哈希可验证且不包含明文", async () => {
    const encoded = await hashPassword("a-strong-operator-password");

    expect(encoded).not.toContain("a-strong-operator-password");
    await expect(
      verifyPassword("a-strong-operator-password", encoded),
    ).resolves.toBe(true);
    await expect(verifyPassword("wrong-password", encoded)).resolves.toBe(
      false,
    );
    await expect(verifyPassword("a-strong-operator-password", "base64:" + Buffer.from(encoded).toString("base64"))).resolves.toBe(true);
  });

  it("签名会话包含独立 CSRF 令牌", async () => {
    const created = await createAdminSession();
    const session = await readAdminSession(created.token);

    expect(session?.csrf).toBe(created.csrf);
    expect(created.csrf.length).toBeGreaterThan(24);
  });
});
