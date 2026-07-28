import { readFile } from "node:fs/promises";

const samples = JSON.parse(await readFile(".private/spike-samples.json", "utf8"));
const origin = process.env.APP_ORIGIN ?? "http://127.0.0.1:3000";
const token = process.env.VALIDATION_TOKEN ?? "spike-local-token";
const platformFilter = process.argv[2];

for (const sample of samples) {
  if (platformFilter && sample.platform !== platformFilter) continue;
  const started = Date.now();
  const response = await fetch(`${origin}/api/parse`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-validation-token": token,
    },
    body: JSON.stringify({ input: sample.input }),
  });
  const payload = await response.json();
  if (!response.ok) {
    console.log(
      JSON.stringify({
        id: sample.id,
        error: payload.error,
        ms: Date.now() - started,
      }),
    );
    continue;
  }

  const media = payload.result.media[0];
  const direct = await fetch(
    `${origin}/api/media/${encodeURIComponent(media.token)}?mode=direct`,
    { redirect: "manual" },
  );
  const location = direct.headers.get("location");
  let headLen = null;
  let headStatus = null;
  if (location) {
    try {
      const head = await fetch(location, {
        method: "HEAD",
        headers: {
          "user-agent": "Mozilla/5.0",
          referer:
            sample.platform === "douyin"
              ? "https://www.douyin.com/"
              : "https://www.xiaohongshu.com/",
        },
      });
      headStatus = head.status;
      headLen = Number(head.headers.get("content-length") || 0);
    } catch (error) {
      headStatus = String(error);
    }
  }

  console.log(
    JSON.stringify({
      id: sample.id,
      kind: media.kind,
      count: payload.result.media.length,
      wh: `${media.width ?? "?"}x${media.height ?? "?"}`,
      quality: media.quality,
      clean: media.cleanSource,
      sizeMB: headLen ? Number((headLen / 1024 / 1024).toFixed(2)) : null,
      headStatus,
      host: location ? new URL(location).host : null,
      ms: Date.now() - started,
    }),
  );
}
