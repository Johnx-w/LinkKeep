import { z } from "zod";

import { getTransientMediaStore } from "@/application/transient-media-store";
import { requireAdmin } from "@/security/admin-request";
import { getStore } from "@/storage/server-store";
import { readLimitedJson, requestErrorResponse } from "@/security/http-request";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const actionSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("set-platform"),
    platform: z.enum(["douyin", "xiaohongshu"]),
    enabled: z.boolean(),
  }),
  z.object({
    action: z.literal("block-post"),
    platform: z.enum(["douyin", "xiaohongshu"]),
    postId: z.string().min(3).max(128),
    reason: z.string().min(3).max(240),
  }),
  z.object({
    action: z.literal("unblock-post"),
    platform: z.enum(["douyin", "xiaohongshu"]),
    postId: z.string().min(3).max(128),
  }),
  z.object({
    action: z.literal("resolve-complaint"),
    complaintId: z.number().int().positive(),
    status: z.enum(["verified", "rejected"]),
  }),
  z.object({
    action: z.literal("resolve-feedback"),
    feedbackId: z.number().int().positive(),
  }),
]);

function unauthorized(error: unknown): Response {
  const code = error instanceof Error ? error.message : "UNAUTHORIZED";
  return Response.json(
    { error: code },
    { status: code === "INVALID_CSRF" ? 403 : 401 },
  );
}

export async function GET(): Promise<Response> {
  try {
    const session = await requireAdmin();
    const store = getStore();
    const month = new Date().toISOString().slice(0, 7);
    return Response.json({
      csrf: session.csrf,
      platforms: store.platformStatuses(),
      complaints: store.listOpenComplaints(),
      feedback: store.listOpenFeedback(),
      blockedPosts: store.blockedPosts(),
      proxyUsage: store.proxyUsage(month),
      metrics: store.recentMetrics(),
    }, { headers: { "cache-control": "private, no-store" } });
  } catch (error) {
    return unauthorized(error);
  }
}

export async function POST(request: Request): Promise<Response> {
  try {
    await requireAdmin(request, true);
  } catch (error) {
    return unauthorized(error);
  }

  let body: unknown;
  try { body = await readLimitedJson(request, 4096); }
  catch (error) { return requestErrorResponse(error); }
  const parsed = actionSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: "INVALID_REQUEST" }, { status: 400 });
  }

  const store = getStore();
  const action = parsed.data;
  switch (action.action) {
    case "resolve-feedback":
      if (!store.resolveFeedback(action.feedbackId)) {
        return Response.json({ error: "CONTENT_UNAVAILABLE" }, { status: 404 });
      }
      break;
    case "set-platform":
      store.setPlatformEnabled(
        action.platform,
        action.enabled,
        action.enabled ? undefined : "manual",
      );
      break;
    case "block-post":
      store.blockPost({
        platform: action.platform,
        postId: action.postId,
        reason: action.reason,
        complaintId: null,
      });
      getTransientMediaStore().deletePost(action.platform, action.postId);
      break;
    case "unblock-post":
      store.unblockPost(action.platform, action.postId);
      break;
    case "resolve-complaint":
      if (action.status === "verified") {
        const complaint = store.getComplaint(action.complaintId);
        if (!complaint) {
          return Response.json(
            { error: "CONTENT_UNAVAILABLE" },
            { status: 404 },
          );
        }
        store.blockPost({
          platform: complaint.platform,
          postId: complaint.postId,
          reason: "verified-copyright-complaint",
          complaintId: complaint.id,
        });
        getTransientMediaStore().deletePost(
          complaint.platform,
          complaint.postId,
        );
      }
      store.resolveComplaint(action.complaintId, action.status);
      break;
  }

  return Response.json({ ok: true });
}
