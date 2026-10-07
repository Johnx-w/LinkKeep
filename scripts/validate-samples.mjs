import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { verifyDownloadStart } from "./download-check.mjs";

const samplesPath = path.resolve(
  process.env.AUTHORIZED_SAMPLES_PATH ??
    ".private/authorized-samples.json",
);
const origin = process.env.APP_ORIGIN ?? "http://127.0.0.1:3000";
const validationToken = process.env.VALIDATION_TOKEN ?? "";
const dynamic = process.argv.includes("--dynamic");
if (validationToken.length < 43) throw new Error("A configured operator VALIDATION_TOKEN is required");

const samples = JSON.parse(await readFile(samplesPath, "utf8"));
for (const platform of ["douyin", "xiaohongshu"]) {
  const count = samples.filter((sample) => sample.platform === platform).length;
  if ((!dynamic && count !== 10) || (dynamic && count < 10)) {
    throw new Error(`${platform} requires exactly 10 authorized samples; got ${count}`);
  }
}
if (samples.some((sample) => !sample.authorization || !sample.lastConfirmedPublicAt || sample.input.includes("REPLACE_WITH"))) throw new Error("Every sample needs authorization and current public-access confirmation");

const results = [];
for (const sample of samples) {
  const startedAt = Date.now();
  try {
    const response = await fetch(`${origin}/api/parse`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: new URL(origin).origin,
        ...(validationToken
          ? { "x-validation-token": validationToken }
          : {}),
      },
      body: JSON.stringify({ input: sample.input }),
        signal: AbortSignal.timeout(75_000),
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
      const checks = [];
      for (const item of result.media) checks.push(await verifyDownloadStart(origin, item, "proxy"));
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
  } catch {
    results.push({ id: sample.id, platform: sample.platform, parsePassed: false, downloadStarted: false, durationMs: Date.now() - startedAt, error: "VALIDATION_REQUEST_FAILED", mediaCount: 0, checkedAt: new Date().toISOString() });
  }
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
  sampleType: dynamic ? "dynamic" : "fixed",
  byPlatform,
  results,
};

await mkdir("artifacts/validation", { recursive: true });
await writeFile(
  dynamic ? "artifacts/validation/dynamic-latest.json" : "artifacts/validation/latest.json",
  `${JSON.stringify(report, null, 2)}\n`,
);
await writeFile(
  dynamic ? "artifacts/validation/dynamic-latest.md" : "artifacts/validation/latest.md",
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
    (value) => dynamic ? value.parsePassed / value.total < 0.9 || !value.parsePassed || value.downloadStarted / value.parsePassed < 0.95 : value.parsePassed !== 10 || value.downloadStarted !== 10,
  )
) {
  process.exitCode = 1;
}
