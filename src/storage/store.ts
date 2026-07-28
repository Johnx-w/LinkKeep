import { mkdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

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
}
