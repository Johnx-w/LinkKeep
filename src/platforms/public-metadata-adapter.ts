import * as cheerio from "cheerio";

import { DomainError } from "@/domain/errors";
import type {
  MediaItem,
  ParseContext,
  PlatformAdapter,
  ShareEntry,
} from "@/domain/media";
import type { SupportedPlatform } from "@/domain/share-input";

export interface PublicPage {
  finalUrl: string;
  html: string;
}

export type PublicPageLoader = (
  url: URL,
  signal: AbortSignal,
) => Promise<PublicPage>;

interface ExtractedMedia {
  kind: "image" | "video";
  url: string;
  width?: number;
  height?: number;
  mimeType?: string;
  thumbnailUrl?: string;
  durationSeconds?: number;
  livePairId?: string;
  cleanSource?: boolean | null;
  quality?: "highest-public" | "platform-distribution" | "unknown";
}

interface ExtractedEntry {
  title?: string;
  author?: string;
  canonicalUrl?: string;
  media: ExtractedMedia[];
}

function shortText(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.replace(/\s+/gu, " ").trim();
  return normalized ? normalized.slice(0, 240) : undefined;
}

function publicHttpsUrl(value: unknown): string | undefined {
  if (typeof value !== "string" || !value.trim()) return undefined;
  try {
    const candidate = value.startsWith("//") ? `https:${value}` : value;
    const url = new URL(candidate);
    if (url.protocol === "http:") url.protocol = "https:";
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      url.port
    ) {
      return undefined;
    }
    return url.toString();
  } catch {
    return undefined;
  }
}

function isLikelySiteAsset(url: string): boolean {
  return /picasso-static\.xiaohongshu\.com\/fe-platform|favicon|logo/iu.test(
    url,
  );
}

function postIdFor(platform: SupportedPlatform, url: URL): string | null {
  const patterns =
    platform === "douyin"
      ? [/\/(?:video|note|share\/video|share\/note)\/(\d+)/u]
      : [/\/(?:explore|discovery\/item)\/([a-z0-9]+)/iu];

  for (const pattern of patterns) {
    const match = pattern.exec(url.pathname);
    if (match) return match[1];
  }
  return null;
}

function openGraphEntry(html: string): ExtractedEntry {
  const $ = cheerio.load(html);
  const properties = (name: string): string[] =>
    $(`meta[property="${name}"], meta[name="${name}"]`)
      .toArray()
      .map((node) => $(node).attr("content"))
      .map(publicHttpsUrl)
      .filter((value): value is string => Boolean(value));

  const textProperty = (name: string): string | undefined =>
    shortText(
      $(`meta[property="${name}"], meta[name="${name}"]`)
        .first()
        .attr("content"),
    );

  const videoUrls = [
    ...properties("og:video:secure_url"),
    ...properties("og:video"),
  ].filter((url) => !isLikelySiteAsset(url));
  const imageUrls = [
    ...properties("og:image:secure_url"),
    ...properties("og:image"),
  ].filter((url) => !isLikelySiteAsset(url));

  const media: ExtractedMedia[] = [
    ...videoUrls.map((url) => ({
      kind: "video" as const,
      url,
      mimeType: textProperty("og:video:type"),
      thumbnailUrl: imageUrls[0],
    })),
    ...(videoUrls.length > 0
      ? []
      : imageUrls.map((url) => ({ kind: "image" as const, url }))),
  ];

  return {
    title: textProperty("og:title") ?? textProperty("twitter:title"),
    author: textProperty("author"),
    canonicalUrl: properties("og:url")[0],
    media,
  };
}

