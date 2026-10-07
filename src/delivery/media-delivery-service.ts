import { DomainError } from "@/domain/errors";
import type { SupportedPlatform } from "@/domain/share-input";
import { mediaFilename } from "@/domain/filename";
import type { TransientMediaStore } from "@/application/transient-media-store";
import { validateMediaBytes } from "@/delivery/media-validation";
import { openPinnedStream } from "@/security/pinned-request";
import { validatePublicMediaUrl } from "@/security/url-guard";

const MAX_MEDIA_BYTES = 300 * 1024 * 1024;
const MAX_PREVIEW_BYTES = 8 * 1024 * 1024;
const MAGIC_BYTES = 8192;

export interface ProxyUsageStore {
  reserveProxyBudget(month: string, maximumBytes: number, rate: number, budget: number): { id: string; maxBytes: number } | null;
  settleProxyBudget(id: string, bytes: number, rate: number): void;
}
interface MediaDeliveryOptions {
  mediaStore: TransientMediaStore;
  usageStore: ProxyUsageStore;
  monthlyBudgetCents: number;
  costPerGbCents: number;
  validateUrl?: typeof validatePublicMediaUrl;
  openStream?: typeof openPinnedStream;
  timeoutMs?: number;
}
export interface ProxyMediaResult { body: ReadableStream<Uint8Array>; headers: Headers; }
type DeliveryPurpose = "download" | "preview";

function platformReferer(platform: SupportedPlatform): string {
  return platform === "douyin" ? "https://www.douyin.com/" : "https://www.xiaohongshu.com/";
}

