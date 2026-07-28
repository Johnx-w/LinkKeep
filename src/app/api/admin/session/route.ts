import { cookies } from "next/headers";
import { z } from "zod";

import {
  createAdminSession,
  verifyAdminCredentials,
} from "@/security/admin-auth";
import { env } from "@/config/env";
import { clientIp } from "@/security/client-ip";
import {
  createLimitIdentifier,
  MemoryParseRateLimiter,
} from "@/security/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const credentialsSchema = z.object({
  password: z.string().min(12).max(256),
  secondFactor: z.string().min(6).max(128),
});

const loginLimiter = new MemoryParseRateLimiter({ hourly: 5, daily: 20 });

export async function POST(request: Request): Promise<Response> {
  const identifier = createLimitIdentifier(
    clientIp(request),
    new Date(),
    env.DAILY_ID_SECRET,
  );
  const limit = loginLimiter.consume(identifier);
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
    await request.json().catch(() => null),
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
}

export async function DELETE(): Promise<Response> {
  const cookieStore = await cookies();
  cookieStore.delete("linkkeep_admin");
  return Response.json({ ok: true });
}
