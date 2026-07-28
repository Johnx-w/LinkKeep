import { readFile, writeFile } from "node:fs/promises";

const html = await readFile("artifacts/validation/douyin-browser.html", "utf8");
const match = html.match(
  /<script[^>]*id="RENDER_DATA"[^>]*>([^<]+)<\/script>/iu,
);
if (!match) throw new Error("missing RENDER_DATA");

const decoded = decodeURIComponent(match[1]);
await writeFile("artifacts/validation/douyin-render-full.json", decoded);
console.log("len", decoded.length);

for (const key of [
  "play_addr",
  "playApi",
  "bit_rate",
  "video_list",
  "aweme_detail",
  "awemeId",
  "videoData",
  "player",
  ".mp4",
  "douyinvod",
  "urlList",
  "url_list",
]) {
  console.log(key, decoded.indexOf(key));
}

const data = JSON.parse(decoded);

function walk(value, depth = 0, path = "root") {
  if (!value || typeof value !== "object" || depth > 10) return;
  const keys = Object.keys(value);
  const interesting = keys.filter((key) =>
    /video|aweme|media|player|detail|note|image|play|bit/iu.test(key),
  );
  if (interesting.length > 0) {
    console.log(path, interesting.join(","));
  }
  for (const [key, child] of Object.entries(value)) {
    walk(child, depth + 1, `${path}.${key}`);
  }
}

walk(data);

const videoSrc = [...html.matchAll(/<video[^>]+src="([^"]+)"/giu)].map(
  (item) => item[1],
);
const anyMp4 = [...decoded.matchAll(/https:\\\/\\\/[^"\\]+|https:\/\/[^"\\s]+/giu)]
  .map((item) => item[0].replaceAll("\\/", "/"))
  .filter((item) => /douyinvod|\.mp4|video/iu.test(item))
  .slice(0, 20);
console.log({ videoSrc: videoSrc.slice(0, 5), anyMp4 });
