import { randomUUID } from "node:crypto";
import { z } from "zod";

import { DomainError } from "@/domain/errors";
import { getParseService } from "@/application/services";
import { getStore } from "@/storage/server-store";
import { recordParseFailure } from "@/storage/diagnostics";
import { parseShareInput, type SupportedPlatform } from "@/domain/share-input";
import { admitRequest } from "@/security/request-admission";
import { readLimitedJson, requireSameOrigin, RequestError, requestErrorResponse } from "@/security/http-request";

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
    case "SERVICE_BUSY":
      return 503;
    case "PARSE_TIMEOUT":
      return 504;
    default:
      return 502;
  }
}

export async function POST(request: Request): Promise<Response> {
  const requestId = `req_${randomUUID()}`;
  const now = new Date();
  let release: (() => void) | undefined;
  let platform: SupportedPlatform | undefined;
  try {
    requireSameOrigin(request);
    release = admitRequest(request, "parse");
    const parsedBody = bodySchema.safeParse(await readLimitedJson(request));
    if (!parsedBody.success) throw new RequestError(400, "INVALID_REQUEST");
    platform = parseShareInput(parsedBody.data.input).platform;
    getStore().incrementMetric(now.toISOString().slice(0, 10), platform, "parse_attempt");
    const result = await (await getParseService()).parse(parsedBody.data.input, {
      requestId,
      now,
      signal: request.signal,
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
    if (platform) getStore().incrementMetric(now.toISOString().slice(0, 10), platform, "parse_failure");
    if (error instanceof RequestError) {
      const response = requestErrorResponse(error);
      return Response.json({ error: error.code, requestId }, { status: response.status, headers: response.headers });
    }
    if (error instanceof DomainError) {
      return Response.json(
        { error: error.code, requestId },
        {
          status: statusFor(error),
          headers: { "cache-control": "no-store" },
        },
      );
    }

    await recordParseFailure(requestId).catch(() => undefined);
    return Response.json(
      { error: "PARSE_FAILED", requestId },
      { status: 502 },
    );
  } finally { release?.(); }
}
