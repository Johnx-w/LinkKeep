import { describe, expect, it } from "vitest";

import {
  DouyinPublicAdapter,
  XiaohongshuPublicAdapter,
  type PublicPageLoader,
} from "@/platforms/public-metadata-adapter";

const context = {
  signal: new AbortController().signal,
  now: new Date("2026-07-27T00:00:00.000Z"),
  requestId: "req_test",
};

describe("公开元数据平台适配器", () => {
  it("读取小红书手机分享页中的新 SSR 数据", async () => {
    const noteId = "65aabbccddeeff0011223344";
    const state = { LAUNCHER_SSR_STORE_PAGE_DATA: { noteData: {
      noteId, type: "video", title: "undefined; 清晰度", user: { nickname: "作者" },
      video: { media: { stream: {
        h264: [{ width: 1920, height: 1080, masterUrl: "https://sns-video.xhscdn.com/1080.mp4" }],
        h265: [{ width: 3840, height: 2160, masterUrl: "https://sns-video.xhscdn.com/2160.mp4" }],
      } } },
    } } };
    const adapter = new XiaohongshuPublicAdapter(async () => ({ finalUrl: `https://www.xiaohongshu.com/discovery/item/${noteId}`, html: `<script>window.__SETUP_SERVER_STATE__=${JSON.stringify(state)};</script>` }));
    const entry = await adapter.parse(new URL(`https://www.xiaohongshu.com/explore/${noteId}`), context);
    expect(entry.title).toBe("undefined; 清晰度");
    expect(entry.media[0].source).toMatchObject({ url: "https://sns-video.xhscdn.com/2160.mp4", width: 3840, height: 2160, codec: "h265" });
  });
  it("抖音默认播放地址比码率列表更高清时选择默认地址，且不会返回推荐帖", async () => {
    const postId = "7450000000000000000";
    const aweme = { aweme_id: postId, video: {
      play_addr: { width: 3840, height: 2160, url_list: ["https://v.douyinvod.com/2160.mp4"] },
      bit_rate: [{ play_addr: { width: 1920, height: 1080, url_list: ["https://v.douyinvod.com/1080.mp4"] } }],
    } };
    const state = { loaderData: { detail: aweme, recommendations: [{ aweme_id: "other-post", video: { play_addr: { width: 7680, height: 4320, url_list: ["https://v.douyinvod.com/wrong.mp4"] } } }] } };
    const adapter = new DouyinPublicAdapter(async () => ({ finalUrl: `https://www.douyin.com/video/${postId}`, html: `<script>window._ROUTER_DATA=${JSON.stringify(state)};</script>` }));
    const entry = await adapter.parse(new URL(`https://www.douyin.com/video/${postId}`), context);
    expect(entry.media[0].source).toMatchObject({ url: "https://v.douyinvod.com/2160.mp4", width: 3840, height: 2160 });
  });
  it("从抖音公开页面 Open Graph 元数据解析视频", async () => {
    const loader: PublicPageLoader = async () => ({
      finalUrl: "https://www.douyin.com/video/7450000000000000000",
      html: `
        <html><head>
          <meta property="og:title" content="夏日记录 - 测试作者" />
          <meta property="og:url" content="https://www.douyin.com/video/7450000000000000000" />
          <meta property="og:video" content="https://www.douyin.com/media/public-video.mp4" />
          <meta property="og:video:type" content="video/mp4" />
          <meta property="og:image" content="https://www.douyin.com/media/cover.jpg" />
        </head></html>`,
    });

    const entry = await new DouyinPublicAdapter(loader).parse(
      new URL("https://v.douyin.com/AbCd12/"),
      context,
    );

    expect(entry).toMatchObject({
      platform: "douyin",
      postId: "7450000000000000000",
      title: "夏日记录 - 测试作者",
      media: [
        {
          kind: "video",
          source: {
            mimeType: "video/mp4",
            quality: "platform-distribution",
          },
        },
      ],
    });
  });

  it("从抖音图文笔记 aweme detail 解析图片列表", async () => {
    const aweme = {
      aweme_type: 68,
      desc: "图文测试",
      author: { nickname: "图文作者" },
      video: {
        play_addr: {
          url_list: [
            "https://lf9-music-east.douyinstatic.com/obj/ies-music-hj/bgm.mp3",
          ],
        },
      },
      images: [
        {
          width: 2160,
          height: 2880,
          download_url_list: [
            "https://p3-pc-sign.douyinpic.com/tos/img~tplv-dy-water-v2:2160:2880.webp",
            "https://p3-pc-sign.douyinpic.com/tos/img~tplv-dy-water-v2:2160:2880.jpeg",
          ],
          url_list: [
            "https://p9-pc-sign.douyinpic.com/tos/img~tplv-dy-aweme-images:q75.jpeg",
          ],
        },
      ],
    };

    const loader: PublicPageLoader = async () => ({
      finalUrl: "https://www.douyin.com/note/7638487192944582833",
      html: `<html><body><script id="LINKKEEP_AWEME_DETAIL" type="application/json">${JSON.stringify(aweme).replace(/<\//gu, "<\\/")}</script></body></html>`,
    });

    const entry = await new DouyinPublicAdapter(loader).parse(
      new URL("https://www.douyin.com/note/7638487192944582833"),
      context,
    );

    expect(entry.media).toHaveLength(1);
    expect(entry).toMatchObject({
      platform: "douyin",
      postId: "7638487192944582833",
      author: "图文作者",
      media: [
        {
          kind: "image",
          source: {
            url: "https://p3-pc-sign.douyinpic.com/tos/img~tplv-dy-water-v2:2160:2880.jpeg",
            width: 2160,
            height: 2880,
            quality: "highest-public",
            cleanSource: false,
          },
        },
      ],
    });
  });

  it("从抖音 aweme detail 选择最高分辨率公开视频而不是低清无水印档", async () => {
    const aweme = {
      aweme_type: 0,
      desc: "清晰度测试",
      author: { nickname: "视频作者" },
      video: {
        width: 2560,
        height: 1440,
        duration: 90_000,
        download_addr: {
          url_list: [
            "https://www.douyin.com/aweme/v1/play/?video_id=demo&ratio=540p&watermark=0",
          ],
        },
        play_addr: {
          url_list: [
            "https://v26-web.douyinvod.com/demo/play-1080.mp4",
          ],
          width: 1920,
          height: 1080,
          data_size: 22_000_000,
        },
        bit_rate: [
          {
            bit_rate: 1_800_000,
            gear_name: "normal_1080_0",
            play_addr: {
              url_list: ["https://v26-web.douyinvod.com/demo/1080.mp4"],
              width: 1920,
              height: 1080,
              data_size: 22_000_000,
            },
          },
          {
            bit_rate: 1_500_000,
            gear_name: "adapt_lowest_1440_1",
            play_addr: {
              url_list: ["https://v26-web.douyinvod.com/demo/1440.mp4"],
              width: 2560,
              height: 1440,
              data_size: 19_000_000,
            },
          },
        ],
        cover: {
          url_list: ["https://p3-pc-sign.douyinpic.com/cover.jpeg"],
        },
      },
    };

    const loader: PublicPageLoader = async () => ({
      finalUrl: "https://www.douyin.com/video/7664631087289065189",
      html: `<html><body><script id="LINKKEEP_AWEME_DETAIL" type="application/json">${JSON.stringify(aweme).replace(/<\//gu, "<\\/")}</script></body></html>`,
    });

    const entry = await new DouyinPublicAdapter(loader).parse(
      new URL("https://www.douyin.com/video/7664631087289065189"),
      context,
    );

    expect(entry.media).toHaveLength(1);
    expect(entry.media[0]).toMatchObject({
      kind: "video",
      source: {
        url: "https://v26-web.douyinvod.com/demo/1440.mp4",
        width: 2560,
        height: 1440,
        quality: "highest-public",
        cleanSource: false,
      },
    });
  });

  it("从小红书公开页面优先选择 WB_DFT 而不是预览图", async () => {
    const loader: PublicPageLoader = async () => ({
      finalUrl:
        "https://www.xiaohongshu.com/explore/65aabbccddeeff0011223344",
      html: `
        <html><head>
          <script>
            window.__INITIAL_STATE__ = {
              "note": {
                "noteDetailMap": {
                  "65aabbccddeeff0011223344": {
                    "note": {
                      "noteId": "65aabbccddeeff0011223344",
                      "title": "清晰度图集",
                      "type": "normal",
                      "user": {"nickname": "测试作者"},
                      "imageList": [
                        {
                          "width": 3840,
                          "height": 5120,
                          "fileId": "notes_pre_post/1040g3k0originasset",
                          "urlDefault": "https://sns-webpic-qc.xhscdn.com/media/default!nd_dft_wlteh_jpg_3",
                          "urlPre": "https://sns-webpic-qc.xhscdn.com/media/preview!nd_prv_wlteh_jpg_3",
                          "infoList": [
                            {
                              "imageScene": "WB_PRV",
                              "url": "https://sns-webpic-qc.xhscdn.com/media/preview!nd_prv_wlteh_jpg_3"
                            },
                            {
                              "imageScene": "WB_DFT",
                              "url": "https://sns-webpic-qc.xhscdn.com/media/default!nd_dft_wlteh_jpg_3"
                            }
                          ]
                        }
                      ]
                    }
                  }
                }
              }
            };
          </script>
        </head></html>`,
    });

    const entry = await new XiaohongshuPublicAdapter(loader).parse(
      new URL(
        "https://www.xiaohongshu.com/explore/65aabbccddeeff0011223344",
      ),
      context,
    );

    expect(entry.media).toHaveLength(1);
    expect(entry.media[0]).toMatchObject({
      kind: "image",
      source: {
        url: "https://sns-img-qc.xhscdn.com/notes_pre_post/1040g3k0originasset",
        width: 3840,
        height: 5120,
        mimeType: "image/jpeg",
        quality: "highest-public",
      },
    });
  });

  it("从小红书公开页面初始状态解析多图", async () => {
    const loader: PublicPageLoader = async () => ({
      finalUrl:
        "https://www.xiaohongshu.com/explore/65aabbccddeeff0011223344",
      html: `
        <html><head>
          <script>
            window.__INITIAL_STATE__ = {
              "note": {
                "noteDetailMap": {
                  "65aabbccddeeff0011223344": {
                    "note": {
                      "noteId": "65aabbccddeeff0011223344",
                      "title": "公开测试图集",
                      "type": "normal",
                      "user": {"nickname": "测试作者"},
                      "imageList": [
                        {
                          "width": 1080,
                          "height": 1440,
                          "urlDefault": "https://sns-webpic-qc.xhscdn.com/media/01.jpg",
                          "livePhoto": false
                        },
                        {
                          "width": 1080,
                          "height": 1440,
                          "urlDefault": "https://sns-webpic-qc.xhscdn.com/media/02.jpg",
                          "livePhoto": false
                        }
                      ]
                    }
                  }
                }
              }
            };
          </script>
        </head></html>`,
    });

    const entry = await new XiaohongshuPublicAdapter(loader).parse(
      new URL(
        "https://www.xiaohongshu.com/explore/65aabbccddeeff0011223344",
      ),
      context,
    );

    expect(entry.media).toHaveLength(2);
    expect(entry).toMatchObject({
      platform: "xiaohongshu",
      postId: "65aabbccddeeff0011223344",
      author: "测试作者",
      title: "公开测试图集",
      media: [{ kind: "image" }, { kind: "image" }],
    });
  });
});