function xiaohongshuStateEntry(html: string): ExtractedEntry | null {
  const match = html.match(
    /window\.__INITIAL_STATE__\s*=\s*(\{[\s\S]*?\})\s*(?:<\/script>|;)/u,
  );
  if (!match) return null;

  let state: Record<string, unknown>;
  try {
    state = JSON.parse(match[1].replaceAll("undefined", "null")) as Record<
      string,
      unknown
    >;
  } catch {
    return null;
  }

  const noteRoot = state.note as Record<string, unknown> | undefined;
  const detailMap = noteRoot?.noteDetailMap as
    | Record<string, { note?: Record<string, unknown> }>
    | undefined;
  const first = detailMap ? Object.values(detailMap)[0]?.note : undefined;
  if (!first) return null;

  const title = shortText(first.title) ?? shortText(first.desc);
  const user = first.user as Record<string, unknown> | undefined;
  const author = shortText(user?.nickname);
  const noteId = shortText(first.noteId);
  const media: ExtractedMedia[] = [];

  const video = first.video as Record<string, unknown> | undefined;
  if (video) {
    const consumer = video.consumer as Record<string, unknown> | undefined;
    const mediaInfo = video.media as Record<string, unknown> | undefined;
    const stream = mediaInfo?.stream as Record<string, unknown> | undefined;
    const h264 = Array.isArray(stream?.h264) ? stream.h264 : [];
    const h265 = Array.isArray(stream?.h265) ? stream.h265 : [];
    const candidates = [...h264, ...h265] as Record<string, unknown>[];
    candidates.sort((left, right) => compareVideoCandidate(right, left));
    const best = candidates[0];
    const masterUrl =
      publicHttpsUrl(best?.masterUrl) ??
      publicHttpsUrl(consumer?.originVideoKey) ??
      publicHttpsUrl(video.url);
    if (masterUrl) {
      media.push({
        kind: "video",
        url: masterUrl,
        width: Number(best?.width) || undefined,
        height: Number(best?.height) || undefined,
        durationSeconds: Number(video.duration) || undefined,
        mimeType: "video/mp4",
        thumbnailUrl: publicHttpsUrl(
          (Array.isArray(first.imageList)
            ? (first.imageList[0] as Record<string, unknown> | undefined)
                ?.urlDefault
            : undefined) ?? video.cover,
        ),
        quality: "highest-public",
      });
    }
  }

  if (media.length === 0 && Array.isArray(first.imageList)) {
    first.imageList.forEach((raw, index) => {
      const image = raw as Record<string, unknown>;
      const url = pickXiaohongshuImageUrl(image);
      if (!url || isLikelySiteAsset(url)) return;

      const livePairId = image.livePhoto
        ? `${noteId}-live-${index + 1}`
        : undefined;
      media.push({
        kind: "image",
        url,
        width: Number(image.width) || undefined,
        height: Number(image.height) || undefined,
        livePairId,
        mimeType: /format\/png/iu.test(url)
          ? "image/png"
          : /format\/jpe?g|!\w*_jpe?g_/iu.test(url) || /\.jpe?g(?:\?|$)/iu.test(url)
            ? "image/jpeg"
            : /webp/iu.test(url)
              ? "image/webp"
              : "image/jpeg",
        thumbnailUrl: pickXiaohongshuPreviewUrl(image) ?? url,
        quality: "highest-public",
      });

      const stream = image.stream as Record<string, unknown> | undefined;
      const h264 = Array.isArray(stream?.h264)
        ? (stream.h264 as Record<string, unknown>[])
        : [];
      const liveCandidates = [...h264].sort((left, right) =>
        compareVideoCandidate(right, left),
      );
      const liveUrl =
        publicHttpsUrl(liveCandidates[0]?.masterUrl) ??
        publicHttpsUrl(stream?.url);
      if (livePairId && liveUrl) {
        media.push({
          kind: "video",
          url: liveUrl,
          livePairId,
          mimeType: "video/mp4",
          quality: "highest-public",
        });
      }
    });
  }

  if (media.length === 0) return null;

  return {
    title,
    author,
    canonicalUrl: noteId
      ? `https://www.xiaohongshu.com/explore/${noteId}`
      : undefined,
    media,
  };
}

