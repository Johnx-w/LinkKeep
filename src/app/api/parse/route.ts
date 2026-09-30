import { randomUUID } from "node:crypto";
import { z } from "zod";

import { DomainError } from "@/domain/errors";
import { getParseService } from "@/application/services";
import { getStore } from "@/storage/server-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bodySchema = z.object({
  input: z.string().trim().min(1).max(4_096),
});

function statusFor(error: DomainError): number {
  switch (error.code) {
    case "NO_LINK":
    case "MULTIPLE_LINKS":
    case "UNSUPPORTED_LINK":
    case "UNSAFE_LINK":
      return 400;
    case "CONTENT_RESTRICTED":
    case "CONTENT_UNAVAILABLE":
      return 422;
    case "CONTENT_BLOCKED":
      return 451;
    case "PLATFORM_DISABLED":
      return 503;
    case "PARSE_TIMEOUT":
      return 504;
    default:
      return 502;
  }
}

export async function POST(request: Request): Promise<Response> {
  const requestId = `req_${randomUUID()}`;
  const parsedBody = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsedBody.success) {
    return Response.json(
      { error: "INVALID_REQUEST", requestId },
      { status: 400 },
    );
  }

  const now = new Date();

  try {
    const result = await (await getParseService()).parse(parsedBody.data.input, {
      requestId,
      now,
    });
    getStore().incrementMetric(
      now.toISOString().slice(0, 10),
      result.platform,
      "parse_success",
    );
    return Response.json(
      { result, requestId },
      {
        headers: {
          "cache-control": "no-store",
          "x-content-type-options": "nosniff",
        },
      },
    );
  } catch (error) {
    if (error instanceof DomainError) {
      return Response.json(
        { error: error.code, requestId },
        {
          status: statusFor(error),
          headers: { "cache-control": "no-store" },
        },
      );
    }

    console.error("parse_request_failed", { requestId });
    return Response.json(
      { error: "PARSE_FAILED", requestId },
      { status: 502 },
    );
  }
}
