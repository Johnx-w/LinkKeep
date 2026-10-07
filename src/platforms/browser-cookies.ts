import { getSetCookies, Headers as UndiciHeaders } from "undici";
import type { BrowserContext } from "playwright-core";

// Only the isolated anonymous context receives cookies. Never import a user's
// logged-in profile or reuse cookies between parsing requests.
export async function storeBrowserCookies(context: BrowserContext, url: URL, headers: Headers): Promise<void> {
  const cookieHeaders = new UndiciHeaders();
  for (const cookie of headers.getSetCookie()) cookieHeaders.append("set-cookie", cookie);
  const cookies = getSetCookies(cookieHeaders).flatMap((cookie) => {
    const domain = cookie.domain?.toLowerCase().replace(/^\./u, "");
    if (domain && url.hostname !== domain && !url.hostname.endsWith(`.${domain}`)) return [];
    const expires = cookie.maxAge !== undefined
      ? Math.max(1, Date.now() / 1000 + cookie.maxAge)
      : cookie.expires ? new Date(cookie.expires).getTime() / 1000 : -1;
    const defaultPath = url.pathname.slice(0, url.pathname.lastIndexOf("/")) || "/";
    return [{
      name: cookie.name, value: cookie.value,
      domain: domain ? `.${domain}` : url.hostname,
      path: cookie.path?.startsWith("/") ? cookie.path : defaultPath,
      ...(Number.isFinite(expires) ? { expires } : {}),
      secure: cookie.secure ?? false, httpOnly: cookie.httpOnly ?? false,
      ...(cookie.sameSite ? { sameSite: cookie.sameSite } : {}),
    }];
  });
  if (cookies.length) await context.addCookies(cookies);
}