function urlListCandidates(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value
      .map((item) => publicHttpsUrl(item))
      .filter((url): url is string => Boolean(url));
  }
  if (!value || typeof value !== "object") return [];
  const record = value as Record<string, unknown>;
  const list = Array.isArray(record.url_list)
    ? record.url_list
    : Array.isArray(record.urlList)
      ? record.urlList
      : [];
  return list
    .map((item) => publicHttpsUrl(item))
    .filter((url): url is string => Boolean(url));
}

function firstUrlList(value: unknown): string | undefined {
  const candidates = urlListCandidates(value);
  for (const url of candidates) {
    if (
      !/\/media-(?:video|audio)-/iu.test(url) &&
      !/\.m3u8(?:\?|$)/iu.test(url)
    ) {
      return url;
    }
  }
  return candidates.find((url) => !/\.m3u8(?:\?|$)/iu.test(url)) ?? candidates[0];
}

function urlDimensionScore(url: string): number {
  const match = url.match(/:(\d{2,5}):(\d{2,5})(?::|\?|\.|$)/u);
  if (!match) return 0;
  return Number(match[1]) * Number(match[2]);
}

function playAddrMeta(value: unknown): {
  url?: string;
  width: number;
  height: number;
  dataSize: number;
} {
  if (!value || typeof value !== "object") {
    return { width: 0, height: 0, dataSize: 0 };
  }
  const record = value as Record<string, unknown>;
  return {
    url: firstUrlList(record),
    width: Number(record.width) || 0,
    height: Number(record.height) || 0,
    dataSize: Number(record.data_size ?? record.dataSize) || 0,
  };
}

function compareVideoCandidate(
  left: Record<string, unknown>,
  right: Record<string, unknown>,
): number {
  const leftPlay = playAddrMeta(left.play_addr ?? left.playAddr);
  const rightPlay = playAddrMeta(right.play_addr ?? right.playAddr);
  const leftPixels =
    (Number(left.width) || leftPlay.width) *
    (Number(left.height) || leftPlay.height);
  const rightPixels =
    (Number(right.width) || rightPlay.width) *
    (Number(right.height) || rightPlay.height);
  if (leftPixels !== rightPixels) return leftPixels - rightPixels;

  const leftSize =
    leftPlay.dataSize ||
    Number(left.data_size ?? left.dataSize ?? left.videoBitrate ?? 0);
  const rightSize =
    rightPlay.dataSize ||
    Number(right.data_size ?? right.dataSize ?? right.videoBitrate ?? 0);
  if (leftSize !== rightSize) return leftSize - rightSize;

  return (
    Number(left.bit_rate ?? left.videoBitrate ?? 0) -
    Number(right.bit_rate ?? right.videoBitrate ?? 0)
  );
}

function pickDouyinImageUrl(image: Record<string, unknown>): string | undefined {
  const candidates = [
    ...urlListCandidates(image.download_url_list),
    ...urlListCandidates(image.url_list),
    publicHttpsUrl(image.url),
  ].filter((url): url is string => Boolean(url));

  if (candidates.length === 0) return undefined;

  const declared =
    (Number(image.width) || 0) * (Number(image.height) || 0);

  const score = (url: string): number => {
    const dims = urlDimensionScore(url);
    let value = dims * 10;
    if (declared > 0 && dims >= declared * 0.95) value += declared * 10;
    if (dims === 0 && declared > 0) value += 1;
    if (/\.jpe?g(?:\?|$)/iu.test(url)) value += 50;
    if (/\.png(?:\?|$)/iu.test(url)) value += 40;
    if (/\.webp(?:\?|$)/iu.test(url)) value += 10;
    // Clean-source is a secondary preference only when resolution ties.
    if (!/water/iu.test(url)) value += 5;
    return value;
  };

  return [...candidates].sort((left, right) => score(right) - score(left))[0];
}

