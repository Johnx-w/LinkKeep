import "server-only";

import { LinkKeepStore } from "@/storage/store";

declare global {
  var __linkKeepStore: LinkKeepStore | undefined;
}

export function getStore(): LinkKeepStore {
  if (!globalThis.__linkKeepStore) {
    globalThis.__linkKeepStore = new LinkKeepStore(
      process.env.DATABASE_PATH ?? "./data/linkkeep.db",
    );
  }
  return globalThis.__linkKeepStore;
}
