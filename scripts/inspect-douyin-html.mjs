import { readFile } from "node:fs/promises";

const html = await readFile("artifacts/validation/douyin-browser.html", "utf8");

console.log({
  videoTags: [...html.matchAll(/<video[\s\S]{0,500}>/giu)].slice(0, 5),
  mp4: [...html.matchAll(/https:[^"'\\\s>]+\.mp4[^"'\\\s>]*/giu)].slice(0, 10),
  vod: [...html.matchAll(/https:[^"'\\\s>]*douyinvod[^"'\\\s>]*/giu)].slice(0, 10),
  blob: html.includes("blob:"),
  source: [...html.matchAll(/<source[^>]+>/giu)].slice(0, 10),
});

// Look for JSON API payloads embedded later
const apiHints = [
  "aweme/detail",
  "aweme/v1",
  "itemInfo",
  "videoDetail",
  "pageService",
  "loaderData",
  "hydrate",
];
for (const hint of apiHints) {
  console.log(hint, html.indexOf(hint));
}
