import { z } from "zod";

import { env } from "@/config/env";
import { clientIp } from "@/security/client-ip";
import { readLimitedJson, requireSameOrigin, requestErrorResponse } from "@/security/http-request";
import { createLimitIdentifier } from "@/security/rate-limit";
import { getStore } from "@/storage/server-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const feedbackSchema = z.object({
  message: z.string().trim().min(5).max(4000),
  problemUrl: z.union([
    z.string().trim().url().max(2048).refine((value) => {
      try {
        const url = new URL(value);
        return ["http:", "https:"].includes(url.protocol) && !url.username && !url.password;
      } catch { return false; }
    }),
    z.literal(""),
  ]).default(""),
  contactEmail: z.union([z.string().trim().email().max(254), z.literal("")]).default(""),
  website: z.string().max(0).optional(),
});

export async function POST(request: Request): Promise<Response> {
  try {
    requireSameOrigin(request);
    const now = new Date();
    const identifier = createLimitIdentifier(clientIp(request), now, env.DAILY_ID_SECRET);
    const store = getStore();
    const limit = store.consumeRate("feedback", identifier, { hourly: 3, daily: 5 }, now);
    if (!limit.allowed) {
      return Response.json({ error: "RATE_LIMITED" }, {
        status: 429,
        headers: { "cache-control": "no-store", "retry-after": String(limit.retryAfterSeconds) },
      });
    }
    const parsed = feedbackSchema.safeParse(await readLimitedJson(request, 20 * 1024));
    if (!parsed.success) return Response.json({ error: "INVALID_REQUEST" }, { status: 400 });

    // Keep submitted links as text for the operator; never fetch them from this endpoint.
    const id = store.createFeedback({
      message: parsed.data.message,
      problemUrl: parsed.data.problemUrl,
      contactEmail: parsed.data.contactEmail,
    });
    return Response.json({ ok: true, reference: `feedback-${id}` }, {
      status: 201,
      headers: { "cache-control": "no-store" },
    });
  } catch (error) {
    return requestErrorResponse(error);
  }
}
