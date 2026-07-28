import { randomUUID } from "node:crypto";
import { z } from "zod";

import { DomainError } from "@/domain/errors";
import {
  getParseRateLimiter,
  getParseService,
} from "@/application/services";
import { env } from "@/config/env";
import { clientIp } from "@/security/client-ip";
import { createLimitIdentifier } from "@/security/rate-limit";
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
    case "RATE_LIMITED":
    case "RISK_CHALLENGE_REQUIRED":
      return 429;
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
  const validationRequest =
    Boolean(env.VALIDATION_TOKEN) &&
    request.headers.get("x-validation-token") === env.VALIDATION_TOKEN;
  const identifier = createLimitIdentifier(
    clientIp(request),
    now,
    env.DAILY_ID_SECRET,
  );
  const limit = validationRequest
    ? {
        allowed: true,
        hourlyRemaining: 0,
        dailyRemaining: 0,
        reason: undefined,
        retryAfterSeconds: undefined,
      }
    : getParseRateLimiter().consume(identifier, now);
  if (!limit.allowed) {
    return Response.json(
      {
        error: "RATE_LIMITED",
        reason: limit.reason,
        retryAfterSeconds: limit.retryAfterSeconds,
        requestId,
      },
      {
        status: 429,
        headers: {
          "retry-after": String(limit.retryAfterSeconds ?? 3600),
        },
      },
    );
  }

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
      { result, requestId, limit },
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
