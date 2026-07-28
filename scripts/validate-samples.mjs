import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const samplesPath = path.resolve(
  process.env.AUTHORIZED_SAMPLES_PATH ??
    ".private/authorized-samples.json",
);
const origin = process.env.APP_ORIGIN ?? "http://127.0.0.1:3000";
const validationToken = process.env.VALIDATION_TOKEN ?? "";

const samples = JSON.parse(await readFile(samplesPath, "utf8"));
for (const platform of ["douyin", "xiaohongshu"]) {
  const count = samples.filter((sample) => sample.platform === platform).length;
  if (count !== 10) {
    throw new Error(`${platform} requires exactly 10 authorized samples; got ${count}`);
  }
}

const results = [];
for (const sample of samples) {
  const startedAt = Date.now();
  const response = await fetch(`${origin}/api/parse`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(validationToken
        ? { "x-validation-token": validationToken }
        : {}),
    },
    body: JSON.stringify({ input: sample.input }),
  });
  const payload = await response.json().catch(() => ({}));
  const result = payload.result;
  const parsePassed =
    response.ok &&
    result?.platform === sample.platform &&
    Array.isArray(result.media) &&
    result.media.length >= sample.expected.minimumMediaCount &&
    result.media.every((item) => item.kind === sample.expected.kind);

  let downloadStarted = false;
  if (parsePassed) {
    const checks = await Promise.all(
      result.media.map(async (item) => {
        const mediaResponse = await fetch(
          `${origin}/api/media/${encodeURIComponent(item.token)}?mode=direct`,
          { redirect: "manual" },
        );
        return mediaResponse.status === 307;
      }),
    );
    downloadStarted = checks.every(Boolean);
  }

  results.push({
    id: sample.id,
    platform: sample.platform,
    parsePassed,
    downloadStarted,
    durationMs: Date.now() - startedAt,
    error: response.ok ? null : payload.error ?? `HTTP_${response.status}`,
    mediaCount: result?.media?.length ?? 0,
    checkedAt: new Date().toISOString(),
  });
}

const byPlatform = Object.fromEntries(
  ["douyin", "xiaohongshu"].map((platform) => {
    const platformResults = results.filter(
      (result) => result.platform === platform,
    );
    return [
      platform,
      {
        total: platformResults.length,
        parsePassed: platformResults.filter((item) => item.parsePassed).length,
        downloadStarted: platformResults.filter(
          (item) => item.downloadStarted,
        ).length,
      },
    ];
  }),
);
const report = {
  generatedAt: new Date().toISOString(),
  byPlatform,
  results,
};

await mkdir("artifacts/validation", { recursive: true });
await writeFile(
  "artifacts/validation/latest.json",
  `${JSON.stringify(report, null, 2)}\n`,
);
await writeFile(
  "artifacts/validation/latest.md",
  [
    "# LinkKeep authorized-sample validation",
    "",
    ...Object.entries(byPlatform).map(
      ([platform, value]) =>
        `- ${platform}: parse ${value.parsePassed}/${value.total}; download start ${value.downloadStarted}/${value.total}`,
    ),
    "",
  ].join("\n"),
);

console.log(JSON.stringify(byPlatform, null, 2));
if (
  Object.values(byPlatform).some(
    (value) => value.parsePassed !== 10 || value.downloadStarted !== 10,
  )
) {
  process.exitCode = 1;
}
