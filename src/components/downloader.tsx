"use client";

import { useMemo, useRef, useState } from "react";

import type {
  PublicMediaItem,
  PublicParseResult,
} from "@/application/parse-service";
import { messages, type Locale } from "@/i18n/messages";

interface ParseResponse {
  result?: PublicParseResult;
  error?: string;
  requestId: string;
}

const errorKey: Record<string, keyof (typeof messages)["zh"]> = {
  MULTIPLE_LINKS: "multiple",
  UNSUPPORTED_LINK: "unsupported",
  UNSAFE_LINK: "unsupported",
  CONTENT_RESTRICTED: "restricted",
  CONTENT_UNAVAILABLE: "restricted",
  CONTENT_BLOCKED: "restricted",
  RATE_LIMITED: "rateLimited",
  PLATFORM_DISABLED: "platformDisabled",
  PARSE_TIMEOUT: "timeout",
};

function bytes(value: number | undefined, locale: Locale): string {
  if (!value) return locale === "zh" ? "大小未知" : "Unknown size";
  return new Intl.NumberFormat(locale === "zh" ? "zh-CN" : "en-US", {
    style: "unit",
    unit: value >= 1024 ** 2 ? "megabyte" : "kilobyte",
    unitDisplay: "short",
    maximumFractionDigits: 1,
  }).format(value / (value >= 1024 ** 2 ? 1024 ** 2 : 1024));
}

function extensionFor(item: PublicMediaItem): string {
  const mime = item.mimeType?.split(";")[0];
  const map: Record<string, string> = {
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
    "image/gif": "gif",
    "image/avif": "avif",
    "video/mp4": "mp4",
    "video/webm": "webm",
    "video/quicktime": "mov",
  };
  return (mime && map[mime]) || (item.kind === "image" ? "jpg" : "mp4");
}

