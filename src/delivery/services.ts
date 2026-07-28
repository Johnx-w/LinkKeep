import "server-only";

import { getTransientMediaStore } from "@/application/transient-media-store";
import { env } from "@/config/env";
import { MediaDeliveryService } from "@/delivery/media-delivery-service";
import { getStore } from "@/storage/server-store";

declare global {
  var __linkKeepMediaDelivery: MediaDeliveryService | undefined;
}

export function getMediaDeliveryService(): MediaDeliveryService {
  globalThis.__linkKeepMediaDelivery ??= new MediaDeliveryService({
    mediaStore: getTransientMediaStore(),
    usageStore: getStore(),
    monthlyBudgetCents: env.PROXY_MONTHLY_BUDGET_CENTS,
    costPerGbCents: env.PROXY_COST_PER_GB_CENTS,
  });
  return globalThis.__linkKeepMediaDelivery;
}
