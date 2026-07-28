import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { LinkKeepStore } from "@/storage/store";

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
