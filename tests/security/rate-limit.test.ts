import { describe, expect, it } from "vitest";

import {
  MemoryParseRateLimiter,
  createLimitIdentifier,
} from "@/security/rate-limit";

describe("免费解析额度", () => {
  it("同一访客第六次小时请求被限流", () => {
    const limiter = new MemoryParseRateLimiter({ hourly: 5, daily: 20 });
    const now = new Date("2026-07-27T12:00:00.000Z");

    for (let index = 0; index < 5; index++) {
      expect(limiter.consume("visitor", now).allowed).toBe(true);
    }
    expect(limiter.consume("visitor", now)).toMatchObject({
      allowed: false,
      reason: "hourly",
    });
  });

  it("限流标识每天轮换且不包含原始 IP", () => {
    const first = createLimitIdentifier(
      "203.0.113.5",
      new Date("2026-07-27T12:00:00.000Z"),
      "a-secure-daily-secret",
    );
    const next = createLimitIdentifier(
      "203.0.113.5",
      new Date("2026-07-28T12:00:00.000Z"),
      "a-secure-daily-secret",
    );

    expect(first).not.toBe(next);
    expect(first).not.toContain("203.0.113.5");
  });
});
