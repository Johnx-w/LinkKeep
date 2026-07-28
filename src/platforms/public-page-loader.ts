import { chromium } from "playwright-core";

import { DomainError } from "@/domain/errors";
import type {
  PublicPage,
  PublicPageLoader,
} from "@/platforms/public-metadata-adapter";
import {
  validatePublicNetworkUrl,
  validatePublicPlatformUrl,
  type ValidatedPlatformUrl,
} from "@/security/url-guard";
import { pinnedRequest } from "@/security/pinned-request";

const MAX_REDIRECTS = 5;
const MAX_HTML_BYTES = 2 * 1024 * 1024;
const BROWSER_TIMEOUT_MS = 15_000;

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
      "user-agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36",
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

  const browser = await chromium.launch({
    executablePath,
    headless: true,
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

  try {
    const context = await browser.newContext({
      acceptDownloads: false,
      locale: "zh-CN",
      userAgent:
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36",
      serviceWorkers: "block",
    });
    const page = await context.newPage();
    page.setDefaultNavigationTimeout(BROWSER_TIMEOUT_MS);

    let capturedAweme: unknown;

    await page.route("**/*", async (route) => {
      const requestUrl = new URL(route.request().url());
      if (!["http:", "https:"].includes(requestUrl.protocol)) {
        await route.abort();
        return;
      }
      try {
        await validatePublicNetworkUrl(requestUrl);
        await route.continue();
      } catch (error) {
        // Private/internal targets stay blocked; transient DNS failures are allowed
        // so the page can still finish its own public media bootstrap.
        if (
          error instanceof DomainError &&
          (error.code === "UNSAFE_LINK" || error.code === "UNSUPPORTED_LINK")
        ) {
          await route.abort();
          return;
        }
        await route.continue();
      }
    });

    const detailPromise = page.waitForResponse(
      (response) =>
        /\/aweme\/v1\/web\/aweme\/detail\//iu.test(response.url()) &&
        response.ok(),
      { timeout: 12_000 },
    );

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
      const detailResponse = await Promise.race([
        detailPromise,
        signalPromise(signal),
      ]);
      try {
        const payload = (await detailResponse.json()) as {
          aweme_detail?: unknown;
        };
        if (payload.aweme_detail) capturedAweme = payload.aweme_detail;
      } catch {
        // Ignore non-JSON bodies.
      }
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
