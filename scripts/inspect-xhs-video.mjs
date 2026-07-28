const url =
  "https://www.xiaohongshu.com/discovery/item/6a64702c000000000f01347d?source=webshare&xhsshare=pc_web&xsec_token=ABvuFLvEismVZ7UXYzvczunKNnhi8xDZGsmKrJsFB64e0=&xsec_source=pc_share";

const response = await fetch(url, {
  headers: {
    "user-agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36",
    accept: "text/html",
    "accept-language": "zh-CN,zh;q=0.9",
  },
});
const body = await response.text();
const match = body.match(
  /window\.__INITIAL_STATE__\s*=\s*(\{[\s\S]*?\})\s*(?:<\/script>|;)/u,
);
const state = JSON.parse(match[1].replaceAll("undefined", "null"));
const note = Object.values(state.note.noteDetailMap)[0].note;
console.log({
  type: note.type,
  title: note.title,
  images: note.imageList?.length,
  video: note.video
    ? {
        keys: Object.keys(note.video),
        media: note.video.media,
        consumer: note.video.consumer,
      }
    : null,
});
if (note.video) {
  console.log(JSON.stringify(note.video, null, 2).slice(0, 3000));
}
