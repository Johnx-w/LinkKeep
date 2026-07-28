import { access } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";

const candidates = [
  process.env.PLAYWRIGHT_EXECUTABLE_PATH,
  path.join(
    homedir(),
    "AppData/Local/ms-playwright/chromium-1228/chrome-win64/chrome.exe",
  ),
  path.join(
    homedir(),
    "AppData/Local/ms-playwright/chromium-1234/chrome-win64/chrome.exe",
  ),
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
].filter((value): value is string => Boolean(value));

export async function resolveChromiumPath(): Promise<string | undefined> {
  for (const candidate of candidates) {
    try {
      await access(candidate);
      return candidate;
    } catch {
      // try next
    }
  }
  return undefined;
}
