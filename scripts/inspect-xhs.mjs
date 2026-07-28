const url =
  "https://www.xiaohongshu.com/discovery/item/6a4fcc81000000000f0073f3?source=webshare&xhsshare=pc_web&xsec_token=ABlaEO0MMd53TmaLumi5C5B2RQXj84ezKtZfJzu6-JZ00=&xsec_source=pc_share";

const response = await fetch(url, {
  headers: {
    "user-agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36",
    accept: "text/html",
    "accept-language": "zh-CN,zh;q=0.9",
  },
});
const body = await response.text();

const og = [...body.matchAll(/property="(og:[^"]+)"[^>]*content="([^"]+)"/giu)].map(
  (match) => [match[1], match[2]],
);
console.log("og", og.slice(0, 30));

const match = body.match(
  /window\.__INITIAL_STATE__\s*=\s*(\{[\s\S]*?\})\s*(?:<\/script>|;)/u,
);
if (!match) {
  console.log("no state");
  process.exit(0);
}

const state = JSON.parse(match[1].replaceAll("undefined", "null"));
console.log("top", Object.keys(state));
if (state.note?.noteDetailMap) {
  const first = Object.values(state.note.noteDetailMap)[0];
  console.log(JSON.stringify(first, null, 2).slice(0, 4000));
} else if (state.noteDetailMap) {
  const first = Object.values(state.noteDetailMap)[0];
  console.log(JSON.stringify(first, null, 2).slice(0, 4000));
} else {
  console.log("note keys", state.note && Object.keys(state.note));
}
