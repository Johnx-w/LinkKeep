import { describe, expect, it } from "vitest";

import { validateMediaBytes } from "@/delivery/media-validation";

describe("媒体文件验证", () => {
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
