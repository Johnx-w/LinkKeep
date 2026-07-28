import "server-only";

import { z } from "zod";

const schema = z.object({
  DATABASE_PATH: z.string().default("./data/linkkeep.db"),
  DAILY_ID_SECRET: z.string().min(16).default("development-daily-secret"),
  SESSION_SECRET: z.string().min(16).default("development-session-secret"),
  ADMIN_PASSWORD_HASH: z.string().default(""),
  ADMIN_TOTP_SECRET: z.string().default(""),
  ADMIN_RECOVERY_CODES_HASH: z.string().default("[]"),
  VALIDATION_TOKEN: z.string().default(""),
  TRUST_PROXY_HEADERS: z
    .enum(["true", "false"])
    .default("false")
    .transform((value) => value === "true"),
  PROXY_MONTHLY_BUDGET_CENTS: z.coerce.number().int().positive().default(10_000),
  PROXY_COST_PER_GB_CENTS: z.coerce.number().int().positive().default(80),
  COPYRIGHT_EMAIL: z.string().email().default("copyright@example.com"),
  ENABLE_DOUYIN: z
    .enum(["true", "false"])
    .default("true")
    .transform((value) => value === "true"),
  ENABLE_XIAOHONGSHU: z
    .enum(["true", "false"])
    .default("true")
    .transform((value) => value === "true"),
});

export const env = schema.parse(process.env);
