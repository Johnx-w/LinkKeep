import { fileTypeFromBuffer } from "file-type";

const allowed = {
  image: new Set(["image/jpeg", "image/png", "image/webp", "image/gif", "image/avif", "image/heic", "image/heif"]),
  video: new Set(["video/mp4", "video/webm", "video/quicktime"]),
};
export async function verifyDownloadStart(origin, item, mode = "proxy") {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30_000);
  let reader;
  try {
    const response = await fetch(origin + "/api/media/" + encodeURIComponent(item.token) + "?mode=" + mode, { signal: controller.signal, redirect: "follow" });
    if (!response.ok || !response.body) return false;
    reader = response.body.getReader();
    let size = 0; const chunks = [];
    while (size < 8192) {
      const part = await reader.read();
      if (part.done) break;
      chunks.push(part.value); size += part.value.byteLength;
    }
    const type = await fileTypeFromBuffer(Buffer.concat(chunks, size));
    const declared = response.headers.get("content-type")?.split(";")[0].toLowerCase();
    return Boolean(type && allowed[item.kind]?.has(type.mime) && (declared === type.mime || declared === "application/octet-stream"));
  } catch { return false; }
  finally { await reader?.cancel().catch(() => undefined); controller.abort(); clearTimeout(timer); }
}
