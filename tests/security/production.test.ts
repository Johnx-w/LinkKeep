import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { assertProductionConfiguration } from "@/config/production";

const hash = "scrypt$" + "a".repeat(22) + "$" + "b".repeat(86);
function valid() { return {
  APP_ORIGIN: "https://linkkeep.test", COPYRIGHT_EMAIL: "copyright@linkkeep.test", TRUST_PROXY_HEADERS: "true",
  SESSION_SECRET: randomBytes(32).toString("base64url"), DAILY_ID_SECRET: randomBytes(32).toString("base64url"),
  ADMIN_PASSWORD_HASH: hash, ADMIN_TOTP_SECRET: "A".repeat(32), ADMIN_RECOVERY_CODES_HASH: JSON.stringify([hash]),
  BACKUP_ENCRYPTION_KEY: randomBytes(32).toString("base64"),
}; }
describe("生产配置门禁", () => {
  it("允许完整独立生产配置", () => expect(() => assertProductionConfiguration(valid())).not.toThrow());
  it.each(["SESSION_SECRET", "DAILY_ID_SECRET", "ADMIN_PASSWORD_HASH", "ADMIN_TOTP_SECRET", "BACKUP_ENCRYPTION_KEY", "COPYRIGHT_EMAIL", "APP_ORIGIN", "TRUST_PROXY_HEADERS"])("拒绝缺失的 %s", (key) => expect(() => assertProductionConfiguration({ ...valid(), [key]: "" })).toThrow(key));
  it("拒绝公开占位密钥及复用密钥", () => {
    expect(() => assertProductionConfiguration({ ...valid(), SESSION_SECRET: "replace-with-at-least-32-random-bytes" })).toThrow("SESSION_SECRET");
    const env = valid(); env.DAILY_ID_SECRET = env.SESSION_SECRET;
    expect(() => assertProductionConfiguration(env)).toThrow("distinct secrets");
  });
});
