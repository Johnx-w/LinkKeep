import { DomainError } from "@/domain/errors";
import type { PlatformAdapter } from "@/domain/media";
import {
  parseShareInput,
  type SupportedPlatform,
} from "@/domain/share-input";
import type { TransientMediaStore } from "@/application/transient-media-store";

export interface PlatformOperations {
  isPlatformEnabled(platform: SupportedPlatform): boolean;
  isPostBlocked(platform: SupportedPlatform, postId: string): boolean;
  recordPlatformFailure(platform: SupportedPlatform): boolean;
  recordPlatformSuccess(platform: SupportedPlatform): void;
}

interface ParseServiceOptions {
  adapters: PlatformAdapter[];
  mediaStore: TransientMediaStore;
  operations: PlatformOperations;
  timeoutMs?: number;
}

interface RequestContext {
  now?: Date;
  requestId: string;
}

export interface PublicMediaItem {
  id: string;
  index: number;
  kind: "image" | "video";
  token: string;
  expiresAt: string;
  mimeType?: string;
  width?: number;
  height?: number;
  sizeBytes?: number;
  codec?: string;
  durationSeconds?: number;
  livePairId?: string;
  quality: "highest-public" | "platform-distribution" | "unknown";
  cleanSource: boolean | null;
  hasPreview: boolean;
}

export interface PublicParseResult {
  platform: SupportedPlatform;
  postId: string;
  author?: string;
  title?: string;
  sourceAttributionUrl: string;
  parsedAt: string;
  media: PublicMediaItem[];
}

export class ParseService {
  private readonly timeoutMs: number;

  constructor(private readonly options: ParseServiceOptions) {
    this.timeoutMs = options.timeoutMs ?? 25_000;
  }

  async parse(
    input: string,
    context: RequestContext,
  ): Promise<PublicParseResult> {
    const parsedInput = parseShareInput(input);
    if (!this.options.operations.isPlatformEnabled(parsedInput.platform)) {
      throw new DomainError("PLATFORM_DISABLED", "PLATFORM_DISABLED", true);
    }

    const adapter = this.options.adapters.find(
      (candidate) => candidate.platform === parsedInput.platform,
    );
    if (!adapter) {
      throw new DomainError("PLATFORM_DISABLED");
    }

    const now = context.now ?? new Date();
    const abortController = new AbortController();
    const timeout = setTimeout(() => abortController.abort(), this.timeoutMs);

    try {
      const entry = await Promise.race([
        adapter.parse(new URL(parsedInput.url), {
          signal: abortController.signal,
          now,
          requestId: context.requestId,
        }),
        new Promise<never>((_, reject) => {
          abortController.signal.addEventListener(
            "abort",
            () =>
              reject(
                new DomainError("PARSE_TIMEOUT", "PARSE_TIMEOUT", true),
              ),
            { once: true },
          );
        }),
      ]);

      if (
        this.options.operations.isPostBlocked(entry.platform, entry.postId)
      ) {
        throw new DomainError("CONTENT_BLOCKED");
      }

      const media = entry.media.map((item) => {
        const stored = this.options.mediaStore.put(
          {
            platform: entry.platform,
            postId: entry.postId,
            author: entry.author,
            title: entry.title,
            item,
          },
          now,
        );
        return {
          id: item.id,
          index: item.index,
          kind: item.kind,
          token: stored.token,
          expiresAt: stored.expiresAt,
          mimeType: item.source.mimeType,
          width: item.source.width,
          height: item.source.height,
          sizeBytes: item.source.sizeBytes,
          codec: item.source.codec,
          durationSeconds: item.durationSeconds,
          livePairId: item.livePairId,
          quality: item.source.quality,
          cleanSource: item.source.cleanSource,
          hasPreview: Boolean(
            item.thumbnailUrl || item.kind === "image",
          ),
        };
      });

      this.options.operations.recordPlatformSuccess(entry.platform);

      return {
        platform: entry.platform,
        postId: entry.postId,
        author: entry.author,
        title: entry.title,
        sourceAttributionUrl: entry.sourceAttributionUrl,
        parsedAt: entry.parsedAt,
        media,
      };
    } catch (error) {
      if (
        error instanceof DomainError &&
        ["PARSE_FAILED", "PARSE_TIMEOUT"].includes(error.code)
      ) {
        this.options.operations.recordPlatformFailure(parsedInput.platform);
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }
}
