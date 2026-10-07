import { cookies } from "next/headers";
import { z } from "zod";

import {
  createAdminSession,
  verifyAdminCredentials,
} from "@/security/admin-auth";
import { env } from "@/config/env";
import { clientIp } from "@/security/client-ip";
import { getStore } from "@/storage/server-store";
import { requireAdmin } from "@/security/admin-request";
import { readLimitedJson, requireSameOrigin, requestErrorResponse } from "@/security/http-request";
import {
  createLimitIdentifier,
} from "@/security/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const credentialsSchema = z.object({
  password: z.string().min(12).max(256),
  secondFactor: z.string().min(6).max(128),
});

export async function POST(request: Request): Promise<Response> {
  try {
    requireSameOrigin(request);
    const identifier = createLimitIdentifier(
      clientIp(request),
      new Date(),
      env.DAILY_ID_SECRET,
    );
    const limit = getStore().consumeRate("admin-login", identifier, { hourly: 5, daily: 20 });
    if (!limit.allowed) {
      return Response.json(
        { error: "RATE_LIMITED" },
        {
          status: 429,
          headers: { "retry-after": String(limit.retryAfterSeconds ?? 3600) },
        },
      );
    }

    const body = credentialsSchema.safeParse(
      await readLimitedJson(request, 4096),
    );
    if (
      !body.success ||
      !(await verifyAdminCredentials(
        body.data.password,
        body.data.secondFactor,
      ))
    ) {
      return Response.json({ error: "INVALID_CREDENTIALS" }, { status: 401 });
    }

    const session = await createAdminSession();
    const cookieStore = await cookies();
    cookieStore.set("linkkeep_admin", session.token, {
      httpOnly: true,
      sameSite: "strict",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 2 * 60 * 60,
    });
    return Response.json({ ok: true, csrf: session.csrf });
  } catch (error) { return requestErrorResponse(error); }
}

export async function DELETE(request: Request): Promise<Response> {
  try {
    requireSameOrigin(request);
    await requireAdmin(request, true);
    const cookieStore = await cookies();
    cookieStore.delete("linkkeep_admin");
    return Response.json({ ok: true });
  } catch { return Response.json({ error: "UNAUTHORIZED" }, { status: 403 }); }
}
