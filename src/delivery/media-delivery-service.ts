import { DomainError } from "@/domain/errors";
import type { SupportedPlatform } from "@/domain/share-input";
import { mediaFilename } from "@/domain/filename";
import type { TransientMediaStore } from "@/application/transient-media-store";
import { validateMediaBytes } from "@/delivery/media-validation";
import { openPinnedStream } from "@/security/pinned-request";
import { validatePublicMediaUrl } from "@/security/url-guard";

const MAX_MEDIA_BYTES = 300 * 1024 * 1024;
const MAX_PREVIEW_BYTES = 8 * 1024 * 1024;
const MAGIC_BYTES = 8_192;
const MAX_REDIRECTS = 3;

export interface ProxyUsageStore {
  proxyUsage(month: string): { bytes: number; costCents: number };
  addProxyUsage(month: string, bytes: number, costCents: number): void;
}

interface MediaDeliveryOptions {
  mediaStore: TransientMediaStore;
  usageStore: ProxyUsageStore;
  monthlyBudgetCents: number;
  costPerGbCents: number;
}

export interface ProxyMediaResult {
  body: ReadableStream<Uint8Array>;
  headers: Headers;
}

type DeliveryPurpose = "download" | "preview";

function monthKey(date: Date): string {
  return date.toISOString().slice(0, 7);
}

function estimatedCost(bytes: number, centsPerGb: number): number {
  return Math.ceil((bytes / 1024 ** 3) * centsPerGb);
}

function platformReferer(platform: SupportedPlatform): string {
  return platform === "douyin"
    ? "https://www.douyin.com/"
    : "https://www.xiaohongshu.com/";
}

function uniqueUrls(urls: Array<string | undefined>): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const url of urls) {
    if (!url || seen.has(url)) continue;
    seen.add(url);
    result.push(url);
  }
  return result;
}

export class MediaDeliveryService {
  constructor(private readonly options: MediaDeliveryOptions) {}

  async directUrl(token: string, now = new Date()): Promise<string> {
    const stored = this.options.mediaStore.get(token, now);
    if (!stored) throw new DomainError("CONTENT_UNAVAILABLE");
    const validated = await validatePublicMediaUrl(
      stored.item.source.url,
      stored.platform,
    );
    return validated.url.toString();
  }

  async proxy(
    token: string,
    signal: AbortSignal,
    now = new Date(),
  ): Promise<ProxyMediaResult> {
    return this.deliver(token, signal, "download", now);
  }

  async preview(
    token: string,
    signal: AbortSignal,
    now = new Date(),
  ): Promise<ProxyMediaResult> {
    return this.deliver(token, signal, "preview", now);
  }

  private async deliver(
    token: string,
    signal: AbortSignal,
    purpose: DeliveryPurpose,
    now: Date,
  ): Promise<ProxyMediaResult> {
    const stored = this.options.mediaStore.get(token, now);
    if (!stored) throw new DomainError("CONTENT_UNAVAILABLE");

    const month = monthKey(now);
    const usage = this.options.usageStore.proxyUsage(month);
    const maxBytes =
      purpose === "preview" ? MAX_PREVIEW_BYTES : MAX_MEDIA_BYTES;
    const expectedKind =
      purpose === "preview" ? "image" : stored.item.kind;

    if (
      purpose === "download" &&
      usage.costCents >= this.options.monthlyBudgetCents
    ) {
      throw new DomainError("PROXY_BUDGET_EXHAUSTED");
    }

    const candidates =
      purpose === "preview"
        ? uniqueUrls([
            stored.item.thumbnailUrl,
            stored.item.kind === "image"
              ? stored.item.source.url
              : undefined,
          ])
        : uniqueUrls([stored.item.source.url]);
    if (candidates.length === 0) throw new DomainError("CONTENT_UNAVAILABLE");

    let lastError: unknown;
    for (const startUrl of candidates) {
      try {
        return await this.fetchFromUrl({
          stored,
          startUrl,
          signal,
          purpose,
          month,
          usage,
          maxBytes,
          expectedKind,
        });
      } catch (error) {
        lastError = error;
        if (purpose !== "preview") throw error;
      }
    }

    throw lastError instanceof Error
      ? lastError
      : new DomainError("CONTENT_UNAVAILABLE");
  }

