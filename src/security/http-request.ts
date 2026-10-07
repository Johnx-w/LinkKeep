import { env } from "@/config/env";

export class RequestError extends Error {
  constructor(public readonly status: number, public readonly code: string, public readonly retryAfterSeconds?: number) { super(code); }
}

function isLocalDevelopmentOrigin(request: Request, configured: URL): boolean {
  if (process.env.NODE_ENV !== "development") return false;
  const origin = request.headers.get("origin");
  try {
    const source = new URL(origin ?? "");
    const target = new URL(request.url);
    const loopbackHosts = new Set(["localhost", "127.0.0.1", "[::1]"]);
    if (origin !== source.origin || !loopbackHosts.has(configured.hostname)) return false;
    if (source.protocol !== configured.protocol || source.port !== configured.port) return false;
    if (loopbackHosts.has(source.hostname) && loopbackHosts.has(target.hostname)) {
      return target.protocol === configured.protocol && target.port === configured.port;
    }
    // Next dev may expose a loopback request.url even when the browser uses the LAN host.
    return source.hostname === "192.168.74.1" &&
      request.headers.get("host") === source.host &&
      target.protocol === configured.protocol && target.port === configured.port &&
      (target.origin === source.origin || loopbackHosts.has(target.hostname));
  } catch { return false; }
}

export function requireSameOrigin(request: Request): void {
  const configured = new URL(env.APP_ORIGIN);
  const sameOrigin = request.headers.get("origin") === configured.origin || isLocalDevelopmentOrigin(request, configured);
  if (!sameOrigin || request.headers.get("sec-fetch-site") === "cross-site") {
    throw new RequestError(403, "INVALID_ORIGIN");
  }
}

export async function readLimitedJson(request: Request, maxBytes = 16 * 1024): Promise<unknown> {
  if (request.headers.get("content-type")?.split(";")[0].trim() !== "application/json") throw new RequestError(415, "INVALID_CONTENT_TYPE");
  const declared = request.headers.get("content-length");
  if (declared && (!/^\d+$/.test(declared) || Number(declared) > maxBytes)) throw new RequestError(413, "REQUEST_TOO_LARGE");
  if (!request.body) throw new RequestError(400, "INVALID_REQUEST");
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  let timedOut = false;
  const timeout = setTimeout(() => { timedOut = true; void reader.cancel(); }, 5000);
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) { await reader.cancel(); throw new RequestError(413, "REQUEST_TOO_LARGE"); }
      chunks.push(value);
    }
    if (timedOut) throw new RequestError(408, "REQUEST_TIMEOUT");
    return JSON.parse(Buffer.concat(chunks, total).toString("utf8")) as unknown;
  } catch (error) {
    if (error instanceof RequestError) throw error;
    throw new RequestError(400, "INVALID_REQUEST");
  } finally { clearTimeout(timeout); reader.releaseLock(); }
}

export function requestErrorResponse(error: unknown): Response {
  const failure = error instanceof RequestError ? error : new RequestError(500, "INTERNAL_ERROR");
  return Response.json({ error: failure.code }, { status: failure.status, headers: { "cache-control": "no-store", ...(failure.retryAfterSeconds ? { "retry-after": String(failure.retryAfterSeconds) } : {}) } });
}
