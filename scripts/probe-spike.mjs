import { readFile, mkdir, writeFile } from "node:fs/promises";

const samples = JSON.parse(
  await readFile(".private/spike-samples.json", "utf8"),
);

const results = [];

async function probe(url) {
  const response = await fetch(url, {
    redirect: "manual",
    headers: {
      "user-agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36",
      accept: "text/html,application/xhtml+xml",
      "accept-language": "zh-CN,zh;q=0.9",
    },
  });
  return {
    status: response.status,
    location: response.headers.get("location"),
    contentType: response.headers.get("content-type"),
    body:
      response.status >= 300 && response.status < 400
        ? ""
        : (await response.text()).slice(0, 4000),
  };
}

function extractUrl(input) {
  const match = input.match(/https?:\/\/[^\s<>"'`]+/iu);
  return match?.[0]?.replace(/[),.;!?，。；！？）】》]+$/u, "") ?? null;
}

for (const sample of samples) {
  const url = extractUrl(sample.input);
  const item = {
    id: sample.id,
    platform: sample.platform,
    url,
    hops: [],
    ogVideo: false,
    ogImage: false,
    jsonLd: false,
    renderData: false,
    error: null,
  };

  try {
    let current = url;
    for (let i = 0; i < 6; i++) {
      const page = await probe(current);
      item.hops.push({
        url: current,
        status: page.status,
        location: page.location,
        contentType: page.contentType,
      });
      if (page.status >= 300 && page.status < 400 && page.location) {
        current = new URL(page.location, current).toString();
        continue;
      }
      item.finalUrl = current;
      item.ogVideo = /og:video/iu.test(page.body);
      item.ogImage = /og:image/iu.test(page.body);
      item.jsonLd = /application\/ld\+json/iu.test(page.body);
      item.renderData =
        /window\.__INITIAL_STATE__|window\._ROUTER_DATA|RENDER_DATA|__NEXT_DATA__/iu.test(
          page.body,
        );
      item.snippet = page.body
        .replace(/\s+/gu, " ")
        .slice(0, 500);
      break;
    }
  } catch (error) {
    item.error = error instanceof Error ? error.message : String(error);
  }

  results.push(item);
  console.log(
    JSON.stringify({
      id: item.id,
      status: item.hops.at(-1)?.status,
      finalUrl: item.finalUrl,
      ogVideo: item.ogVideo,
      ogImage: item.ogImage,
      jsonLd: item.jsonLd,
      renderData: item.renderData,
      error: item.error,
    }),
  );
}

await mkdir("artifacts/validation", { recursive: true });
await writeFile(
  "artifacts/validation/probe-spike.json",
  `${JSON.stringify(results, null, 2)}\n`,
);
