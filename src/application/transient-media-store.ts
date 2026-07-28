import { randomBytes } from "node:crypto";

import type { MediaItem } from "@/domain/media";
import type { SupportedPlatform } from "@/domain/share-input";

export interface StoredMedia {
  platform: SupportedPlatform;
  postId: string;
  author?: string;
  title?: string;
  item: MediaItem;
  expiresAt: number;
}

export class TransientMediaStore {
  private readonly values = new Map<string, StoredMedia>();

  constructor(private readonly ttlMs = 15 * 60 * 1000) {}

  put(
    value: Omit<StoredMedia, "expiresAt">,
    now = new Date(),
  ): { token: string; expiresAt: string } {
    const token = randomBytes(32).toString("base64url");
    const expiresAt = now.getTime() + this.ttlMs;
    this.values.set(token, { ...value, expiresAt });
    if (this.values.size > 5_000) this.sweep(now);
    return { token, expiresAt: new Date(expiresAt).toISOString() };
  }

  get(token: string, now = new Date()): StoredMedia | null {
    const value = this.values.get(token);
    if (!value) return null;
    if (value.expiresAt <= now.getTime()) {
      this.values.delete(token);
      return null;
    }
    return value;
  }

  deletePost(platform: SupportedPlatform, postId: string): void {
    for (const [token, value] of this.values.entries()) {
      if (value.platform === platform && value.postId === postId) {
        this.values.delete(token);
      }
    }
  }

  sweep(now = new Date()): void {
    for (const [token, value] of this.values.entries()) {
      if (value.expiresAt <= now.getTime()) this.values.delete(token);
    }
  }
}

declare global {
  var __linkKeepMediaStore: TransientMediaStore | undefined;
}

export function getTransientMediaStore(): TransientMediaStore {
  globalThis.__linkKeepMediaStore ??= new TransientMediaStore();
  return globalThis.__linkKeepMediaStore;
}
