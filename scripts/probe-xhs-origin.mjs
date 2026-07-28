import { writeFile } from "node:fs/promises";

const url =
  process.argv[2] ??
  "https://www.xiaohongshu.com/discovery/item/6a64702c000000000f01347d?source=webshare&xhsshare=pc_web&xsec_token=ABvuFLvEismVZ7UXYzvczunKNnhi8xDZGsmKrJsFB64e0=&xsec_source=pc_share";

const response = await fetch(url, {
  headers: {
    "user-agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36",
    "accept-language": "zh-CN,zh;q=0.9",
  },
});
const html = await response.text();
const match = html.match(
  /window\.__INITIAL_STATE__\s*=\s*(\{[\s\S]*?\})\s*(?:<\/script>|;)/u,
);
if (!match) {
  console.log(JSON.stringify({ error: "no_state", status: response.status }));
  process.exit(1);
}
const state = JSON.parse(match[1].replaceAll("undefined", "null"));
const note = Object.values(state.note?.noteDetailMap ?? {})[0]?.note;
const img = note.imageList[0];
const traceId = img.traceId;
const fileId = img.fileId;
const fromDefault = String(img.urlDefault ?? "").match(
  /\/([0-9a-z]+)(?:!|\?|$)/iu,
)?.[1];

const candidates = [
  [
    "ci-trace-jpg",
    traceId &&
      `https://ci.xiaohongshu.com/${traceId}?imageView2/2/format/jpg`,
  ],
  [
    "ci-file-full",
    fileId &&
      `https://ci.xiaohongshu.com/${fileId}?imageView2/2/format/jpg`,
  ],
  [
    "ci-file-base",
    fileId &&
      `https://ci.xiaohongshu.com/${String(fileId).split("/").pop()}?imageView2/2/format/jpg`,
  ],
  [
    "hw-file-full",
    fileId &&
      `https://sns-img-hw.xhscdn.com/${fileId}?imageView2/2/format/jpg`,
  ],
  [
    "hw-file-base",
    fileId &&
      `https://sns-img-hw.xhscdn.com/${String(fileId).split("/").pop()}?imageView2/2/format/jpg`,
  ],
  [
    "bd-file-full",
    fileId &&
      `https://sns-img-bd.xhscdn.com/${fileId}?imageView2/2/format/jpg`,
  ],
  [
    "qc-file-full",
    fileId &&
      `https://sns-img-qc.xhscdn.com/${fileId}`,
  ],
  [
    "ci-fromdef",
    fromDefault &&
      `https://ci.xiaohongshu.com/${fromDefault}?imageView2/2/format/jpg`,
  ],
  [
    "strip-bang",
    img.urlDefault && String(img.urlDefault).replace(/!.+$/u, ""),
  ],
  ["default", img.urlDefault],
].filter(([, value]) => Boolean(value));

const rows = [];
for (const [label, candidate] of candidates) {
  try {
    const head = await fetch(candidate, {
      method: "HEAD",
      headers: {
        Referer: "https://www.xiaohongshu.com/",
        "user-agent": "Mozilla/5.0",
      },
      redirect: "follow",
    });
    const get = await fetch(candidate, {
      method: "GET",
      headers: {
        Referer: "https://www.xiaohongshu.com/",
        "user-agent": "Mozilla/5.0",
        Range: "bytes=0-15",
      },
      redirect: "follow",
    });
    const buf = Buffer.from(await get.arrayBuffer());
    rows.push({
      label,
      headStatus: head.status,
      getStatus: get.status,
      type: get.headers.get("content-type"),
      len: head.headers.get("content-length"),
      magic: buf.slice(0, 4).toString("hex"),
      urlTail: candidate.slice(-90),
    });
  } catch (error) {
    rows.push({ label, error: String(error) });
  }
}

const out = {
  noteId: note.noteId,
  wh: `${img.width}x${img.height}`,
  traceId,
  fileId,
  fromDefault,
  rows,
};
await writeFile(
  "artifacts/validation/xhs-origin-candidates.json",
  JSON.stringify(out, null, 2),
);
console.log(JSON.stringify(out, null, 2));
