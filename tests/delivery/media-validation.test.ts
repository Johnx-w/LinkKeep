import { describe, expect, it } from "vitest";

import { validateMediaBytes } from "@/delivery/media-validation";

describe("媒体文件验证", () => {
  it("保留原图 CDN 声明为 JPEG 的真实 HEIC，不转换或改写扩展名", async () => {
    const heic = Buffer.from("000000186674797068656963000000006d69663168656963", "hex");
    await expect(validateMediaBytes(heic, "image/jpeg", "image")).resolves.toEqual({ mimeType: "image/heic", extension: "heic" });
    await expect(validateMediaBytes(heic, "video/mp4", "image")).rejects.toThrowError("UNSAFE_MEDIA");
  });

  it("接受文件签名与声明一致的 JPEG", async () => {
    const jpeg = Uint8Array.from([
      0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00,
      0x01, 0xff, 0xd9,
    ]);

    await expect(
      validateMediaBytes(jpeg, "image/jpeg", "image"),
    ).resolves.toMatchObject({ extension: "jpg", mimeType: "image/jpeg" });
  });

  it("拒绝伪装成图片的 HTML", async () => {
    await expect(
      validateMediaBytes(
        new TextEncoder().encode("<html><script>alert(1)</script></html>"),
        "image/jpeg",
        "image",
      ),
    ).rejects.toThrowError("UNSAFE_MEDIA");
  });

  it("拒绝 SVG", async () => {
    await expect(
      validateMediaBytes(
        new TextEncoder().encode("<svg xmlns='http://www.w3.org/2000/svg'/>"),
        "image/svg+xml",
        "image",
      ),
    ).rejects.toThrowError("UNSAFE_MEDIA");
  });
});
