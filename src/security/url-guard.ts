import { lookup } from "node:dns/promises";
import ipaddr from "ipaddr.js";

import { DomainError } from "@/domain/errors";
import {
  platformForUrl,
  type SupportedPlatform,
} from "@/domain/share-input";

export type ResolveHost = (hostname: string) => Promise<string[]>;

const resolveHost: ResolveHost = async (hostname) => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const results = await Promise.race([
      lookup(hostname, { all: true, verbatim: true }),
      new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("DNS_TIMEOUT")), 5000); }),
    ]);
    return results.map(({ address }) => address);
  } finally { clearTimeout(timer); }
};

const mediaHostRoots: Record<SupportedPlatform, readonly string[]> = {
  douyin: [
    "douyin.com",
    "iesdouyin.com",
    "douyinvod.com",
    // Additional host observed in Douyin's public aweme detail URL list.
    // Keep this specific alias; do not permit arbitrary zjcdn.com hosts.
    "v5-dy-ov-experiment.zjcdn.com",
    "douyinpic.com",
    "douyinstatic.com",
    "byteimg.com",
    "bytecdn.cn",
    "ibyteimg.com",
    "bytescm.com",
  ],
  xiaohongshu: [
    "xiaohongshu.com",
    "xhscdn.com",
    "xhscdn.net",
    "xhsimg.com",
  ],
};

function isPublicAddress(address: string): boolean {
  try {
    return ipaddr.process(address).range() === "unicast";
  } catch {
    return false;
  }
}

export async function validatePublicNetworkUrl(
  value: string | URL,
  resolve: ResolveHost = resolveHost,
): Promise<{ url: URL; addresses: string[] }> {
  const url = typeof value === "string" ? new URL(value) : new URL(value);

  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.port
  ) {
    throw new DomainError("UNSAFE_LINK");
  }

  let addresses: string[];
  try {
    addresses = await resolve(url.hostname);
  } catch {
    throw new DomainError("PARSE_FAILED", "PARSE_FAILED", true);
  }

  if (addresses.length === 0 || addresses.some((ip) => !isPublicAddress(ip))) {
    throw new DomainError("UNSAFE_LINK");
  }

  return { url, addresses };
}

export interface ValidatedPlatformUrl {
  url: URL;
  platform: SupportedPlatform;
  addresses: string[];
}

export async function validatePublicPlatformUrl(
  value: string | URL,
  resolve: ResolveHost = resolveHost,
): Promise<ValidatedPlatformUrl> {
  const network = await validatePublicNetworkUrl(value, resolve);
  const { url } = network;

  const platform = platformForUrl(url);
  if (!platform) {
    throw new DomainError("UNSUPPORTED_LINK");
  }

  return { url, platform, addresses: network.addresses };
}

export async function validatePublicMediaUrl(
  value: string | URL,
  platform: SupportedPlatform,
  resolve: ResolveHost = resolveHost,
): Promise<{ url: URL; addresses: string[] }> {
  const network = await validatePublicNetworkUrl(value, resolve);
  const hostname = network.url.hostname.toLowerCase().replace(/\.$/u, "");
  const allowed = mediaHostRoots[platform].some(
    (root) => hostname === root || hostname.endsWith(`.${root}`),
  );
  if (!allowed) {
    throw new DomainError("UNSAFE_MEDIA");
  }
  return network;
}