function pickDouyinPreviewUrl(image: Record<string, unknown>): string | undefined {
  const candidates = [
    ...urlListCandidates(image.url_list),
    ...urlListCandidates(image.download_url_list),
    publicHttpsUrl(image.url),
  ].filter((url): url is string => Boolean(url));
  if (candidates.length === 0) return undefined;

  const score = (url: string): number => {
    let value = 0;
    if (/q75|aweme-images(?!-v2)/iu.test(url)) value += 50;
    if (!/water/iu.test(url)) value += 20;
    if (/\.webp(?:\?|$)/iu.test(url)) value += 10;
    // Prefer smaller declared dimensions for grid thumbnails.
    const dims = urlDimensionScore(url);
    if (dims > 0) value -= Math.min(40, Math.floor(dims / 200_000));
    return value;
  };

  return [...candidates].sort((left, right) => score(right) - score(left))[0];
}

function pickXiaohongshuImageUrl(
  image: Record<string, unknown>,
): string | undefined {
  const infoList = Array.isArray(image.infoList)
    ? (image.infoList as Record<string, unknown>[])
    : [];
  const candidates: { url: string; scene?: string; rank: number }[] = [];

  const fileId =
    typeof image.fileId === "string" && image.fileId.trim()
      ? image.fileId.trim()
      : undefined;
  const traceId =
    typeof image.traceId === "string" && image.traceId.trim()
      ? image.traceId.trim()
      : undefined;
  const assetId =
    fileId ??
    traceId ??
    String(image.urlDefault ?? "").match(/\/([0-9a-z]+)(?:!|\?|$)/iu)?.[1];

  if (assetId) {
    for (const host of [
      "sns-img-qc.xhscdn.com",
      "sns-img-hw.xhscdn.com",
      "sns-img-bd.xhscdn.com",
    ]) {
      const origin = publicHttpsUrl(`https://${host}/${assetId}`);
      if (origin) candidates.push({ url: origin, scene: "ORIGIN", rank: 2_000 });
      const formatted = publicHttpsUrl(
        `https://${host}/${assetId}?imageView2/2/format/jpg`,
      );
      if (formatted) {
        candidates.push({ url: formatted, scene: "ORIGIN_JPG", rank: 1_500 });
      }
    }
  }

  for (const item of infoList) {
    const url = publicHttpsUrl(item.url);
    if (url) {
      candidates.push({
        url,
        scene: typeof item.imageScene === "string" ? item.imageScene : undefined,
        rank: 0,
      });
    }
  }
  for (const [field, scene] of [
    ["urlDefault", "WB_DFT"],
    ["url", undefined],
    ["urlPre", "WB_PRV"],
  ] as const) {
    const url = publicHttpsUrl(image[field]);
    if (url) candidates.push({ url, scene, rank: 0 });
  }

  const unique = new Map<string, { url: string; scene?: string; rank: number }>();
  for (const candidate of candidates) {
    if (!unique.has(candidate.url)) unique.set(candidate.url, candidate);
  }
  const ranked = [...unique.values()];
  if (ranked.length === 0) return undefined;

  const score = (candidate: {
    url: string;
    scene?: string;
    rank: number;
  }): number => {
    let value = candidate.rank + urlDimensionScore(candidate.url);
    const scene = candidate.scene?.toUpperCase() ?? "";
    if (scene === "ORIGIN") value += 2_000;
    if (scene.includes("DFT") || /!nd_dft_/iu.test(candidate.url)) value += 500;
    if (
      scene.includes("ORG") ||
      scene.includes("ORI") ||
      scene.includes("RAW")
    ) {
      value += 1_000;
    }
    if (scene.includes("PRV") || /!nd_prv_/iu.test(candidate.url)) value -= 500;
    if (/\.jpe?g(?:\?|$|!)/iu.test(candidate.url) || /format\/jpe?g/iu.test(candidate.url)) {
      value += 20;
    }
    if (/\.webp(?:\?|$|!)/iu.test(candidate.url)) value += 5;
    return value;
  };

  const best = ranked.sort((left, right) => score(right) - score(left))[0]?.url;
  return best;
}

