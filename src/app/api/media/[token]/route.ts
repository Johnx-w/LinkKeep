import { DomainError } from "@/domain/errors";
import { getMediaDeliveryService } from "@/delivery/services";
import { getStore } from "@/storage/server-store";
import { getTransientMediaStore } from "@/application/transient-media-store";
import { admitRequest } from "@/security/request-admission";
import { RequestError, requestErrorResponse } from "@/security/http-request";
import type { SupportedPlatform } from "@/domain/share-input";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ token: string }>;
}

function errorStatus(error: DomainError): number {
  switch (error.code) {
    case "CONTENT_UNAVAILABLE":
      return 410;
    case "MEDIA_TOO_LARGE":
      return 413;
    case "PROXY_BUDGET_EXHAUSTED":
      return 503;
    case "UNSAFE_MEDIA":
      return 422;
    default:
      return 502;
  }
}

export async function GET(
  request: Request,
  context: RouteContext,
): Promise<Response> {
  const { token } = await context.params;
  if (!/^[A-Za-z0-9_-]{43}$/u.test(token)) {
    return Response.json({ error: "CONTENT_UNAVAILABLE" }, { status: 404 });
  }

  const mode = new URL(request.url).searchParams.get("mode") ?? "direct";
  const service = getMediaDeliveryService();
  let release: (() => void) | undefined;
  let attemptedPlatform: SupportedPlatform | undefined;
  const day = new Date().toISOString().slice(0, 10);
  try {
    if (!["direct", "proxy", "preview"].includes(mode)) throw new RequestError(400, "INVALID_REQUEST");
    const stored = getTransientMediaStore().get(token);
    if (!stored) throw new DomainError("CONTENT_UNAVAILABLE");
    if (getStore().isPostBlocked(stored.platform, stored.postId)) throw new DomainError("CONTENT_UNAVAILABLE");
    if (mode === "proxy") {
      attemptedPlatform = stored.platform;
      getStore().incrementMetric(day, stored.platform, "download_attempt");
    }
    release = admitRequest(request, "media", token);
    if (mode === "direct") {
      const location = await service.directUrl(token);
      return new Response(null, {
        status: 307,
        headers: {
          location,
          "cache-control": "private, no-store",
          "referrer-policy": "no-referrer",
        },
      });
    }

    if (mode === "proxy" || mode === "preview") {
      const result = mode === "proxy" ? await service.proxy(token, request.signal) : await service.preview(token, request.signal);
      const reader = result.body.getReader();
      const finish = release;
      release = undefined;
      let started = false;
      const body = new ReadableStream<Uint8Array>({
        async pull(controller) {
          try {
            const part = await reader.read();
            if (part.done) { controller.close(); finish?.(); return; }
            if (!started && mode === "proxy") { started = true; getStore().incrementMetric(day, stored.platform, "download_started"); }
            controller.enqueue(part.value);
          } catch (error) { controller.error(error); finish?.(); if (mode === "proxy") getStore().incrementMetric(day, stored.platform, "download_failure"); }
        },
        async cancel(reason) { try { await reader.cancel(reason); } finally { finish?.(); } },
      }, { highWaterMark: 0 });
      return new Response(body, {
        status: 200,
        headers: result.headers,
      });
    }

    return Response.json({ error: "INVALID_REQUEST" }, { status: 400 });
  } catch (error) {
    if (attemptedPlatform) getStore().incrementMetric(day, attemptedPlatform, "download_failure");
    if (error instanceof RequestError) return requestErrorResponse(error);
    if (error instanceof DomainError) {
      return Response.json(
        { error: error.code },
        {
          status: errorStatus(error),
          headers: { "cache-control": "no-store" },
        },
      );
    }
    return Response.json({ error: "PARSE_FAILED" }, { status: 502 });
  } finally { release?.(); }
}
