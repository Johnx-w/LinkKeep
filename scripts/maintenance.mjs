import { DatabaseSync } from "node:sqlite";
import path from "node:path";

const database = new DatabaseSync(path.resolve(process.env.DATABASE_PATH ?? "data/linkkeep.db"));
try {
  database.exec("PRAGMA busy_timeout = 5000; BEGIN IMMEDIATE;");
  database.exec("UPDATE complaint SET contact_email='', statement='' WHERE resolved_at IS NOT NULL AND resolved_at <= datetime('now','-180 days'); DELETE FROM daily_metric WHERE day < date('now','-30 days');");
  database.exec("COMMIT;");
} catch (error) { database.exec("ROLLBACK;"); throw error; }
finally { database.close(); }
console.log("Retention cleanup complete.");
