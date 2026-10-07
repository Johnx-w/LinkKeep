import { DatabaseSync } from "node:sqlite";
import { readdir, stat } from "node:fs/promises";
import path from "node:path";

const issues = [];
try {
  const response = await fetch(new URL("/api/health", process.env.APP_ORIGIN), { signal: AbortSignal.timeout(5000) });
  if (!response.ok) issues.push("health endpoint unavailable");
} catch { issues.push("health endpoint unreachable"); }
let database;
try {
  database = new DatabaseSync(path.resolve(process.env.DATABASE_PATH ?? "data/linkkeep.db"), { readOnly: true });
  const month = new Date().toISOString().slice(0,7);
  const usage = database.prepare("SELECT estimated_cost_cents AS cost FROM proxy_usage WHERE month=?").get(month);
  if ((usage?.cost ?? 0) >= Number(process.env.PROXY_MONTHLY_BUDGET_CENTS ?? 10000) * 0.8) issues.push("monthly proxy cost >= 80% budget");
  const failures = database.prepare("SELECT platform FROM platform_state WHERE enabled=0 AND disabled_reason='automatic-circuit-breaker'").all();
  if (failures.length) issues.push("automatic platform circuit breaker open");
  const metrics = database.prepare("SELECT metric,SUM(value) AS count FROM daily_metric WHERE day >= date('now','-1 day') GROUP BY metric").all();
  const count = (name) => metrics.find((row) => row.metric === name)?.count ?? 0;
  if (count("parse_attempt") >= 20 && count("parse_success") / count("parse_attempt") < 0.9) issues.push("recent parse success < 90%");
  if (count("download_attempt") >= 20 && count("download_started") / count("download_attempt") < 0.95) issues.push("recent download start < 95%");
} catch { issues.push("operations database unavailable"); }
finally { database?.close(); }
try {
  const directory = path.resolve(process.env.BACKUP_DIRECTORY ?? "backups");
  const backups = (await readdir(directory)).filter((name) => name.endsWith(".db.aes"));
  const times = await Promise.all(backups.map(async (name) => (await stat(path.join(directory, name))).mtimeMs));
  if (!times.length || Date.now() - Math.max(...times) > 36 * 60 * 60 * 1000) issues.push("encrypted backup missing or older than 36 hours");
} catch { issues.push("encrypted backup directory unavailable"); }
if (issues.length) { console.error(issues.join("; ")); process.exitCode = 1; }
