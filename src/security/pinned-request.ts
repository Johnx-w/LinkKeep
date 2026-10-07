import { Agent, request } from "undici";

import { DomainError } from "@/domain/errors";

interface PinnedRequestOptions {
  url: URL;
  addresses: string[];
  signal: AbortSignal;
  maximumBytes: number;
  headers?: Record<string, string>;
  method?: "GET" | "HEAD";
  onBytes?: (bytes: number) => void;
}

export interface PinnedResponse {
  status: number;
  headers: Headers;
  body: Uint8Array;
}

export interface PinnedStreamResponse {
  status: number;
  headers: Headers;
  body: AsyncIterable<Uint8Array> & { destroy(error?: Error): void };
  close(): Promise<void>;
}

function headersFromUndici(
  values: Record<string, string | string[] | undefined>,
): Headers {
  const headers = new Headers();
  for (const [name, value] of Object.entries(values)) {
    if (Array.isArray(value)) {
      value.forEach((item) => headers.append(name, item));
    } else if (value !== undefined) {
      headers.set(name, value);
    }
  }
  return headers;
}

function createPinnedDispatcher(addresses: string[], bodyTimeout = 15_000): Agent {
  // Prefer IPv4 — some CDN edges intermittently fail on pinned IPv6.
  const ordered = [
    ...addresses.filter((item) => !item.includes(":")),
    ...addresses.filter((item) => item.includes(":")),
  ];
  let addressIndex = 0;
  return new Agent({
    // CDN HTTP/2 negotiation can stall or truncate these pinned transfers.
    // Use the same HTTP/1.1 transport for pages, redirects and media streams.
    allowH2: false,
    // Try only the already-validated address set when a CDN edge is unavailable.
    autoSelectFamily: true,
    autoSelectFamilyAttemptTimeout: 250,
    headersTimeout: 10_000,
    bodyTimeout,
    connect: {
      timeout: 5_000,
      lookup(_hostname, lookupOptions, callback) {
        const address = ordered[addressIndex++ % ordered.length];
        const family = address.includes(":") ? 6 : 4;
        if (lookupOptions.all) {
          callback(
            null,
            ordered.map((item) => ({
              address: item,
              family: item.includes(":") ? 6 : 4,
            })),
          );
          return;
        }
        callback(null, address, family);
      },
    },
  });
}

function canRetry(error: unknown, signal: AbortSignal, attempt: number): boolean {
  if (attempt !== 0 || signal.aborted || !error || typeof error !== "object") return false;
  const code = "code" in error ? String(error.code) : "";
  return ["UND_ERR_CONNECT_TIMEOUT", "UND_ERR_HEADERS_TIMEOUT", "UND_ERR_BODY_TIMEOUT", "UND_ERR_SOCKET", "ECONNRESET", "ETIMEDOUT", "ECONNREFUSED", "EHOSTUNREACH", "ENETUNREACH"].includes(code);
}

function retryAddresses(addresses: string[], attempt: number): string[] {
  return attempt ? [...addresses.slice(1), addresses[0]] : addresses;
}

export async function openPinnedStream(
  options: Omit<PinnedRequestOptions, "maximumBytes">,
): Promise<PinnedStreamResponse> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const dispatcher = createPinnedDispatcher(retryAddresses(options.addresses, attempt), 30_000);
    try {
    const response = await request(options.url, {
      dispatcher,
      method: options.method ?? "GET",
      signal: options.signal,
      headers: options.headers,
    });
    // Intentional body disposal emits UND_ERR_ABORTED asynchronously. Iterators
    // still reject real stream failures, but a discarded redirect must not crash Node.
    response.body.on("error", () => undefined);
    return {
      status: response.statusCode,
      headers: headersFromUndici(response.headers),
      body: response.body,
      close: async () => { response.body.destroy(); await dispatcher.destroy(); },
    };
    } catch (error) {
      await dispatcher.destroy();
      if (!canRetry(error, options.signal, attempt)) throw error;
    }
  }
  throw new DomainError("PARSE_FAILED");
}

export async function pinnedRequest(
  options: PinnedRequestOptions,
): Promise<PinnedResponse> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const dispatcher = createPinnedDispatcher(retryAddresses(options.addresses, attempt));
    try {
    const response = await request(options.url, {
      dispatcher,
      method: options.method ?? "GET",
      signal: options.signal,
      headers: options.headers,
    });
    response.body.on("error", () => undefined);
    const headers = headersFromUndici(response.headers);
    if (response.statusCode >= 300 && response.statusCode < 400) {
      response.body.destroy();
      return { status: response.statusCode, headers, body: new Uint8Array() };
    }
    const declared = Number(headers.get("content-length") ?? "0");
    if (declared > options.maximumBytes) {
      response.body.destroy();
      throw new DomainError("MEDIA_TOO_LARGE");
    }

    const chunks: Uint8Array[] = [];
    let total = 0;
    for await (const chunk of response.body) {
      const bytes =
        chunk instanceof Uint8Array ? chunk : new Uint8Array(chunk as Buffer);
      total += bytes.byteLength;
      options.onBytes?.(bytes.byteLength);
      if (total > options.maximumBytes) {
        response.body.destroy();
        throw new DomainError("MEDIA_TOO_LARGE");
      }
      chunks.push(bytes);
    }

    const body = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      body.set(chunk, offset);
      offset += chunk.byteLength;
    }

    return {
      status: response.statusCode,
      headers,
      body,
    };
    } catch (error) {
      if (!canRetry(error, options.signal, attempt)) throw error;
    } finally {
      await dispatcher.destroy();
    }
  }
  throw new DomainError("PARSE_FAILED");
}
