import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const samples = JSON.parse(
  await readFile(".private/spike-samples.json", "utf8"),
);
const origin = process.env.APP_ORIGIN ?? "http://127.0.0.1:3000";
const validationToken = process.env.VALIDATION_TOKEN ?? "spike-local-token";

const results = [];

for (const sample of samples) {
  const started = Date.now();
  const response = await fetch(`${origin}/api/parse`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-validation-token": validationToken,
    },
    body: JSON.stringify({ input: sample.input }),
  });
  const payload = await response.json().catch(() => ({}));
  const result = payload.result;
  const parsePassed =
    response.ok &&
    result?.platform === sample.platform &&
    Array.isArray(result.media) &&
    result.media.length > 0;

  let downloadStarted = false;
  let downloadError = null;
  if (parsePassed) {
    const checks = await Promise.all(
      result.media.slice(0, 3).map(async (item) => {
        const mediaResponse = await fetch(
          `${origin}/api/media/${encodeURIComponent(item.token)}?mode=direct`,
          { redirect: "manual" },
        );
        return mediaResponse.status === 307;
      }),
    );
    downloadStarted = checks.every(Boolean);
    if (!downloadStarted) downloadError = "DIRECT_REDIRECT_FAILED";
  }

  results.push({
    id: sample.id,
    platform: sample.platform,
    parsePassed,
    downloadStarted,
    mediaCount: result?.media?.length ?? 0,
    title: result?.title ?? null,
    author: result?.author ?? null,
    cleanSource: result?.media?.[0]?.cleanSource ?? null,
    error: response.ok ? downloadError : payload.error ?? `HTTP_${response.status}`,
    durationMs: Date.now() - started,
  });

  console.log(
    JSON.stringify(results.at(-1)),
  );
}

const summary = {
  generatedAt: new Date().toISOString(),
  total: results.length,
  parsePassed: results.filter((item) => item.parsePassed).length,
  downloadStarted: results.filter((item) => item.downloadStarted).length,
  byPlatform: Object.fromEntries(
    ["douyin", "xiaohongshu"].map((platform) => {
      const rows = results.filter((item) => item.platform === platform);
      return [
        platform,
        {
          total: rows.length,
          parsePassed: rows.filter((item) => item.parsePassed).length,
          downloadStarted: rows.filter((item) => item.downloadStarted).length,
        },
      ];
    }),
  ),
  results,
};

await mkdir("artifacts/validation", { recursive: true });
await writeFile(
  path.join("artifacts/validation", "spike-latest.json"),
  `${JSON.stringify(summary, null, 2)}\n`,
);

console.log(JSON.stringify(summary.byPlatform, null, 2));
if (summary.parsePassed !== summary.total || summary.downloadStarted !== summary.total) {
  process.exitCode = 1;
}
