import { fileTypeFromBuffer } from "file-type";

import { DomainError } from "@/domain/errors";
import type { MediaKind } from "@/domain/media";

const ALLOWED: Record<MediaKind, ReadonlySet<string>> = {
  image: new Set([
    "image/jpeg",
    "image/png",
    "image/webp",
    "image/gif",
    "image/avif",
    "image/heic",
    "image/heif",
  ]),
  video: new Set(["video/mp4", "video/webm", "video/quicktime"]),
};

export interface ValidatedMediaType {
  mimeType: string;
  extension: string;
}

export async function validateMediaBytes(
  bytes: Uint8Array,
  declaredContentType: string | null,
  expectedKind: MediaKind,
): Promise<ValidatedMediaType> {
  const declared = declaredContentType?.split(";")[0].trim().toLowerCase();
  const detected = await fileTypeFromBuffer(bytes);
  if (!detected || !ALLOWED[expectedKind].has(detected.mime)) {
    throw new DomainError("UNSAFE_MEDIA");
  }

  const declaredOk =
    declared &&
    (ALLOWED[expectedKind].has(declared) ||
      declared === "application/octet-stream" ||
      declared === "binary/octet-stream");

  if (!declaredOk) {
    throw new DomainError("UNSAFE_MEDIA");
  }

  if (
    declared &&
    ALLOWED[expectedKind].has(declared) &&
    declared !== detected.mime
  ) {
    const compatibleJpeg =
      declared === "image/jpg" && detected.mime === "image/jpeg";
    if (!compatibleJpeg) {
      throw new DomainError("UNSAFE_MEDIA");
    }
  }

  return {
    mimeType: detected.mime,
    extension: detected.ext,
  };
}
