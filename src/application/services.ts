import "server-only";

import {
  ParseService,
  type PlatformOperations,
} from "@/application/parse-service";
import { getTransientMediaStore } from "@/application/transient-media-store";
import { env } from "@/config/env";
import {
  DouyinPublicAdapter,
  XiaohongshuPublicAdapter,
} from "@/platforms/public-metadata-adapter";
import {
  createPublicPageLoader,
  standardBrowserRenderer,
} from "@/platforms/public-page-loader";
import { resolveChromiumPath } from "@/platforms/chromium-path";
import { getStore } from "@/storage/server-store";

declare global {
  var __linkKeepParseService: ParseService | undefined;
  var __linkKeepParseServicePromise: Promise<ParseService> | undefined;
}

// A development hot reload must apply loader and operation changes too.
// Production keeps its process-wide cache across route module instances.
if (process.env.NODE_ENV === "development") {
  globalThis.__linkKeepParseService = undefined;
  globalThis.__linkKeepParseServicePromise = undefined;
}

export async function getParseService(): Promise<ParseService> {
  if (globalThis.__linkKeepParseService) {
    return globalThis.__linkKeepParseService;
  }
  globalThis.__linkKeepParseServicePromise ??= (async () => {
    const store = getStore();
    if (!env.ENABLE_DOUYIN) store.setPlatformEnabled("douyin", false, "env");
    if (!env.ENABLE_XIAOHONGSHU) {
      store.setPlatformEnabled("xiaohongshu", false, "env");
    }
    if (process.env.NODE_ENV === "development") {
      for (const status of store.platformStatuses()) {
        const enabled = status.platform === "douyin" ? env.ENABLE_DOUYIN : env.ENABLE_XIAOHONGSHU;
        if (enabled && !status.enabled && status.disabledReason === "automatic-circuit-breaker") {
          store.setPlatformEnabled(status.platform, true);
        }
      }
    }

    const chromiumPath = await resolveChromiumPath();
    if (chromiumPath) {
      process.env.PLAYWRIGHT_EXECUTABLE_PATH = chromiumPath;
    }

    const loader = createPublicPageLoader({
      browserRenderer: chromiumPath ? standardBrowserRenderer : undefined,
    });
    const operations: PlatformOperations = {
      isPlatformEnabled: (platform) => store.isPlatformEnabled(platform),
      isPostBlocked: (platform, postId) =>
        store.isPostBlocked(platform, postId),
      recordPlatformFailure: (platform) =>
        store.recordPlatformFailure(platform, process.env.NODE_ENV === "development" ? Number.POSITIVE_INFINITY : 5),
      recordPlatformSuccess: (platform) =>
        store.recordPlatformSuccess(platform),
    };

    globalThis.__linkKeepParseService = new ParseService({
      adapters: [
        new DouyinPublicAdapter(loader),
        new XiaohongshuPublicAdapter(loader),
      ],
      mediaStore: getTransientMediaStore(),
      operations,
    });
    return globalThis.__linkKeepParseService;
  })();
  return globalThis.__linkKeepParseServicePromise;
}
