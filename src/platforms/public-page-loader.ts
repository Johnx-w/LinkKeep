import { chromium } from "playwright-core";

import { DomainError } from "@/domain/errors";
import type {
  PublicPage,
  PublicPageLoader,
} from "@/platforms/public-metadata-adapter";
import {
  validatePublicPlatformUrl,
  type ValidatedPlatformUrl,
} from "@/security/url-guard";
import { pinnedRequest } from "@/security/pinned-request";
import { fetchBrowserResource, createBrowserRequestDependencies } from "@/platforms/browser-request";
import { storeBrowserCookies } from "@/platforms/browser-cookies";

const MAX_REDIRECTS = 5;
const MAX_HTML_BYTES = 2 * 1024 * 1024;
const BROWSER_TIMEOUT_MS = 45_000;
const DESKTOP_USER_AGENT = `Mozilla/5.0 (${process.platform === "win32" ? "Windows NT 10.0; Win64; x64" : "X11; Linux x86_64"}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36`;
const MOBILE_USER_AGENT = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";

export interface PageResponse {
  status: number;
  headers: Headers;
  body: string;
}

export type PageRequester = (
  url: URL,
  addresses: string[],
  signal: AbortSignal,
) => Promise<PageResponse>;

export type BrowserRenderer = (
  url: URL,
  signal: AbortSignal,
) => Promise<PublicPage>;

type ValidateUrl = (
  value: string | URL,
) => Promise<ValidatedPlatformUrl>;

function containsPublicMetadata(html: string): boolean {
  return /(?:property|name)=["'](?:og:(?:video|image)|twitter:(?:player|image))["']|application\/ld\+json|window\.__INITIAL_STATE__|id=["']RENDER_DATA["']/iu.test(
    html,
  );
}

const defaultRequester: PageRequester = async (url, addresses, signal) => {
  const response = await pinnedRequest({
    url,
    addresses,
    signal,
    maximumBytes: MAX_HTML_BYTES,
    headers: {
      accept: "text/html,application/xhtml+xml",
      "accept-language": "zh-CN,zh;q=0.9,en;q=0.5",
      "user-agent": url.hostname.endsWith("xiaohongshu.com") ? MOBILE_USER_AGENT : DESKTOP_USER_AGENT,
    },
  });

  const body =
    response.status >= 300 && response.status < 400
      ? ""
      : new TextDecoder().decode(response.body);

  return {
    status: response.status,
    headers: response.headers,
    body,
  };
};

function signalPromise(signal: AbortSignal): Promise<never> {
  return new Promise((_, reject) => {
    if (signal.aborted) { reject(new DOMException("Aborted", "AbortError")); return; }
    signal.addEventListener(
      "abort",
      () => reject(new DOMException("Aborted", "AbortError")),
      { once: true },
    );
  });
}

