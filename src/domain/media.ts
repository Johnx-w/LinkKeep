import type { SupportedPlatform } from "@/domain/share-input";

export type MediaKind = "image" | "video";
export type QualityLabel =
  | "highest-public"
  | "platform-distribution"
  | "unknown";

export interface MediaSource {
  url: string;
  mimeType?: string;
  width?: number;
  height?: number;
  sizeBytes?: number;
  codec?: string;
  expiresAt?: string;
  quality: QualityLabel;
  cleanSource: boolean | null;
}

export interface MediaItem {
  id: string;
  index: number;
  kind: MediaKind;
  source: MediaSource;
  thumbnailUrl?: string;
  durationSeconds?: number;
  livePairId?: string;
}

export interface ShareEntry {
  platform: SupportedPlatform;
  postId: string;
  canonicalUrl: string;
  author?: string;
  title?: string;
  sourceAttributionUrl: string;
  media: MediaItem[];
  parsedAt: string;
}

export interface ParseContext {
  signal: AbortSignal;
  now: Date;
  requestId: string;
}

export interface PlatformAdapter {
  readonly platform: SupportedPlatform;
  supports(url: URL): boolean;
  parse(url: URL, context: ParseContext): Promise<ShareEntry>;
}
