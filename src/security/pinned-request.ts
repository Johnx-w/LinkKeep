import { Agent, request } from "undici";

import { DomainError } from "@/domain/errors";

interface PinnedRequestOptions {
  url: URL;
  addresses: string[];
  signal: AbortSignal;
  maximumBytes: number;
  headers?: Record<string, string>;
  method?: "GET" | "HEAD";
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

function createPinnedDispatcher(addresses: string[]): Agent {
  // Prefer IPv4 — some CDN edges intermittently fail on pinned IPv6.
  const ordered = [
    ...addresses.filter((item) => !item.includes(":")),
    ...addresses.filter((item) => item.includes(":")),
  ];
  let addressIndex = 0;
  return new Agent({
    connect: {
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

export async function openPinnedStream(
  options: Omit<PinnedRequestOptions, "maximumBytes">,
): Promise<PinnedStreamResponse> {
  const dispatcher = createPinnedDispatcher(options.addresses);
  try {
    const response = await request(options.url, {
      dispatcher,
      method: options.method ?? "GET",
      signal: options.signal,
      headers: options.headers,
    });
    return {
      status: response.statusCode,
      headers: headersFromUndici(response.headers),
      body: response.body,
      close: () => dispatcher.close(),
    };
  } catch (error) {
    await dispatcher.close();
    throw error;
  }
}

export async function pinnedRequest(
  options: PinnedRequestOptions,
): Promise<PinnedResponse> {
  const dispatcher = createPinnedDispatcher(options.addresses);

  try {
    const response = await request(options.url, {
      dispatcher,
      method: options.method ?? "GET",
      signal: options.signal,
      headers: options.headers,
    });
    const headers = headersFromUndici(response.headers);
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
  } finally {
    await dispatcher.close();
  }
}
