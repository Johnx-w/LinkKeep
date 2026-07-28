import { writeFile, mkdir } from "node:fs/promises";
import { chromium } from "playwright-core";

const exe =
  process.env.PLAYWRIGHT_EXECUTABLE_PATH ||
  "C:\\Users\\Johnson\\AppData\\Local\\ms-playwright\\chromium-1228\\chrome-win64\\chrome.exe";

await mkdir("artifacts/validation", { recursive: true });

async function probeXhs(url) {
  const response = await fetch(url, {
    headers: {
      "user-agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36",
      "accept-language": "zh-CN,zh;q=0.9",
    },
    redirect: "follow",
  });
  const html = await response.text();
  const match = html.match(
    /window\.__INITIAL_STATE__\s*=\s*(\{[\s\S]*?\})\s*(?:<\/script>|;)/u,
  );
  if (!match) {
    console.log(JSON.stringify({ url, error: "no_state", status: response.status }));
    return;
  }
  const state = JSON.parse(match[1].replaceAll("undefined", "null"));
  const note = Object.values(state.note?.noteDetailMap ?? {})[0]?.note;
  const images = (note?.imageList ?? []).map((image, index) => ({
    index,
    width: image.width,
    height: image.height,
    urlDefault: image.urlDefault,
    urlPre: image.urlPre,
    url: image.url,
    infoList: (image.infoList ?? []).map((item) => ({
      scene: item.imageScene,
      url: item.url,
    })),
  }));
  const out = {
    noteId: note?.noteId,
    title: note?.title,
    images,
  };
  await writeFile(
    "artifacts/validation/xhs-image-candidates.json",
    JSON.stringify(out, null, 2),
  );
  console.log(
    JSON.stringify(
      {
        noteId: out.noteId,
        imageCount: images.length,
        first: images[0]
          ? {
              wh: `${images[0].width}x${images[0].height}`,
              scenes: images[0].infoList.map((i) => i.scene),
              defaultHasSize: /\/\d+x\d+|!|\bw\d+\b|quality|format/i.test(
                String(images[0].urlDefault ?? ""),
              ),
              candidates: images[0].infoList.map((i) => ({
                scene: i.scene,
                urlTail: String(i.url ?? "").slice(-80),
              })),
            }
          : null,
      },
      null,
      2,
    ),
  );
}

async function probeDouyin(id) {
  const browser = await chromium.launch({
    executablePath: exe,
    headless: true,
  });
  try {
    const page = await browser.newPage();
    const detailPromise = page.waitForResponse(
      (response) =>
        /\/aweme\/v1\/web\/aweme\/detail\//iu.test(response.url()) &&
        response.ok(),
      { timeout: 15_000 },
    );
    await page.goto(`https://www.douyin.com/video/${id}`, {
      waitUntil: "domcontentloaded",
      timeout: 20_000,
    });
    const detail = await detailPromise;
    const payload = await detail.json();
    const aweme = payload.aweme_detail;
    const video = aweme?.video ?? {};
    const bitRates = Array.isArray(video.bit_rate) ? video.bit_rate : [];
    const summary = {
      id,
      type: aweme?.aweme_type,
      videoWH: `${video.width}x${video.height}`,
      download: (video.download_addr?.url_list ?? []).slice(0, 1),
      play: (video.play_addr?.url_list ?? []).slice(0, 1),
      bitRates: bitRates.map((item) => ({
        bit_rate: item.bit_rate,
        gear: item.gear_name,
        wh: `${item.play_addr?.width ?? item.width}x${item.play_addr?.height ?? item.height}`,
        dataSize: item.play_addr?.data_size ?? item.data_size,
        url: (item.play_addr?.url_list ?? [])[0]?.slice(0, 120),
      })),
      images: Array.isArray(aweme?.images)
        ? aweme.images.slice(0, 2).map((image) => ({
            wh: `${image.width}x${image.height}`,
            download: image.download_url_list?.[0],
            url: image.url_list?.[0],
          }))
        : [],
    };
    await writeFile(
      `artifacts/validation/douyin-quality-${id}.json`,
      JSON.stringify(summary, null, 2),
    );
    console.log(JSON.stringify(summary, null, 2));
  } finally {
    await browser.close();
  }
}

const mode = process.argv[2] ?? "xhs";
if (mode === "xhs") {
  await probeXhs(
    process.argv[3] ??
      "https://www.xiaohongshu.com/explore/6a634c9e000000001d022b0b",
  );
} else {
  await probeDouyin(process.argv[3] ?? "7664631087289065189");
}
