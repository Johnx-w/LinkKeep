import { cookies } from "next/headers";

import { readAdminSession } from "@/security/admin-auth";
import { requireSameOrigin } from "@/security/http-request";

export async function requireAdmin(
  request?: Request,
  requireCsrf = false,
): Promise<{ csrf: string; expiresAt: number }> {
  const cookieStore = await cookies();
  const session = await readAdminSession(
    cookieStore.get("linkkeep_admin")?.value,
  );
  if (!session) {
    throw new Error("UNAUTHORIZED");
  }
  if (
    requireCsrf &&
    (!request ||
      request.headers.get("x-csrf-token") !== session.csrf ||
      request.headers.get("sec-fetch-site") === "cross-site")
  ) {
    throw new Error("INVALID_CSRF");
  }
  if (requireCsrf && request) requireSameOrigin(request);
  return session;
}
