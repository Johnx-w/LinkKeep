import { env } from "@/config/env";

export function clientIp(request: Request): string {
  if (!env.TRUST_PROXY_HEADERS) return "untrusted-direct-client";
  return (
    request.headers.get("x-real-ip") ??
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    "missing-proxy-address"
  );
}
