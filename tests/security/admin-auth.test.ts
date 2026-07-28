import { describe, expect, it } from "vitest";

import {
  createAdminSession,
  readAdminSession,
} from "@/security/admin-auth";
import { hashPassword, verifyPassword } from "@/security/password";

describe("运营后台认证", () => {
  it("scrypt 密码哈希可验证且不包含明文", async () => {
    const encoded = await hashPassword("a-strong-operator-password");

    expect(encoded).not.toContain("a-strong-operator-password");
    await expect(
      verifyPassword("a-strong-operator-password", encoded),
    ).resolves.toBe(true);
    await expect(verifyPassword("wrong-password", encoded)).resolves.toBe(
      false,
    );
  });

  it("签名会话包含独立 CSRF 令牌", async () => {
    const created = await createAdminSession();
    const session = await readAdminSession(created.token);

    expect(session?.csrf).toBe(created.csrf);
    expect(created.csrf.length).toBeGreaterThan(24);
  });
});
