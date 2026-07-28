import { DomainError } from "@/domain/errors";

export type SupportedPlatform = "douyin" | "xiaohongshu";

export interface ParsedShareInput {
  platform: SupportedPlatform;
  url: string;
}

const URL_PATTERN = /https?:\/\/[^\s<>"'`]+/giu;
const TRAILING_PUNCTUATION = /[),.;!?，。；！？）】》]+$/u;

const platformHosts: Record<SupportedPlatform, readonly string[]> = {
  douyin: ["douyin.com", "iesdouyin.com"],
  xiaohongshu: ["xiaohongshu.com", "xhslink.com"],
};

function isHostOrSubdomain(hostname: string, root: string): boolean {
  return hostname === root || hostname.endsWith(`.${root}`);
}

export function platformForUrl(url: URL): SupportedPlatform | null {
  const hostname = url.hostname.toLowerCase().replace(/\.$/u, "");

  for (const [platform, roots] of Object.entries(platformHosts) as [
    SupportedPlatform,
    readonly string[],
  ][]) {
    if (roots.some((root) => isHostOrSubdomain(hostname, root))) {
      return platform;
    }
  }

  return null;
}

export function parseShareInput(input: string): ParsedShareInput {
  const candidates = input
    .match(URL_PATTERN)
    ?.map((value) => value.replace(TRAILING_PUNCTUATION, "")) ?? [];

  if (candidates.length === 0) {
    throw new DomainError("NO_LINK");
  }

  if (candidates.length > 1) {
    throw new DomainError("MULTIPLE_LINKS");
  }

  let parsed: URL;
  try {
    parsed = new URL(candidates[0]);
  } catch {
    throw new DomainError("UNSUPPORTED_LINK");
  }

  if (
    parsed.protocol !== "https:" ||
    parsed.username ||
    parsed.password ||
    parsed.port
  ) {
    throw new DomainError("UNSAFE_LINK");
  }

  const platform = platformForUrl(parsed);
  if (!platform) {
    throw new DomainError("UNSUPPORTED_LINK");
  }

  parsed.hash = "";

  return {
    platform,
    url: parsed.toString(),
  };
}
