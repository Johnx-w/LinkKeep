"use client";

import { useState } from "react";

export interface DashboardData {
  csrf: string;
  platforms: {
    platform: "douyin" | "xiaohongshu";
    enabled: boolean;
    failureCount: number;
    disabledReason: string | null;
  }[];
  complaints: {
    id: number;
    platform: "douyin" | "xiaohongshu";
    postId: string;
    contactEmail: string;
    statement: string;
    createdAt: string;
  }[];
  blockedPosts: {
    platform: "douyin" | "xiaohongshu";
    postId: string;
    reason: string;
  }[];
  proxyUsage: { bytes: number; costCents: number };
}

export function AdminDashboard({
  initialData,
}: {
  initialData: DashboardData;
}) {
  const [data, setData] = useState<DashboardData>(initialData);
  const [error, setError] = useState("");

  async function refresh() {
    const response = await fetch("/api/admin/operations", {
      cache: "no-store",
    });
    if (!response.ok) {
      setError("后台会话已失效。");
      return;
    }
    setData((await response.json()) as DashboardData);
  }

  async function action(payload: Record<string, unknown>) {
    if (!data) return;
    const response = await fetch("/api/admin/operations", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-csrf-token": data.csrf,
      },
      body: JSON.stringify(payload),
    });
    if (!response.ok) {
      setError("操作失败，请刷新后重试。");
      return;
    }
    await refresh();
  }

  async function logout() {
    await fetch("/api/admin/session", { method: "DELETE" });
    window.location.reload();
  }

  return (
    <main className="admin-dashboard">
      <header>
        <div>
          <p className="eyebrow">Operator console</p>
          <h1>LinkKeep 运营后台</h1>
        </div>
        <button type="button" onClick={logout}>
          退出登录
        </button>
      </header>
      {error && <p role="alert">{error}</p>}

      <section>
        <h2>平台健康</h2>
        <div className="admin-grid">
          {data.platforms.map((platform) => (
            <article key={platform.platform}>
              <strong>{platform.platform}</strong>
              <p>{platform.enabled ? "运行中" : "已熔断"}</p>
              <p>连续失败：{platform.failureCount}</p>
              <button
                type="button"
                onClick={() =>
                  action({
                    action: "set-platform",
                    platform: platform.platform,
                    enabled: !platform.enabled,
                  })
                }
              >
                {platform.enabled ? "停用平台" : "恢复平台"}
              </button>
            </article>
          ))}
          <article>
            <strong>本月代理</strong>
            <p>{(data.proxyUsage.bytes / 1024 ** 2).toFixed(1)} MB</p>
            <p>估算成本：¥{(data.proxyUsage.costCents / 100).toFixed(2)}</p>
          </article>
        </div>
      </section>

      <section>
        <h2>停止解析帖子</h2>
        <form
          className="admin-inline-form"
          action={(formData) =>
            action({
              action: "block-post",
              platform: formData.get("platform"),
              postId: formData.get("postId"),
              reason: formData.get("reason"),
            })
          }
        >
          <select name="platform">
            <option value="douyin">抖音</option>
            <option value="xiaohongshu">小红书</option>
          </select>
          <input name="postId" placeholder="帖子编号" required />
          <input name="reason" placeholder="核实原因" required />
          <button type="submit">停止解析</button>
        </form>
        <ul className="admin-list">
          {data.blockedPosts.map((post) => (
            <li key={`${post.platform}-${post.postId}`}>
              <span>
                <strong>{post.platform}</strong> {post.postId} · {post.reason}
              </span>
              <button
                type="button"
                onClick={() =>
                  action({
                    action: "unblock-post",
                    platform: post.platform,
                    postId: post.postId,
                  })
                }
              >
                解除
              </button>
            </li>
          ))}
        </ul>
      </section>

      <section>
        <h2>待处理投诉</h2>
        <ul className="admin-list complaints">
          {data.complaints.map((complaint) => (
            <li key={complaint.id}>
              <div>
                <strong>
                  #{complaint.id} · {complaint.platform} · {complaint.postId}
                </strong>
                <p>{complaint.contactEmail}</p>
                <p>{complaint.statement}</p>
              </div>
              <div>
                <button
                  type="button"
                  onClick={() =>
                    action({
                      action: "resolve-complaint",
                      complaintId: complaint.id,
                      status: "verified",
                    })
                  }
                >
                  核实并结案
                </button>
                <button
                  type="button"
                  onClick={() =>
                    action({
                      action: "resolve-complaint",
                      complaintId: complaint.id,
                      status: "rejected",
                    })
                  }
                >
                  驳回
                </button>
              </div>
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}