export const standardBrowserRenderer: BrowserRenderer = async (
  url,
  signal,
) => {
  const executablePath = process.env.PLAYWRIGHT_EXECUTABLE_PATH;
  if (!executablePath) {
    throw new DomainError("PARSE_FAILED", "PARSE_FAILED", true);
  }
  signal.throwIfAborted();
  const initial = await validatePublicPlatformUrl(url);
  const requestDependencies = createBrowserRequestDependencies(initial);
  signal.throwIfAborted();
  const browser = await chromium.launch({
    executablePath,
    headless: true,
    chromiumSandbox: true,
    timeout: BROWSER_TIMEOUT_MS,
    args: [
      "--disable-background-networking",
      "--disable-breakpad",
      "--disable-component-update",
      "--disable-dev-shm-usage",
      "--disable-extensions",
      "--disable-sync",
      "--no-first-run",
    ],
  });
  const resources = new AbortController();
  const pendingResources = new Set<() => void>();
  const wakeResources = () => {
    for (const resolve of pendingResources) resolve();
    pendingResources.clear();
  };
  const closeOnAbort = () => { resources.abort(); wakeResources(); void browser.close(); };
  signal.addEventListener("abort", closeOnAbort, { once: true });
  try {
    signal.throwIfAborted();
    const context = await browser.newContext({
      acceptDownloads: false,
      locale: "zh-CN",
      userAgent: initial.platform === "xiaohongshu" ? MOBILE_USER_AGENT : DESKTOP_USER_AGENT,
      serviceWorkers: "block",
    });
    await context.routeWebSocket("**/*", (socket) => socket.close());
    const page = await context.newPage();
    page.setDefaultNavigationTimeout(BROWSER_TIMEOUT_MS);

    let capturedAweme: unknown;

    let remainingBytes = 32 * 1024 * 1024;
    let requests = 0;
    let active = 0;
    await context.route("**/*", async (route) => {
      const request = route.request();
      const navigation = request.isNavigationRequest();
      if (resources.signal.aborted || !["GET", "HEAD"].includes(request.method()) || ["image", "media", "font"].includes(request.resourceType()) || navigation && request.frame() !== page.mainFrame() || ++requests > 300) {
        await route.abort().catch(() => undefined); return;
      }
      // Share the actual byte budget across requests. Reserving each resource's
      // 8 MiB maximum would serialize many small scripts before they are read.
      while (!resources.signal.aborted && active >= 8) {
        await new Promise<void>((resolve) => pendingResources.add(resolve));
      }
      if (resources.signal.aborted || remainingBytes <= 0) { await route.abort().catch(() => undefined); return; }
      const allowance = Math.min(8 * 1024 * 1024, remainingBytes);
      active++;
      try {
        const response = await fetchBrowserResource(new URL(request.url()), resources.signal, allowance, navigation, initial.platform, requestDependencies, {
          headers: await request.allHeaders(),
          cookiesFor: async (target) => (await context.cookies(target.toString())).map((cookie) => `${cookie.name}=${cookie.value}`).join("; "),
          storeCookies: (target, headers) => storeBrowserCookies(context, target, headers),
          onBytes: (bytes) => {
            remainingBytes -= bytes;
            if (remainingBytes < 0) throw new DomainError("MEDIA_TOO_LARGE");
          },
        });
        await route.fulfill(response);
      } catch { await route.abort().catch(() => undefined); }
      finally { active--; wakeResources(); }
    });

    const expectedPostId = /\/(?:video|note)\/(\d+)/u.exec(url.pathname)?.[1];
    const detailPromise = page.waitForResponse(
      async (response) => {
        if (!/\/aweme\/v1\/web\/aweme\/detail\//iu.test(response.url()) || !response.ok()) return false;
        try {
          const payload = await response.json() as { aweme_detail?: { aweme_id?: string } };
          if (!payload.aweme_detail || expectedPostId && String(payload.aweme_detail.aweme_id) !== expectedPostId) return false;
          capturedAweme = payload.aweme_detail;
          return true;
        } catch { return false; }
      },
      { timeout: BROWSER_TIMEOUT_MS },
    ).catch(() => null);

    await Promise.race([
      page.goto(
        url.pathname.includes("/note/")
          ? url.toString().replace("/note/", "/video/")
          : url.toString(),
        {
          waitUntil: "domcontentloaded",
          timeout: BROWSER_TIMEOUT_MS,
        },
      ),
      signalPromise(signal),
    ]);

    try {
      await Promise.race([
        detailPromise,
        signalPromise(signal),
      ]);
    } catch {
      // Detail endpoint may not appear for every page; continue without capture.
    }

    const finalUrl = page.url();
    if (capturedAweme) {
      // Keep only the captured payload. Full Douyin DOM often exceeds the HTML
      // budget and page.content() can throw while the SPA keeps navigating.
      const payload = JSON.stringify(capturedAweme).replaceAll(
        "</",
        "<\\/",
      );
      const html = `<!doctype html><html><head><script type="application/json" id="LINKKEEP_AWEME_DETAIL">${payload}</script></head><body></body></html>`;
      if (Buffer.byteLength(html, "utf8") > MAX_HTML_BYTES) {
        throw new DomainError("PARSE_FAILED");
      }
      return { finalUrl, html };
    }

    let html = "";
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        html = await page.content();
        break;
      } catch {
        await page.waitForTimeout(250);
      }
    }
    if (!html) {
      throw new DomainError("PARSE_FAILED", "PARSE_FAILED", true);
    }

    if (Buffer.byteLength(html, "utf8") > MAX_HTML_BYTES) {
      throw new DomainError("PARSE_FAILED");
    }

    return {
      finalUrl,
      html,
    };
  } finally {
    signal.removeEventListener("abort", closeOnAbort);
    resources.abort();
    wakeResources();
    await browser.close();
  }
};

