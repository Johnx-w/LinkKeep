import type { SupportedPlatform } from "@/domain/share-input";

interface MediaFilenameInput {
  platform: SupportedPlatform;
  author?: string;
  title?: string;
  postId: string;
  index: number;
  extension: string;
}

const WINDOWS_RESERVED =
  /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/iu;

function safePart(value: string | undefined, maximum = 36): string {
  if (!value) return "";
  const cleaned = value
    .normalize("NFKC")
    .replace(/[\u0000-\u001f\u007f<>:"/\\|?*]+/gu, "-")
    .replace(/\s+/gu, "-")
    .replace(/[-_.]{2,}/gu, "-")
    .replace(/^[-_.\s]+|[-_.\s]+$/gu, "")
    .slice(0, maximum)
    .replace(/[-_.\s]+$/gu, "");

  if (!cleaned || WINDOWS_RESERVED.test(cleaned)) return "";
  return cleaned;
}

export function mediaFilename(input: MediaFilenameInput): string {
  const author = safePart(input.author);
  const title = safePart(input.title);
  const postId = safePart(input.postId, 48) || "post";
  const extension = input.extension
    .toLowerCase()
    .replace(/[^a-z0-9]/gu, "")
    .slice(0, 8);
  const prefix = [author, title].filter(Boolean);
  if (prefix.length === 0) prefix.push(input.platform);

  const sequence = String(input.index + 1).padStart(2, "0");
  return `${[...prefix, postId, sequence].join("-")}.${extension || "bin"}`;
}
