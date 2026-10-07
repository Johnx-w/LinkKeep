import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { LinkKeepStore } from "@/storage/store";
import { DatabaseSync } from "node:sqlite";

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

async function createStore(): Promise<LinkKeepStore> {
  const directory = await mkdtemp(path.join(tmpdir(), "linkkeep-"));
  directories.push(directory);
  return new LinkKeepStore(path.join(directory, "test.db"));
}

describe("运营持久状态", () => {
  it("开发调试可以记录连续失败而不自动关闭平台", async () => {
    const store = await createStore();
    try {
      for (let count = 0; count < 7; count++) {
        expect(store.recordPlatformFailure("douyin", Number.POSITIVE_INFINITY)).toBe(false);
      }
      expect(store.isPlatformEnabled("douyin")).toBe(true);
      expect(store.platformStatuses().find((item) => item.platform === "douyin")?.failureCount).toBe(7);
    } finally { store.close(); }
  });
  it("反馈在重启后保留，并只清理已处理满180天的个人资料", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "linkkeep-"));
    directories.push(directory);
    const filename = path.join(directory, "feedback.db");
    const first = new LinkKeepStore(filename);
    const resolved = first.createFeedback({ message: "已处理的问题", contactEmail: "closed@test.invalid", problemUrl: "https://site.test/closed" });
    first.createFeedback({ message: "仍在处理的问题", contactEmail: "open@test.invalid", problemUrl: "https://site.test/open" });
    first.resolveFeedback(resolved);
    first.close();
    const second = new LinkKeepStore(filename);
    const sql = new DatabaseSync(filename);
    try {
      expect(second.listOpenFeedback()).toEqual([expect.objectContaining({ message: "仍在处理的问题" })]);
      sql.prepare("UPDATE feedback SET resolved_at='2025-01-01 00:00:00' WHERE id=?").run(resolved);
      second.prune(new Date("2026-10-01T00:00:00Z"));
      expect(sql.prepare("SELECT message,contact_email,problem_url FROM feedback WHERE id=?").get(resolved)).toMatchObject({ message: "", contact_email: "", problem_url: "" });
      expect(second.listOpenFeedback()[0].contactEmail).toBe("open@test.invalid");
    } finally { sql.close(); second.close(); }
  });
  it("两条数据库连接共享并发限额和未结算预算", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "linkkeep-")); directories.push(directory);
    const filename = path.join(directory, "shared.db");
    const first = new LinkKeepStore(filename); const second = new LinkKeepStore(filename);
    try {
      const lease = first.acquireLease("parse", "visitor", 2, 1, 60_000);
      expect(lease).not.toBeNull();
      expect(second.acquireLease("parse", "visitor", 2, 1, 60_000)).toBeNull();
      const reservation = first.reserveProxyBudget("2026-09", 1024 ** 3, 80, 80)!;
      expect(reservation.maxBytes).toBe(1024 ** 3);
      expect(second.reserveProxyBudget("2026-09", 8192, 80, 80)).toBeNull();
      first.settleProxyBudget(reservation.id, 1024, 80);
      first.settleProxyBudget(reservation.id, 1024, 80);
      expect(second.proxyUsage("2026-09")).toEqual({ bytes: 1024, costCents: 1 });
      expect(second.reserveProxyBudget("2026-09", 8192, 80, 80)).not.toBeNull();
      first.releaseLease(lease!);
      expect(second.acquireLease("parse", "visitor", 2, 1, 60_000)).not.toBeNull();
    } finally { first.close(); second.close(); }
  });
  it("限流在关闭连接后仍生效，到期后允许请求", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "linkkeep-")); directories.push(directory);
    const filename = path.join(directory, "rate.db"); const now = new Date("2026-09-30T12:00:00Z");
    const first = new LinkKeepStore(filename);
    expect(first.consumeRate("parse", "visitor", { hourly: 1, daily: 2 }, now).allowed).toBe(true); first.close();
    const second = new LinkKeepStore(filename);
    try {
      expect(second.consumeRate("parse", "visitor", { hourly: 1, daily: 2 }, now).allowed).toBe(false);
      expect(second.consumeRate("parse", "visitor", { hourly: 1, daily: 2 }, new Date("2026-09-30T13:00:00Z")).allowed).toBe(true);
    } finally { second.close(); }
  });
  it("清理投诉个人资料保留帖子屏蔽，保留仍在处理的投诉", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "linkkeep-")); directories.push(directory);
    const filename = path.join(directory, "retention.db"); const store = new LinkKeepStore(filename);
    try {
      const resolved = store.createComplaint({ platform: "douyin", postId: "123", contactEmail: "reporter@test.invalid", statement: "rights evidence" });
      const open = store.createComplaint({ platform: "douyin", postId: "456", contactEmail: "open@test.invalid", statement: "pending evidence" });
      store.blockPost({ platform: "douyin", postId: "123", complaintId: resolved, reason: "verified" });
      store.resolveComplaint(resolved, "verified");
      const sql = new DatabaseSync(filename); sql.prepare("UPDATE complaint SET resolved_at='2025-01-01 00:00:00' WHERE id=?").run(resolved); sql.close();
      store.incrementMetric("2025-01-01", "douyin", "parse_success");
      store.prune(new Date("2026-09-30T00:00:00Z"));
      expect(store.getComplaint(resolved)).toMatchObject({ contactEmail: "", statement: "" });
      expect(store.getComplaint(open)?.contactEmail).toBe("open@test.invalid");
      expect(store.isPostBlocked("douyin", "123")).toBe(true);
      expect(store.recentMetrics()).toEqual([]);
    } finally { store.close(); }
  });
  it("运营者停止解析后该帖子保持不可解析", async () => {
    const store = await createStore();
    store.blockPost({
      platform: "xiaohongshu",
      postId: "65aabbccddeeff0011223344",
      reason: "verified-copyright-complaint",
      complaintId: null,
    });

    expect(
      store.isPostBlocked("xiaohongshu", "65aabbccddeeff0011223344"),
    ).toBe(true);
    store.close();
  });

  it("可单独停用一个平台而不影响另一个平台", async () => {
    const store = await createStore();
    store.setPlatformEnabled("douyin", false);

    expect(store.isPlatformEnabled("douyin")).toBe(false);
    expect(store.isPlatformEnabled("xiaohongshu")).toBe(true);
    store.close();
  });
});