export function createPublicPageLoader(options?: {
  requester?: PageRequester;
  browserRenderer?: BrowserRenderer;
  validate?: ValidateUrl;
}): PublicPageLoader {
  const requester = options?.requester ?? defaultRequester;
  const browserRenderer = options?.browserRenderer;
  const validate = options?.validate ?? validatePublicPlatformUrl;

  return async (startUrl, signal) => {
    let current = startUrl;
    let initialPlatform: string | undefined;

    for (let redirectCount = 0; redirectCount <= MAX_REDIRECTS; redirectCount++) {
      const validated = await validate(current);
      initialPlatform ??= validated.platform;
      if (validated.platform !== initialPlatform) {
        throw new DomainError("UNSAFE_LINK");
      }

      // Douyin posts require the browser detail response. Loading the same SPA
      // once through HTTP first can spend the parse deadline on unused HTML.
      if (browserRenderer && validated.platform === "douyin" && /^\/(?:video|note)\/\d+\/?$/u.test(validated.url.pathname)) {
        const rendered = await browserRenderer(validated.url, signal);
        const finalValidated = await validate(rendered.finalUrl);
        if (finalValidated.platform !== initialPlatform) throw new DomainError("UNSAFE_LINK");
        if (/^\/(?:login|signin)(?:\/|$)/iu.test(finalValidated.url.pathname)) throw new DomainError("CONTENT_RESTRICTED");
        return rendered;
      }

      const response = await requester(
        validated.url,
        validated.addresses,
        signal,
      );

      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get("location");
        if (!location || redirectCount === MAX_REDIRECTS) {
          throw new DomainError("PARSE_FAILED", "PARSE_FAILED", true);
        }
        current = new URL(location, validated.url);
        continue;
      }

      if (response.status === 401 || response.status === 403) {
        throw new DomainError("CONTENT_RESTRICTED");
      }
      if (response.status === 404 || response.status === 410) {
        throw new DomainError("CONTENT_UNAVAILABLE");
      }
      if (response.status < 200 || response.status >= 300) {
        throw new DomainError("PARSE_FAILED", "PARSE_FAILED", true);
      }

      const contentType = response.headers.get("content-type") ?? "";
      if (!contentType.toLowerCase().includes("text/html")) {
        throw new DomainError("PARSE_FAILED");
      }

      const page = {
        finalUrl: validated.url.toString(),
        html: response.body,
      };
      if (/^\/(?:login|signin)(?:\/|$)/iu.test(validated.url.pathname)) throw new DomainError("CONTENT_RESTRICTED");
      const needsBrowser =
        Boolean(browserRenderer) &&
        (validated.platform === "douyin" ||
          !containsPublicMetadata(page.html));
      if (!needsBrowser) {
        return page;
      }

      const rendered = await browserRenderer!(validated.url, signal);
      const finalValidated = await validate(rendered.finalUrl);
      if (finalValidated.platform !== initialPlatform) {
        throw new DomainError("UNSAFE_LINK");
      }
      return rendered;
    }

    throw new DomainError("PARSE_FAILED", "PARSE_FAILED", true);
  };
}
