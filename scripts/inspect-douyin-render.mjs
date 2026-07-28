import { readFile } from "node:fs/promises";

const html = await readFile("artifacts/validation/douyin-browser.html", "utf8");
const match = html.match(
  /<script[^>]*id="RENDER_DATA"[^>]*>([^<]+)<\/script>/iu,
);
console.log("has render data script", Boolean(match));
if (!match) {
  const idx = html.indexOf("RENDER_DATA");
  console.log("idx", idx);
  console.log(html.slice(idx, idx + 500));
  process.exit(0);
}

const decoded = decodeURIComponent(match[1]);
const data = JSON.parse(decoded);
console.log("top keys", Object.keys(data));
const dump = JSON.stringify(data);
console.log("has play", /play_addr|playApi|bit_rate|video_list|aweme/iu.test(dump));
await import("node:fs/promises").then(({ writeFile }) =>
  writeFile(
    "artifacts/validation/douyin-render-data.json",
    JSON.stringify(data, null, 2).slice(0, 200_000),
  ),
);

function findPaths(value, path = [], hits = []) {
  if (!value || typeof value !== "object") return hits;
  if (Array.isArray(value)) {
    value.forEach((item, index) => findPaths(item, [...path, index], hits));
    return hits;
  }
  for (const [key, child] of Object.entries(value)) {
    if (
      /play_addr|playAddr|bit_rate|download_addr|video_list|images|image_list|aweme_detail/iu.test(
        key,
      )
    ) {
      hits.push({ path: [...path, key].join("."), preview: JSON.stringify(child).slice(0, 400) });
    }
    findPaths(child, [...path, key], hits);
  }
  return hits;
}

console.log(JSON.stringify(findPaths(data).slice(0, 40), null, 2));