export class MediaDeliveryService {
  constructor(private readonly options: MediaDeliveryOptions) {}
  async directUrl(token: string, now = new Date()): Promise<string> {
    const stored = this.options.mediaStore.get(token, now);
    if (!stored) throw new DomainError("CONTENT_UNAVAILABLE");
    const validated = await (this.options.validateUrl ?? validatePublicMediaUrl)(stored.item.source.url, stored.platform);
    return validated.url.toString();
  }
  async proxy(token: string, signal: AbortSignal, now = new Date()): Promise<ProxyMediaResult> {
    return this.deliver(token, signal, "download", now);
  }
  async preview(token: string, signal: AbortSignal, now = new Date()): Promise<ProxyMediaResult> {
    return this.deliver(token, signal, "preview", now);
  }
  private async deliver(token: string, signal: AbortSignal, purpose: DeliveryPurpose, now: Date): Promise<ProxyMediaResult> {
    const stored = this.options.mediaStore.get(token, now);
    if (!stored) throw new DomainError("CONTENT_UNAVAILABLE");
    const maximumBytes = purpose === "preview" ? MAX_PREVIEW_BYTES : MAX_MEDIA_BYTES;
    const expectedKind = purpose === "preview" ? "image" : stored.item.kind;
    const candidates = [...new Set((purpose === "preview"
      ? [stored.item.thumbnailUrl, stored.item.kind === "image" ? stored.item.source.url : undefined]
      : [stored.item.source.url]).filter((url): url is string => Boolean(url)))];
    if (!candidates.length) throw new DomainError("CONTENT_UNAVAILABLE");
    const reservation = this.options.usageStore.reserveProxyBudget(now.toISOString().slice(0, 7), maximumBytes, this.options.costPerGbCents, this.options.monthlyBudgetCents);
    if (!reservation) throw new DomainError("PROXY_BUDGET_EXHAUSTED");
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(new Error("MEDIA_TRANSFER_TIMEOUT")), this.options.timeoutMs ?? 180_000);
    timer.unref();
    const relayAbort = () => abort.abort(signal.reason);
    if (signal.aborted) relayAbort(); else signal.addEventListener("abort", relayAbort, { once: true });
    let total = 0;
    let response: Awaited<ReturnType<typeof openPinnedStream>> | undefined;
    let finished = false;
    let streamController: ReadableStreamDefaultController<Uint8Array> | undefined;
    const finish = async () => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      signal.removeEventListener("abort", relayAbort);
      abort.signal.removeEventListener("abort", stop);
      response?.body.destroy();
      this.options.usageStore.settleProxyBudget(reservation.id, total, this.options.costPerGbCents);
      await response?.close();
    };
    const stop = () => {
      if (finished) return;
      streamController?.error(abort.signal.reason ?? new Error("TRANSFER_ABORTED"));
      void finish();
    };
    abort.signal.addEventListener("abort", stop, { once: true });
    const validate = this.options.validateUrl ?? validatePublicMediaUrl;
    const open = this.options.openStream ?? openPinnedStream;
    try {
      let prefixChunks: Uint8Array[] = [];
      let iterator: AsyncIterator<Uint8Array> | undefined;
      let validatedType: Awaited<ReturnType<typeof validateMediaBytes>> | undefined;
      let declaredSize = 0;
      let lastError: unknown;
      for (const startUrl of candidates) {
        try {
          let current = startUrl;
          for (let redirects = 0; redirects <= 3; redirects++) {
            abort.signal.throwIfAborted();
            const validated = await validate(current, stored.platform);
            abort.signal.throwIfAborted();
            response = await open({ url: validated.url, addresses: validated.addresses, signal: abort.signal, headers: {
              accept: "*/*", "user-agent": "Mozilla/5.0 Chrome/128.0.0.0 Safari/537.36", referer: platformReferer(stored.platform),
            } });
            if (response.status >= 300 && response.status < 400) {
              const location = response.headers.get("location");
              response.body.destroy(); await response.close(); response = undefined;
              if (!location || redirects === 3) throw new DomainError("CONTENT_UNAVAILABLE");
              current = new URL(location, validated.url).toString();
              continue;
            }
            if (response.status < 200 || response.status >= 300) throw new DomainError("CONTENT_UNAVAILABLE");
            const length = response.headers.get("content-length");
            if (length && !/^\d+$/.test(length)) throw new DomainError("UNSAFE_MEDIA");
            declaredSize = Number(length ?? "0");
            if (declaredSize > maximumBytes) throw new DomainError("MEDIA_TOO_LARGE");
            if (declaredSize > reservation.maxBytes - total) throw new DomainError("PROXY_BUDGET_EXHAUSTED");
            iterator = response.body[Symbol.asyncIterator]();
            prefixChunks = [];
            let prefixSize = 0;
            while (prefixSize < MAGIC_BYTES) {
              const part = await iterator.next();
              if (part.done) break;
              total += part.value.byteLength;
              if (total > maximumBytes) throw new DomainError("MEDIA_TOO_LARGE");
              if (total > reservation.maxBytes) throw new DomainError("PROXY_BUDGET_EXHAUSTED");
              prefixChunks.push(part.value);
              prefixSize += part.value.byteLength;
            }
            validatedType = await validateMediaBytes(Buffer.concat(prefixChunks, prefixSize), response.headers.get("content-type"), expectedKind);
            break;
          }
          if (!validatedType || !iterator) throw new DomainError("CONTENT_UNAVAILABLE");
          break;
        } catch (error) {
          lastError = error;
          response?.body.destroy(); await response?.close(); response = undefined;
          validatedType = undefined;
          if (purpose !== "preview" || abort.signal.aborted || error instanceof DomainError && ["PROXY_BUDGET_EXHAUSTED", "MEDIA_TOO_LARGE"].includes(error.code)) throw error;
        }
      }
      if (!validatedType || !iterator || !response) throw lastError ?? new DomainError("CONTENT_UNAVAILABLE");
      const source = iterator;
      let sent = 0;
      let position = 0;
      const body = new ReadableStream<Uint8Array>({
        start(controller) { streamController = controller; },
        async pull(controller) {
          if (finished) return;
          try {
            abort.signal.throwIfAborted();
            if (position < prefixChunks.length) {
              const chunk = prefixChunks[position++]; sent += chunk.byteLength; controller.enqueue(chunk); return;
            }
            const part = await source.next();
            if (finished) return;
            if (part.done) {
              if (declaredSize && sent !== declaredSize) throw new DomainError("UNSAFE_MEDIA");
              controller.close(); await finish(); return;
            }
            total += part.value.byteLength;
            sent += part.value.byteLength;
            if (sent > maximumBytes) throw new DomainError("MEDIA_TOO_LARGE");
            if (total > reservation.maxBytes) throw new DomainError("PROXY_BUDGET_EXHAUSTED");
            controller.enqueue(part.value);
          } catch (error) { if (!finished) controller.error(error); await finish(); }
        },
        async cancel() { await finish(); abort.abort(new Error("CLIENT_CANCELLED")); },
      }, { highWaterMark: 0 });
      const filename = mediaFilename({ platform: stored.platform, author: stored.author, title: stored.title, postId: stored.postId, index: stored.item.index, extension: validatedType.extension });
      const headers = new Headers({
        "content-type": validatedType.mimeType,
        "content-disposition": purpose === "preview" ? "inline" : "attachment; filename*=UTF-8''" + encodeURIComponent(filename),
        "cache-control": "private, no-store", "x-content-type-options": "nosniff",
      });
      if (declaredSize) headers.set("content-length", String(declaredSize));
      return { body, headers };
    } catch (error) { await finish(); throw error; }
  }
}
