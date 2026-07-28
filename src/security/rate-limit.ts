import { createHmac } from "node:crypto";

interface Limits {
  hourly: number;
  daily: number;
}

export interface RateLimitResult {
  allowed: boolean;
  reason?: "hourly" | "daily";
  hourlyRemaining: number;
  dailyRemaining: number;
  retryAfterSeconds?: number;
}

function dayKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function hourKey(date: Date): string {
  return date.toISOString().slice(0, 13);
}

export function createLimitIdentifier(
  ipAddress: string,
  now: Date,
  secret: string,
): string {
  return createHmac("sha256", secret)
    .update(`${dayKey(now)}\0${ipAddress}`)
    .digest("base64url")
    .slice(0, 32);
}

export class MemoryParseRateLimiter {
  private readonly hourlyCounts = new Map<string, number>();
  private readonly dailyCounts = new Map<string, number>();

  constructor(private readonly limits: Limits) {}

  consume(identifier: string, now = new Date()): RateLimitResult {
    const hour = `${hourKey(now)}:${identifier}`;
    const day = `${dayKey(now)}:${identifier}`;
    const hourlyCount = this.hourlyCounts.get(hour) ?? 0;
    const dailyCount = this.dailyCounts.get(day) ?? 0;

    if (dailyCount >= this.limits.daily) {
      return {
        allowed: false,
        reason: "daily",
        hourlyRemaining: Math.max(0, this.limits.hourly - hourlyCount),
        dailyRemaining: 0,
        retryAfterSeconds:
          Math.ceil(
            (Date.parse(`${dayKey(new Date(now.getTime() + 86_400_000))}T00:00:00.000Z`) -
              now.getTime()) /
              1000,
          ),
      };
    }

    if (hourlyCount >= this.limits.hourly) {
      return {
        allowed: false,
        reason: "hourly",
        hourlyRemaining: 0,
        dailyRemaining: Math.max(0, this.limits.daily - dailyCount),
        retryAfterSeconds: 3600 - now.getUTCMinutes() * 60 - now.getUTCSeconds(),
      };
    }

    this.hourlyCounts.set(hour, hourlyCount + 1);
    this.dailyCounts.set(day, dailyCount + 1);

    if (this.hourlyCounts.size + this.dailyCounts.size > 10_000) {
      this.prune(now);
    }

    return {
      allowed: true,
      hourlyRemaining: this.limits.hourly - hourlyCount - 1,
      dailyRemaining: this.limits.daily - dailyCount - 1,
    };
  }

  private prune(now: Date): void {
    const currentHour = hourKey(now);
    const currentDay = dayKey(now);
    for (const key of this.hourlyCounts.keys()) {
      if (!key.startsWith(currentHour)) this.hourlyCounts.delete(key);
    }
    for (const key of this.dailyCounts.keys()) {
      if (!key.startsWith(currentDay)) this.dailyCounts.delete(key);
    }
  }
}
