import { DomainError } from "@/domain/errors";
import { getMediaDeliveryService } from "@/delivery/services";

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

  try {
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

    if (mode === "proxy") {
      const result = await service.proxy(token, request.signal);
      return new Response(result.body, {
        status: 200,
        headers: result.headers,
      });
    }

    if (mode === "preview") {
      const result = await service.preview(token, request.signal);
      return new Response(result.body, {
        status: 200,
        headers: result.headers,
      });
    }

    return Response.json({ error: "INVALID_REQUEST" }, { status: 400 });
  } catch (error) {
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
  }
}
