import { env } from "@/config/env";
import { isIP } from "node:net";

export function clientIp(request: Request): string {
  if (!env.TRUST_PROXY_HEADERS) return "untrusted-direct-client";
  const address = request.headers.get("x-real-ip")?.trim();
  // The reverse proxy must overwrite this header and be the only public ingress.
  if (!address || !isIP(address)) throw new Error("INVALID_PROXY_ADDRESS");
  return address;
}