function pickXiaohongshuPreviewUrl(
  image: Record<string, unknown>,
): string | undefined {
  const infoList = Array.isArray(image.infoList)
    ? (image.infoList as Record<string, unknown>[])
    : [];
  const byScene = (scene: string): string | undefined => {
    const match = infoList.find(
      (item) =>
        typeof item.imageScene === "string" &&
        item.imageScene.toUpperCase() === scene,
    );
    return publicHttpsUrl(match?.url);
  };

  const fileId =
    typeof image.fileId === "string" && image.fileId.trim()
      ? image.fileId.trim()
      : undefined;
  const traceId =
    typeof image.traceId === "string" && image.traceId.trim()
      ? image.traceId.trim()
      : undefined;
  const assetId =
    fileId ??
    traceId ??
    String(image.urlDefault ?? "").match(/\/([0-9a-z]+)(?:!|\?|$)/iu)?.[1];

  // Prefer stable origin + imageView thumbnail over time-signed urlPre links.
  if (assetId) {
    for (const host of [
      "sns-img-qc.xhscdn.com",
      "sns-img-hw.xhscdn.com",
      "sns-img-bd.xhscdn.com",
    ]) {
      const thumb = publicHttpsUrl(
        `https://${host}/${assetId}?imageView2/2/w/480/format/jpg`,
      );
      if (thumb) return thumb;
    }
  }

  return (
    publicHttpsUrl(image.urlDefault) ??
    byScene("WB_DFT") ??
    publicHttpsUrl(image.urlPre) ??
    byScene("WB_PRV") ??
    publicHttpsUrl(image.url)
  );
}

function douyinAwemeEntry(html: string): ExtractedEntry | null {
  const match = html.match(
    /<script[^>]*id="LINKKEEP_AWEME_DETAIL"[^>]*>([\s\S]*?)<\/script>/iu,
  );
  if (!match) return null;

  try {
    const aweme = JSON.parse(match[1]) as Record<string, unknown>;
    const author = aweme.author as Record<string, unknown> | undefined;
    const video = aweme.video as Record<string, unknown> | undefined;
    const media: ExtractedMedia[] = [];

    const downloadUrl = firstUrlList(video?.download_addr);
    const bitRates = Array.isArray(video?.bit_rate)
      ? ([...video.bit_rate] as Record<string, unknown>[])
      : [];
    bitRates.sort((left, right) => compareVideoCandidate(right, left));
    const bestBitRate = bitRates[0];
    const bestPlay = playAddrMeta(bestBitRate?.play_addr);
    const highestQualityUrl = bestPlay.url;
    const playMeta = playAddrMeta(video?.play_addr);
    const playUrl = playMeta.url;
    // Prefer the highest public resolution/playable gear. download_addr is often
    // a lower-resolution watermark=0 variant and must not win by default.
    const chosenVideo = highestQualityUrl ?? playUrl ?? downloadUrl;
    const chosenFromDownload = Boolean(
      chosenVideo && downloadUrl && chosenVideo === downloadUrl,
    );
    const chosenWidth =
      (highestQualityUrl
        ? bestPlay.width || Number(bestBitRate?.width) || 0
        : 0) ||
      playMeta.width ||
      Number(video?.width) ||
      0;
    const chosenHeight =
      (highestQualityUrl
        ? bestPlay.height || Number(bestBitRate?.height) || 0
        : 0) ||
      playMeta.height ||
      Number(video?.height) ||
      0;

    const awemeType = Number(aweme.aweme_type);
    const playLooksLikeAudio =
      Boolean(playUrl) &&
      (/\.mp3(?:\?|$)/iu.test(playUrl!) || /ies-music/iu.test(playUrl!));
    const isImageNote =
      awemeType === 68 ||
      (Array.isArray(aweme.images) &&
        aweme.images.length > 0 &&
        (!playUrl || playLooksLikeAudio));

    if (!isImageNote && chosenVideo && !playLooksLikeAudio) {
      media.push({
        kind: "video",
        url: chosenVideo,
        mimeType: "video/mp4",
        width: chosenWidth || undefined,
        height: chosenHeight || undefined,
        durationSeconds:
          typeof video?.duration === "number"
            ? video.duration / 1000
            : undefined,
        thumbnailUrl:
          firstUrlList(video?.cover) ?? firstUrlList(video?.origin_cover),
        cleanSource: chosenFromDownload,
        quality: "highest-public",
      });
    }

    if (media.length === 0 && Array.isArray(aweme.images)) {
      for (const raw of aweme.images) {
        const image = raw as Record<string, unknown>;
        const url = pickDouyinImageUrl(image);
        if (!url) continue;
        media.push({
          kind: "image",
          url,
          width: Number(image.width) || undefined,
          height: Number(image.height) || undefined,
          cleanSource: !/water/iu.test(url),
          thumbnailUrl: pickDouyinPreviewUrl(image) ?? url,
          quality: "highest-public",
        });
      }
    }

    if (media.length === 0 && chosenVideo && !playLooksLikeAudio) {
      media.push({
        kind: "video",
        url: chosenVideo,
        mimeType: "video/mp4",
        width: chosenWidth || undefined,
        height: chosenHeight || undefined,
        cleanSource: chosenFromDownload,
        quality: "highest-public",
      });
    }

    if (media.length === 0) return null;

    return {
      title: shortText(aweme.desc),
      author: shortText(author?.nickname),
      media,
    };
  } catch {
    return null;
  }
}

