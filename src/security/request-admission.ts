import { timingSafeEqual } from "node:crypto";
import { env } from "@/config/env";
import { clientIp } from "@/security/client-ip";
import { createLimitIdentifier } from "@/security/rate-limit";
import { RequestError } from "@/security/http-request";
import { getStore } from "@/storage/server-store";

export function requestIdentifier(request: Request): string {
  try { return createLimitIdentifier(clientIp(request), new Date(), env.DAILY_ID_SECRET); }
  catch { throw new RequestError(503, "PROXY_CONFIGURATION_REQUIRED"); }
}

export function isOperatorValidation(request: Request): boolean {
  const expected = Buffer.from(env.VALIDATION_TOKEN);
  const provided = Buffer.from(request.headers.get("x-validation-token") ?? "");
  return expected.length >= 43 && expected.length === provided.length && timingSafeEqual(expected, provided);
}

export function admitRequest(request: Request, kind: "parse" | "media", token?: string): () => void {
  const store = getStore();
  const owner = requestIdentifier(request);
  const validation = isOperatorValidation(request);
  if (kind !== "parse" || process.env.NODE_ENV !== "development") {
    const limit = store.consumeRate(kind, validation ? "operator-validation" : owner, kind === "parse"
      ? (validation ? { hourly: 100, daily: 200 } : { hourly: 5, daily: 20 })
      : { hourly: 600, daily: 2000 });
    if (!limit.allowed) throw new RequestError(429, "RATE_LIMITED", limit.retryAfterSeconds);
  }
  if (token && !store.consumeRate("media-token", token, { hourly: 60, daily: 120 }).allowed) throw new RequestError(429, "RATE_LIMITED");
  const lease = store.acquireLease(kind, owner, kind === "parse" ? 2 : 6, kind === "parse" ? 1 : 4, kind === "parse" ? 90_000 : 240_000);
  if (!lease) throw new RequestError(429, "SERVICE_BUSY", 5);
  let released = false;
  return () => { if (!released) { released = true; store.releaseLease(lease); } };
}