function localFilename(
  result: PublicParseResult,
  item: PublicMediaItem,
): string {
  const safe = (value: string) =>
    value
      .normalize("NFKC")
      .replace(/[\u0000-\u001f\u007f<>:"/\\|?*]+/gu, "-")
      .replace(/\s+/gu, "-")
      .replace(/^[-_.]+|[-_.]+$/gu, "")
      .slice(0, 36);
  const prefix = [result.author, result.title]
    .filter((value): value is string => Boolean(value))
    .map(safe)
    .filter(Boolean);
  if (prefix.length === 0) prefix.push(result.platform);
  return `${prefix.join("-")}-${safe(result.postId)}-${String(item.index + 1).padStart(2, "0")}.${extensionFor(item)}`;
}

function MediaThumb({
  item,
  locale,
}: {
  item: PublicMediaItem;
  locale: Locale;
}) {
  const [failed, setFailed] = useState(false);
  const label =
    item.kind === "image"
      ? locale === "zh"
        ? "图片"
        : "Image"
      : locale === "zh"
        ? "视频"
        : "Video";
  const showPreview = item.hasPreview && !failed;

  return (
    <div
      className={`media-placeholder ${item.kind}${showPreview ? " has-thumb" : ""}`}
    >
      {showPreview ? (
        // eslint-disable-next-line @next/next/no-img-element -- same-origin preview proxy; next/image not needed
        <img
          className="media-thumb"
          src={`/api/media/${encodeURIComponent(item.token)}?mode=preview`}
          alt={`${label} #${item.index + 1}`}
          loading="lazy"
          decoding="async"
          onError={() => setFailed(true)}
        />
      ) : (
        <>
          <span aria-hidden="true">
            {item.kind === "image" ? "IMG" : "VIDEO"}
          </span>
          <strong>{label}</strong>
        </>
      )}
      {item.kind === "video" && showPreview ? (
        <span className="media-thumb-badge" aria-hidden="true">
          VIDEO
        </span>
      ) : null}
    </div>
  );
}

export function Downloader({ locale }: { locale: Locale }) {
  const text = messages[locale];
  const [input, setInput] = useState("");
  const [result, setResult] = useState<PublicParseResult | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [status, setStatus] = useState<
    "idle" | "parsing" | "slow" | "zipping"
  >("idle");
  const [error, setError] = useState<{ code: string; requestId?: string }>();
  const sequence = useRef(0);

  const selectedItems = useMemo(
    () => result?.media.filter((item) => selected.has(item.id)) ?? [],
    [result, selected],
  );

  async function parse() {
    if (!input.trim()) return;
    const current = ++sequence.current;
    setStatus("parsing");
    setError(undefined);
    setResult(null);
    const slowTimer = window.setTimeout(() => {
      if (sequence.current === current) setStatus("slow");
    }, 10_000);

    try {
      const response = await fetch("/api/parse", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ input }),
      });
      const payload = (await response.json()) as ParseResponse;
      if (!response.ok || !payload.result) {
        setError({
          code: payload.error ?? "PARSE_FAILED",
          requestId: payload.requestId,
        });
        return;
      }
      setResult(payload.result);
      setSelected(new Set(payload.result.media.map((item) => item.id)));
    } catch {
      setError({ code: "PARSE_FAILED" });
    } finally {
      window.clearTimeout(slowTimer);
      if (sequence.current === current) setStatus("idle");
    }
  }

  async function paste() {
    try {
      setInput(await navigator.clipboard.readText());
    } catch {
      document.querySelector<HTMLTextAreaElement>("#share-input")?.focus();
    }
  }

  function directDownload(item: PublicMediaItem) {
    const anchor = document.createElement("a");
    anchor.href = `/api/media/${encodeURIComponent(item.token)}?mode=direct`;
    anchor.rel = "noreferrer";
    anchor.download = "";
    anchor.click();
  }

  async function proxyDownload(item: PublicMediaItem) {
    const response = await fetch(
      `/api/media/${encodeURIComponent(item.token)}?mode=proxy`,
    );
    if (!response.ok) {
      const payload = (await response.json().catch(() => ({}))) as {
        error?: string;
      };
      setError({ code: payload.error ?? "PARSE_FAILED" });
      return;
    }
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = result ? localFilename(result, item) : "media";
    anchor.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
  }

  async function downloadSelected() {
    if (!result || selectedItems.length === 0) return;
    if (selectedItems.length === 1) {
      // Douyin/XHS CDN anti-leech rejects browser direct navigation (no platform
      // Referer). Default to server proxy with platform Referer + attachment blob.
      await proxyDownload(selectedItems[0]);
      return;
    }

    if (selectedItems.some((item) => item.kind !== "image")) {
      for (const item of selectedItems) {
        await proxyDownload(item);
      }
      return;
    }

    const knownTotal = selectedItems.reduce(
      (sum, item) => sum + (item.sizeBytes ?? 0),
      0,
    );
    if (knownTotal > 800 * 1024 * 1024) {
      setError({ code: "MEDIA_TOO_LARGE" });
      return;
    }

    setStatus("zipping");
    try {
      const { default: JSZip } = await import("jszip");
      const zip = new JSZip();
      let actualTotal = 0;
      for (const item of selectedItems) {
        const response = await fetch(
          `/api/media/${encodeURIComponent(item.token)}?mode=proxy`,
        );
        if (!response.ok) throw new Error("DOWNLOAD_FAILED");
        const blob = await response.blob();
        actualTotal += blob.size;
        if (actualTotal > 800 * 1024 * 1024) {
          throw new Error("MEDIA_TOO_LARGE");
        }
        zip.file(localFilename(result, item), blob);
      }
      const archive = await zip.generateAsync({ type: "blob" });
      const url = URL.createObjectURL(archive);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `${result.platform}-${result.postId}.zip`;
      anchor.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
    } catch (caught) {
      setError({
        code:
          caught instanceof Error && caught.message === "MEDIA_TOO_LARGE"
            ? "MEDIA_TOO_LARGE"
            : "PARSE_FAILED",
      });
    } finally {
      setStatus("idle");
    }
  }

  const errorMessage =
    error &&
    text[
      errorKey[error.code] ??
        (error.code === "MEDIA_TOO_LARGE"
          ? "mediaTooLarge"
          : error.code === "PROXY_BUDGET_EXHAUSTED"
            ? "proxyUnavailable"
            : "failed")
    ];

  return (
    <>
      <section className="hero">
        <div className="hero-copy">
          <h1>{text.heroTitle}</h1>
          <p>{text.heroDescription}</p>
        </div>
        <div className="parser-card">
          <textarea
            id="share-input"
            value={input}
            onChange={(event) => setInput(event.target.value)}
            placeholder={text.inputPlaceholder}
            aria-label={text.inputLabel}
            rows={4}
            maxLength={4096}
          />
          <div className="input-actions">
            <button className="text-button" type="button" onClick={paste}>
              {text.paste}
            </button>
            <button
              className="text-button"
              type="button"
              onClick={() => {
                setInput("");
                setResult(null);
                setError(undefined);
              }}
            >
              {text.clear}
            </button>
            <button
              className="primary-button"
              type="button"
              disabled={!input.trim() || status !== "idle"}
              onClick={parse}
            >
              {status === "parsing" || status === "slow"
                ? text.parsing
                : text.parse}
            </button>
          </div>
          <p className="support-note">{text.supported}</p>
          {(status === "parsing" || status === "slow") && (
            <div className="progress" role="status" aria-live="polite">
              <span />
              {status === "slow"
                ? locale === "zh"
                  ? "平台响应较慢，仍在处理中…"
                  : "The platform is responding slowly…"
                : text.parsing}
            </div>
          )}
          {errorMessage && (
            <div className="error-panel" role="alert">
              <strong>{errorMessage}</strong>
              <span>{text.retry}</span>
              {error?.requestId && <code>{error.requestId}</code>}
            </div>
          )}
        </div>
        <div className="trust-row" aria-label="Product limits">
          <span>{text.quality}</span>
          <span>{text.ephemeral}</span>
          <span>{text.private}</span>
        </div>
      </section>

      {result && (
        <section className="results" aria-labelledby="results-heading">
          <div className="result-heading">
            <div>
              <p className="eyebrow">
                {result.platform === "douyin" ? "Douyin" : "REDnote"}
              </p>
              <h2 id="results-heading">{result.title ?? text.resultTitle}</h2>
              <p>{result.author}</p>
            </div>
            <a
              href={result.sourceAttributionUrl}
              target="_blank"
              rel="noreferrer"
            >
              {text.source}
            </a>
          </div>
          <div className="selection-bar">
            <label>
              <input
                type="checkbox"
                checked={
                  selected.size > 0 && selected.size === result.media.length
                }
                onChange={(event) =>
                  setSelected(
                    event.target.checked
                      ? new Set(result.media.map((item) => item.id))
                      : new Set(),
                  )
                }
              />
              {text.selectAll}
            </label>
            <button
              className="primary-button"
              type="button"
              disabled={selected.size === 0 || status !== "idle"}
              onClick={downloadSelected}
            >
              {status === "zipping"
                ? text.zipPreparing
                : `${text.downloadSelected} (${selected.size})`}
            </button>
          </div>
          <div className="media-grid">
            {result.media.map((item) => (
              <article className="media-card" key={item.id}>
                <MediaThumb item={item} locale={locale} />
                <div className="media-info">
                  <label>
                    <input
                      type="checkbox"
                      checked={selected.has(item.id)}
                      onChange={(event) => {
                        const next = new Set(selected);
                        if (event.target.checked) next.add(item.id);
                        else next.delete(item.id);
                        setSelected(next);
                      }}
                    />
                    #{item.index + 1}
                  </label>
                  <span>
                    {item.width && item.height
                      ? `${item.width} × ${item.height}`
                      : extensionFor(item).toUpperCase()}
                  </span>
                  <span>{bytes(item.sizeBytes, locale)}</span>
                  <span className="quality-label">
                    {item.cleanSource === true
                      ? text.cleanSource
                      : item.quality === "platform-distribution"
                        ? text.platformVersion
                        : text.noWatermarkUnknown}
                  </span>
                </div>
                <div className="media-actions">
                  <button type="button" onClick={() => proxyDownload(item)}>
                    {text.download}
                  </button>
                  <button type="button" onClick={() => directDownload(item)}>
                    {text.proxy}
                  </button>
                </div>
              </article>
            ))}
          </div>
          <p className="direct-disclosure">{text.directDisclosure}</p>
        </section>
      )}
    </>
  );
}
