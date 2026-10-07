import { mkdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";

import type { SupportedPlatform } from "@/domain/share-input";

interface BlockPostInput {
  platform: SupportedPlatform;
  postId: string;
  reason: string;
  complaintId: number | null;
}

export interface ComplaintInput {
  platform: SupportedPlatform;
  postId: string;
  contactEmail: string;
  statement: string;
}

export interface Complaint {
  id: number;
  platform: SupportedPlatform;
  postId: string;
  contactEmail: string;
  statement: string;
  status: "open" | "verified" | "rejected";
  createdAt: string;
}

export interface FeedbackInput {
  message: string;
  problemUrl: string;
  contactEmail: string;
}

export interface Feedback extends FeedbackInput {
  id: number;
  status: "open" | "resolved";
  createdAt: string;
}

const SCHEMA = `
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS platform_state (
  platform TEXT PRIMARY KEY,
  enabled INTEGER NOT NULL DEFAULT 1,
  failure_count INTEGER NOT NULL DEFAULT 0,
  disabled_reason TEXT,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS complaint (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  platform TEXT NOT NULL,
  post_id TEXT NOT NULL,
  contact_email TEXT NOT NULL,
  statement TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  resolved_at TEXT
);

CREATE TABLE IF NOT EXISTS blocked_post (
  platform TEXT NOT NULL,
  post_id TEXT NOT NULL,
  reason TEXT NOT NULL,
  complaint_id INTEGER,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (platform, post_id),
  FOREIGN KEY (complaint_id) REFERENCES complaint(id)
);

CREATE TABLE IF NOT EXISTS feedback (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  message TEXT NOT NULL,
  problem_url TEXT NOT NULL DEFAULT '',
  contact_email TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'open',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  resolved_at TEXT
);

CREATE TABLE IF NOT EXISTS proxy_usage (
  month TEXT PRIMARY KEY,
  bytes INTEGER NOT NULL DEFAULT 0,
  estimated_cost_cents INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS daily_metric (
  day TEXT NOT NULL,
  platform TEXT NOT NULL,
  metric TEXT NOT NULL,
  value INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (day, platform, metric)
);

CREATE TABLE IF NOT EXISTS admin_recovery_use (
  fingerprint TEXT PRIMARY KEY,
  used_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS request_rate (
  bucket TEXT PRIMARY KEY,
  count INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS request_lease (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  owner TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS proxy_reservation (
  id TEXT PRIMARY KEY,
  month TEXT NOT NULL,
  bytes INTEGER NOT NULL,
  cost_cents INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);

INSERT OR IGNORE INTO platform_state(platform) VALUES ('douyin');
INSERT OR IGNORE INTO platform_state(platform) VALUES ('xiaohongshu');
`;

export class LinkKeepStore {
  private readonly database: DatabaseSync;

  constructor(filename: string) {
    mkdirSync(path.dirname(path.resolve(filename)), { recursive: true });
    this.database = new DatabaseSync(filename);
    this.database.exec("PRAGMA busy_timeout = 5000");
    this.database.exec(SCHEMA);
  }

  close(): void {
    this.database.close();
  }

  private transaction<T>(operation: () => T): T {
    this.database.exec("BEGIN IMMEDIATE");
    try { const result = operation(); this.database.exec("COMMIT"); return result; }
    catch (error) { this.database.exec("ROLLBACK"); throw error; }
  }

  consumeRate(namespace: string, owner: string, limits: { hourly: number; daily: number }, now = new Date()): { allowed: boolean; retryAfterSeconds: number } {
    return this.transaction(() => {
      const millis = now.getTime();
      this.database.prepare("DELETE FROM request_rate WHERE expires_at <= ?").run(millis);
      const hourEnd = Math.floor(millis / 3_600_000) * 3_600_000 + 3_600_000;
      const dayEnd = Math.floor(millis / 86_400_000) * 86_400_000 + 86_400_000;
      const buckets = [
        { key: `${namespace}:h:${hourEnd}:${owner}`, max: limits.hourly, end: hourEnd },
        { key: `${namespace}:d:${dayEnd}:${owner}`, max: limits.daily, end: dayEnd },
      ];
      for (const bucket of buckets) {
        const row = this.database.prepare("SELECT count FROM request_rate WHERE bucket = ?").get(bucket.key) as { count: number } | undefined;
        if ((row?.count ?? 0) >= bucket.max) return { allowed: false, retryAfterSeconds: Math.ceil((bucket.end - millis) / 1000) };
      }
      for (const bucket of buckets) this.database.prepare("INSERT INTO request_rate(bucket,count,expires_at) VALUES (?,1,?) ON CONFLICT(bucket) DO UPDATE SET count=count+1").run(bucket.key, bucket.end);
      return { allowed: true, retryAfterSeconds: 0 };
    });
  }

  acquireLease(kind: string, owner: string, globalLimit: number, ownerLimit: number, ttlMs: number, now = Date.now()): string | null {
    return this.transaction(() => {
      this.database.prepare("DELETE FROM request_lease WHERE expires_at <= ?").run(now);
      const counts = this.database.prepare("SELECT COUNT(*) AS total, COALESCE(SUM(owner = ?),0) AS owned FROM request_lease WHERE kind = ?").get(owner, kind) as { total: number; owned: number };
      if (counts.total >= globalLimit || counts.owned >= ownerLimit) return null;
      const id = randomUUID();
      this.database.prepare("INSERT INTO request_lease VALUES (?,?,?,?)").run(id, kind, owner, now + ttlMs);
      return id;
    });
  }

  releaseLease(id: string): void { this.database.prepare("DELETE FROM request_lease WHERE id = ?").run(id); }

  reserveProxyBudget(month: string, maximumBytes: number, costPerGbCents: number, budgetCents: number): { id: string; maxBytes: number } | null {
    return this.transaction(() => {
      // A crashed process is charged its reservation rather than granting the same budget again.
      this.settleExpiredReservations(Date.now());
      const pending = this.database.prepare("SELECT COALESCE(SUM(cost_cents),0) AS cost FROM proxy_reservation WHERE month = ?").get(month) as { cost: number };
      const available = budgetCents - this.proxyUsage(month).costCents - pending.cost;
      if (available <= 0) return null;
      const maxBytes = Math.min(maximumBytes, Math.floor(available * 1024 ** 3 / costPerGbCents));
      if (maxBytes < 8192) return null;
      const cost = Math.ceil(maxBytes / 1024 ** 3 * costPerGbCents);
      const id = randomUUID();
      this.database.prepare("INSERT INTO proxy_reservation VALUES (?,?,?,?,?)").run(id, month, maxBytes, cost, Date.now() + 10 * 60 * 1000);
      return { id, maxBytes };
    });
  }

  settleProxyBudget(id: string, bytes: number, costPerGbCents: number): void {
    this.transaction(() => {
      const row = this.database.prepare("SELECT month,bytes,cost_cents FROM proxy_reservation WHERE id = ?").get(id) as { month: string; bytes: number; cost_cents: number } | undefined;
      if (!row) return;
      const charged = Math.min(bytes, row.bytes);
      this.addProxyUsage(row.month, charged, Math.min(row.cost_cents, Math.ceil(charged / 1024 ** 3 * costPerGbCents)));
      this.database.prepare("DELETE FROM proxy_reservation WHERE id = ?").run(id);
    });
  }

  private settleExpiredReservations(now: number): void {
    const rows = this.database.prepare("SELECT id,month,bytes,cost_cents FROM proxy_reservation WHERE expires_at <= ?").all(now) as { id: string; month: string; bytes: number; cost_cents: number }[];
    for (const row of rows) {
      this.addProxyUsage(row.month, row.bytes, row.cost_cents);
      this.database.prepare("DELETE FROM proxy_reservation WHERE id = ?").run(row.id);
    }
  }

  prune(now = new Date()): void {
    this.transaction(() => {
      this.database.prepare("UPDATE complaint SET contact_email='', statement='' WHERE resolved_at IS NOT NULL AND resolved_at <= datetime(?, '-180 days')").run(now.toISOString());
      this.database.prepare("UPDATE feedback SET contact_email='', problem_url='', message='' WHERE resolved_at IS NOT NULL AND resolved_at <= datetime(?, '-180 days')").run(now.toISOString());
      this.database.prepare("DELETE FROM daily_metric WHERE day < date(?, '-30 days')").run(now.toISOString());
      this.database.prepare("DELETE FROM request_rate WHERE expires_at <= ?").run(now.getTime());
      this.database.prepare("DELETE FROM request_lease WHERE expires_at <= ?").run(now.getTime());
      this.settleExpiredReservations(now.getTime());
    });
  }

  recentMetrics(): { day: string; platform: string; metric: string; value: number }[] {
    return this.database.prepare("SELECT day,platform,metric,value FROM daily_metric ORDER BY day DESC,platform,metric").all() as { day: string; platform: string; metric: string; value: number }[];
  }

  isPlatformEnabled(platform: SupportedPlatform): boolean {
    const row = this.database
      .prepare("SELECT enabled FROM platform_state WHERE platform = ?")
      .get(platform) as { enabled: number } | undefined;
    return row?.enabled === 1;
  }

  setPlatformEnabled(
    platform: SupportedPlatform,
    enabled: boolean,
    reason?: string,
  ): void {
    this.database
      .prepare(
        `INSERT INTO platform_state(platform, enabled, disabled_reason, updated_at)
         VALUES (?, ?, ?, CURRENT_TIMESTAMP)
         ON CONFLICT(platform) DO UPDATE SET
           enabled = excluded.enabled,
           disabled_reason = excluded.disabled_reason,
           failure_count = CASE WHEN excluded.enabled = 1 THEN 0 ELSE failure_count END,
           updated_at = CURRENT_TIMESTAMP`,
      )
      .run(platform, enabled ? 1 : 0, reason ?? null);
  }

  platformStatuses(): {
    platform: SupportedPlatform;
    enabled: boolean;
    failureCount: number;
    disabledReason: string | null;
    updatedAt: string;
  }[] {
    const rows = this.database
      .prepare(
        `SELECT
          platform,
          enabled,
          failure_count AS failureCount,
          disabled_reason AS disabledReason,
          updated_at AS updatedAt
        FROM platform_state
        ORDER BY platform`,
      )
      .all() as {
      platform: SupportedPlatform;
      enabled: number;
      failureCount: number;
      disabledReason: string | null;
      updatedAt: string;
    }[];
    return rows.map((row) => ({ ...row, enabled: row.enabled === 1 }));
  }

  recordPlatformFailure(platform: SupportedPlatform, threshold = 5): boolean {
    this.database.exec("BEGIN IMMEDIATE");
    try {
      this.database
        .prepare(
          `UPDATE platform_state
           SET failure_count = failure_count + 1, updated_at = CURRENT_TIMESTAMP
           WHERE platform = ?`,
        )
        .run(platform);
      const state = this.database
        .prepare(
          "SELECT failure_count FROM platform_state WHERE platform = ?",
        )
        .get(platform) as { failure_count: number };
      if (state.failure_count >= threshold) {
        this.setPlatformEnabled(platform, false, "automatic-circuit-breaker");
        this.database.exec("COMMIT");
        return true;
      }
      this.database.exec("COMMIT");
      return false;
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }

  recordPlatformSuccess(platform: SupportedPlatform): void {
    this.database
      .prepare(
        `UPDATE platform_state
         SET failure_count = 0, updated_at = CURRENT_TIMESTAMP
         WHERE platform = ?`,
      )
      .run(platform);
  }

  isPostBlocked(platform: SupportedPlatform, postId: string): boolean {
    return Boolean(
      this.database
        .prepare(
          "SELECT 1 FROM blocked_post WHERE platform = ? AND post_id = ?",
        )
        .get(platform, postId),
    );
  }

  blockPost(input: BlockPostInput): void {
    this.database
      .prepare(
        `INSERT INTO blocked_post(platform, post_id, reason, complaint_id)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(platform, post_id) DO UPDATE SET
           reason = excluded.reason,
           complaint_id = excluded.complaint_id`,
      )
      .run(
        input.platform,
        input.postId,
        input.reason,
        input.complaintId,
      );
  }

  unblockPost(platform: SupportedPlatform, postId: string): void {
    this.database
      .prepare("DELETE FROM blocked_post WHERE platform = ? AND post_id = ?")
      .run(platform, postId);
  }

  blockedPosts(): {
    platform: SupportedPlatform;
    postId: string;
    reason: string;
    createdAt: string;
  }[] {
    return this.database
      .prepare(
        `SELECT
          platform,
          post_id AS postId,
          reason,
          created_at AS createdAt
        FROM blocked_post
        ORDER BY created_at DESC`,
      )
      .all() as {
      platform: SupportedPlatform;
      postId: string;
      reason: string;
      createdAt: string;
    }[];
  }

  createFeedback(input: FeedbackInput): number {
    const result = this.database.prepare(
      "INSERT INTO feedback(message, problem_url, contact_email) VALUES (?, ?, ?)",
    ).run(input.message, input.problemUrl, input.contactEmail);
    return Number(result.lastInsertRowid);
  }

  listOpenFeedback(): Feedback[] {
    return this.database.prepare(
      `SELECT id, message, problem_url AS problemUrl, contact_email AS contactEmail,
       status, created_at AS createdAt FROM feedback
       WHERE status = 'open' ORDER BY created_at ASC, id ASC LIMIT 100`,
    ).all() as unknown as Feedback[];
  }

  resolveFeedback(id: number): boolean {
    const result = this.database.prepare(
      "UPDATE feedback SET status='resolved', resolved_at=CURRENT_TIMESTAMP WHERE id=? AND status='open'",
    ).run(id);
    return Number(result.changes) > 0;
  }

  createComplaint(input: ComplaintInput): number {
    const result = this.database
      .prepare(
        `INSERT INTO complaint(platform, post_id, contact_email, statement)
         VALUES (?, ?, ?, ?)`,
      )
      .run(
        input.platform,
        input.postId,
        input.contactEmail,
        input.statement,
      );
    return Number(result.lastInsertRowid);
  }

  listOpenComplaints(): Complaint[] {
    const rows = this.database
      .prepare(
        `SELECT
           id,
           platform,
           post_id AS postId,
           contact_email AS contactEmail,
           statement,
           status,
           created_at AS createdAt
         FROM complaint
         WHERE status = 'open'
         ORDER BY created_at ASC`,
      )
      .all();
    return rows as unknown as Complaint[];
  }

  getComplaint(id: number): Complaint | null {
    const row = this.database
      .prepare(
        `SELECT
           id,
           platform,
           post_id AS postId,
           contact_email AS contactEmail,
           statement,
           status,
           created_at AS createdAt
         FROM complaint
         WHERE id = ?`,
      )
      .get(id);
    return (row as Complaint | undefined) ?? null;
  }

  resolveComplaint(id: number, status: "verified" | "rejected"): void {
    this.database
      .prepare(
        `UPDATE complaint
         SET status = ?, resolved_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
      )
      .run(status, id);
  }

  addProxyUsage(month: string, bytes: number, costCents: number): void {
    this.database
      .prepare(
        `INSERT INTO proxy_usage(month, bytes, estimated_cost_cents)
         VALUES (?, ?, ?)
         ON CONFLICT(month) DO UPDATE SET
           bytes = bytes + excluded.bytes,
           estimated_cost_cents = estimated_cost_cents + excluded.estimated_cost_cents,
           updated_at = CURRENT_TIMESTAMP`,
      )
      .run(month, bytes, costCents);
  }

  proxyUsage(month: string): { bytes: number; costCents: number } {
    const row = this.database
      .prepare(
        `SELECT bytes, estimated_cost_cents AS costCents
         FROM proxy_usage WHERE month = ?`,
      )
      .get(month) as { bytes: number; costCents: number } | undefined;
    return row ?? { bytes: 0, costCents: 0 };
  }

  incrementMetric(
    day: string,
    platform: SupportedPlatform,
    metric: string,
  ): void {
    this.database
      .prepare(
        `INSERT INTO daily_metric(day, platform, metric, value)
         VALUES (?, ?, ?, 1)
         ON CONFLICT(day, platform, metric)
         DO UPDATE SET value = value + 1`,
      )
      .run(day, platform, metric);
  }

  isRecoveryCodeUsed(fingerprint: string): boolean {
    return Boolean(
      this.database
        .prepare(
          "SELECT 1 FROM admin_recovery_use WHERE fingerprint = ?",
        )
        .get(fingerprint),
    );
  }

  markRecoveryCodeUsed(fingerprint: string): void {
    this.database
      .prepare(
        "INSERT OR IGNORE INTO admin_recovery_use(fingerprint) VALUES (?)",
      )
      .run(fingerprint);
  }

  consumeRecoveryCode(fingerprint: string): boolean {
    return this.database.prepare("INSERT OR IGNORE INTO admin_recovery_use(fingerprint) VALUES (?)").run(fingerprint).changes === 1;
  }
}