  private async fetchFromUrl(options: {
    stored: NonNullable<ReturnType<TransientMediaStore["get"]>>;
    startUrl: string;
    signal: AbortSignal;
    purpose: DeliveryPurpose;
    month: string;
    usage: { bytes: number; costCents: number };
    maxBytes: number;
    expectedKind: "image" | "video";
  }): Promise<ProxyMediaResult> {
    const {
      stored,
      signal,
      purpose,
      month,
      usage,
      maxBytes,
      expectedKind,
    } = options;

    let current = options.startUrl;
    for (let redirects = 0; redirects <= MAX_REDIRECTS; redirects++) {
      const validated = await validatePublicMediaUrl(
        current,
        stored.platform,
      );
      const response = await openPinnedStream({
        url: validated.url,
        addresses: validated.addresses,
        signal,
        headers: {
          accept: "*/*",
          "user-agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36",
          Referer: platformReferer(stored.platform),
        },
      });

      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get("location");
        response.body.destroy();
        await response.close();
        if (!location || redirects === MAX_REDIRECTS) {
          throw new DomainError("PARSE_FAILED", "PARSE_FAILED", true);
        }
        current = new URL(location, validated.url).toString();
        continue;
      }

      if (response.status < 200 || response.status >= 300) {
        response.body.destroy();
        await response.close();
        throw new DomainError("CONTENT_UNAVAILABLE");
      }

      const declaredSize = Number(
        response.headers.get("content-length") ?? "0",
      );
      if (declaredSize > maxBytes) {
        response.body.destroy();
        await response.close();
        throw new DomainError("MEDIA_TOO_LARGE");
      }
      if (
        purpose === "download" &&
        declaredSize > 0 &&
        usage.costCents +
          estimatedCost(declaredSize, this.options.costPerGbCents) >
          this.options.monthlyBudgetCents
      ) {
        response.body.destroy();
        await response.close();
        throw new DomainError("PROXY_BUDGET_EXHAUSTED");
      }

      const iterator = response.body[Symbol.asyncIterator]();
      const prefixChunks: Uint8Array[] = [];
      let prefixSize = 0;
      while (prefixSize < MAGIC_BYTES) {
        const part = await iterator.next();
        if (part.done) break;
        const bytes =
          part.value instanceof Uint8Array
            ? part.value
            : new Uint8Array(part.value);
        prefixChunks.push(bytes);
        prefixSize += bytes.byteLength;
      }

      const prefix = new Uint8Array(prefixSize);
      let prefixOffset = 0;
      for (const chunk of prefixChunks) {
        prefix.set(chunk, prefixOffset);
        prefixOffset += chunk.byteLength;
      }

      let validatedType;
      try {
        validatedType = await validateMediaBytes(
          prefix,
          response.headers.get("content-type"),
          expectedKind,
        );
      } catch (error) {
        response.body.destroy();
        await response.close();
        throw error;
      }

      const filename = mediaFilename({
        platform: stored.platform,
        author: stored.author,
        title: stored.title,
        postId: stored.postId,
        index: stored.item.index,
        extension: validatedType.extension,
      });
      let total = 0;
      let recorded = false;

      const recordUsage = () => {
        if (recorded || total === 0 || purpose === "preview") return;
        recorded = true;
        this.options.usageStore.addProxyUsage(
          month,
          total,
          estimatedCost(total, this.options.costPerGbCents),
        );
      };

      const body = new ReadableStream<Uint8Array>({
        async start(controller) {
          try {
            for (const chunk of prefixChunks) {
              total += chunk.byteLength;
              controller.enqueue(chunk);
            }
            while (true) {
              const part = await iterator.next();
              if (part.done) break;
              const chunk =
                part.value instanceof Uint8Array
                  ? part.value
                  : new Uint8Array(part.value);
              total += chunk.byteLength;
              if (total > maxBytes) {
                throw new DomainError("MEDIA_TOO_LARGE");
              }
              controller.enqueue(chunk);
            }
            controller.close();
          } catch (error) {
            controller.error(error);
          } finally {
            recordUsage();
            await response.close();
          }
        },
        async cancel() {
          response.body.destroy();
          recordUsage();
          await response.close();
        },
      });

      const headers = new Headers({
        "content-type": validatedType.mimeType,
        "content-disposition":
          purpose === "preview"
            ? "inline"
            : `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`,
        "cache-control":
          purpose === "preview"
            ? "private, max-age=300"
            : "private, no-store",
        "x-content-type-options": "nosniff",
      });
      if (declaredSize > 0) {
        headers.set("content-length", String(declaredSize));
      }
      return { body, headers };
    }

    throw new DomainError("CONTENT_UNAVAILABLE");
  }
}
