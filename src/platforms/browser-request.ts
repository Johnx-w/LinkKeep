import { DomainError } from "@/domain/errors";
import { pinnedRequest } from "@/security/pinned-request";
import { validatePublicNetworkUrl, validatePublicPlatformUrl, type ResolveHost, type ValidatedPlatformUrl } from "@/security/url-guard";

export interface BrowserResourceSession {
  headers: Record<string, string>;
  cookiesFor(url: URL): Promise<string>;
  storeCookies(url: URL, headers: Headers): Promise<void>;
  onBytes?: (bytes: number) => void;
}

export function createBrowserRequestDependencies(initial: ValidatedPlatformUrl, resolver: ResolveHost = async (hostname) =>
  (await validatePublicNetworkUrl(new URL(`https://${hostname}/`))).addresses,
) {
  // One anonymous rendering pins each host once. Hundreds of scripts from the
  // same CDN must not queue hundreds of blocking OS DNS lookups in Docker.
  const hosts = new Map<string, Promise<string[]>>([[initial.url.hostname, Promise.resolve(initial.addresses)]]);
  const resolve: ResolveHost = (hostname) => {
    let addresses = hosts.get(hostname);
    if (!addresses) { addresses = resolver(hostname); hosts.set(hostname, addresses); }
    return addresses;
  };
  return {
    validateNetwork: (url: string | URL) => validatePublicNetworkUrl(url, resolve),
    validatePlatform: (url: string | URL) => validatePublicPlatformUrl(url, resolve),
    request: pinnedRequest,
  };
}

// The browser never makes its own DNS lookup or follows an unchecked redirect.
export async function fetchBrowserResource(url: URL, signal: AbortSignal, maximumBytes: number, navigation: boolean, platform: string, dependencies = {
  validateNetwork: validatePublicNetworkUrl,
  validatePlatform: validatePublicPlatformUrl,
  request: pinnedRequest,
}, session?: BrowserResourceSession) {
  let current = url;
  for (let redirects = 0; redirects <= 5; redirects++) {
    signal.throwIfAborted();
    const validated = navigation ? await dependencies.validatePlatform(current) : await dependencies.validateNetwork(current);
    if ("platform" in validated && validated.platform !== platform) throw new DomainError("UNSAFE_LINK");
    signal.throwIfAborted();
    const headers: Record<string, string> = {
      accept: session?.headers.accept ?? "*/*", "accept-language": session?.headers["accept-language"] ?? "zh-CN,zh;q=0.9,en;q=0.5", "accept-encoding": "identity",
      "user-agent": session?.headers["user-agent"] ?? "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36",
    };
    for (const name of ["sec-ch-ua", "sec-ch-ua-mobile", "sec-ch-ua-platform"]) {
      const value = session?.headers[name];
      if (value) headers[name] = value;
    }
    // Douyin's anonymous detail request binds this browser identifier to its
    // public session. Keep it on the official site and never forward it off-site.
    if (validated.url.hostname === "douyin.com" || validated.url.hostname.endsWith(".douyin.com")) {
      const uifid = session?.headers.uifid;
      if (uifid) headers.uifid = uifid;
    }
    for (const name of ["referer", "origin"]) {
      const value = session?.headers[name];
      if (!value) continue;
      try {
        const parsed = new URL(value);
        if (parsed.protocol === "https:" && !parsed.username && !parsed.password) headers[name] = value;
      } catch { /* Ignore a malformed browser referrer. */ }
    }
    const cookie = await session?.cookiesFor(validated.url);
    if (cookie) headers.cookie = cookie;
    const response = await dependencies.request({
      url: validated.url, addresses: validated.addresses, signal, maximumBytes,
      headers, onBytes: session?.onBytes,
    });
    await session?.storeCookies(validated.url, response.headers);
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location || redirects === 5) throw new DomainError("UNSAFE_LINK");
      current = new URL(location, validated.url);
      continue;
    }
    const responseHeaders: Record<string, string> = {};
    response.headers.forEach((value, key) => {
      if (!["set-cookie", "connection", "transfer-encoding", "keep-alive"].includes(key)) responseHeaders[key] = value;
    });
    return { status: response.status, headers: responseHeaders, body: Buffer.from(response.body) };
  }
  throw new DomainError("UNSAFE_LINK");
}