function douyinRenderEntry(html: string): ExtractedEntry | null {
  return douyinAwemeEntry(html);
}

abstract class PublicMetadataAdapter implements PlatformAdapter {
  abstract readonly platform: SupportedPlatform;

  constructor(protected readonly loadPage: PublicPageLoader) {}

  supports(url: URL): boolean {
    return postIdFor(this.platform, url) !== null;
  }

  protected extract(html: string): ExtractedEntry {
    return openGraphEntry(html);
  }

  async parse(url: URL, context: ParseContext): Promise<ShareEntry> {
    const page = await this.loadPage(url, context.signal);
    const finalUrl = new URL(page.finalUrl);
    const postId = postIdFor(this.platform, finalUrl);
    if (!postId) {
      throw new DomainError("CONTENT_UNAVAILABLE");
    }

    const extracted = this.extract(page.html);
    if (extracted.media.length === 0) {
      throw new DomainError("PARSE_FAILED", "PARSE_FAILED", true);
    }

    const media: MediaItem[] = extracted.media.map((item, index) => ({
      id: `${postId}-${index + 1}`,
      index,
      kind: item.kind,
      source: {
        url: item.url,
        mimeType: item.mimeType,
        width: item.width,
        height: item.height,
        quality: item.quality ?? "platform-distribution",
        cleanSource: item.cleanSource ?? null,
      },
      thumbnailUrl: item.thumbnailUrl,
      durationSeconds: item.durationSeconds,
      livePairId: item.livePairId,
    }));

    return {
      platform: this.platform,
      postId,
      canonicalUrl: extracted.canonicalUrl ?? finalUrl.toString(),
      author: extracted.author,
      title: extracted.title,
      sourceAttributionUrl: finalUrl.toString(),
      media,
      parsedAt: context.now.toISOString(),
    };
  }
}

export class DouyinPublicAdapter extends PublicMetadataAdapter {
  readonly platform = "douyin" as const;

  protected override extract(html: string): ExtractedEntry {
    return douyinRenderEntry(html) ?? openGraphEntry(html);
  }
}

export class XiaohongshuPublicAdapter extends PublicMetadataAdapter {
  readonly platform = "xiaohongshu" as const;

  protected override extract(html: string): ExtractedEntry {
    return xiaohongshuStateEntry(html) ?? openGraphEntry(html);
  }
}
