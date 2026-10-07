import { z } from "zod";

import { env } from "@/config/env";
import { clientIp } from "@/security/client-ip";
import {
  createLimitIdentifier,
} from "@/security/rate-limit";
import { getStore } from "@/storage/server-store";
import { readLimitedJson, requireSameOrigin, requestErrorResponse } from "@/security/http-request";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const complaintSchema = z.object({
  platform: z.enum(["douyin", "xiaohongshu"]),
  postId: z.string().trim().min(3).max(128),
  contactEmail: z.string().trim().email().max(254),
  statement: z.string().trim().min(20).max(4_000),
  website: z.string().max(0).optional(),
});

export async function POST(request: Request): Promise<Response> {
  try {
    requireSameOrigin(request);
    const now = new Date();
    const identifier = createLimitIdentifier(
      clientIp(request),
      now,
      env.DAILY_ID_SECRET,
    );
    const limit = getStore().consumeRate("copyright", identifier, { hourly: 3, daily: 5 }, now);
    if (!limit.allowed) {
      return Response.json(
        { error: "RATE_LIMITED" },
        { status: 429 },
      );
    }

    const parsed = complaintSchema.safeParse(
      await readLimitedJson(request, 20 * 1024),
    );
    if (!parsed.success) {
      return Response.json({ error: "INVALID_REQUEST" }, { status: 400 });
    }

    const id = getStore().createComplaint({
      platform: parsed.data.platform,
      postId: parsed.data.postId,
      contactEmail: parsed.data.contactEmail,
      statement: parsed.data.statement,
    });
    return Response.json(
      { ok: true, reference: `copyright-${id}` },
      { status: 201 },
    );
  } catch (error) { return requestErrorResponse(error); }
}
