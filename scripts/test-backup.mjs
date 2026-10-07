import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

await mkdir("artifacts/backup-tests", { recursive: true });
const directory = await mkdtemp(path.resolve("artifacts/backup-tests/run-"));
const databasePath = path.join(directory, "source.db");
const backupDirectory = path.join(directory, "backups");
const database = new DatabaseSync(databasePath);
database.exec("CREATE TABLE complaint(id INTEGER PRIMARY KEY, contact_email TEXT, statement TEXT, status TEXT, resolved_at TEXT); CREATE TABLE daily_metric(day TEXT,platform TEXT,metric TEXT,value INTEGER); INSERT INTO complaint VALUES (1,'open@test.invalid','open evidence','open',NULL); INSERT INTO complaint VALUES (2,'resolved@test.invalid','old evidence','verified','2026-01-01');");
database.exec("CREATE TABLE feedback(id INTEGER PRIMARY KEY, contact_email TEXT, problem_url TEXT, message TEXT, status TEXT); INSERT INTO feedback VALUES(1,'open@test.invalid','https://site.test/open','open feedback','open'); INSERT INTO feedback VALUES(2,'closed@test.invalid','https://site.test/closed','closed feedback','resolved');");
database.close();
const env = { ...process.env, DATABASE_PATH: databasePath, BACKUP_DIRECTORY: backupDirectory, BACKUP_ENCRYPTION_KEY: randomBytes(32).toString("base64") };
function run(script, args = [], overrides = {}) {
  return spawnSync(process.execPath, [script, ...args], { env: { ...env, ...overrides }, encoding: "utf8" });
}
for (let index = 0; index < 8; index++) {
  const backup = run("scripts/backup.mjs");
  assert.equal(backup.status, 0, "encrypted backup failed");
}
const backups = (await readdir(backupDirectory)).filter((name) => name.endsWith(".db.aes"));
assert.equal(backups.length, 7);
assert.equal((await readdir(backupDirectory)).some((name) => name.endsWith(".db")), false);
const latest = path.join(backupDirectory, backups.sort().at(-1));
const restored = path.join(directory, "restored.db");
assert.equal(run("scripts/restore-backup.mjs", [latest, restored]).status, 0);
const recovered = new DatabaseSync(restored, { readOnly: true });
assert.equal(recovered.prepare("SELECT contact_email FROM complaint WHERE id=1").get().contact_email, "open@test.invalid");
assert.equal(recovered.prepare("SELECT contact_email FROM complaint WHERE id=2").get().contact_email, "");
assert.equal(recovered.prepare("SELECT contact_email FROM feedback WHERE id=1").get().contact_email, "open@test.invalid");
assert.deepEqual({ ...recovered.prepare("SELECT contact_email,problem_url,message FROM feedback WHERE id=2").get() }, { contact_email: "", problem_url: "", message: "" });
recovered.close();
assert.notEqual(run("scripts/restore-backup.mjs", [latest, restored]).status, 0, "must not overwrite existing database");
assert.notEqual(run("scripts/restore-backup.mjs", [latest, path.join(directory, "wrong.db")], { BACKUP_ENCRYPTION_KEY: randomBytes(32).toString("base64") }).status, 0);
const tampered = Buffer.from(await readFile(latest)); tampered[tampered.length - 1] ^= 1;
const tamperedPath = path.join(directory, "tampered.aes"); await writeFile(tamperedPath, tampered);
assert.notEqual(run("scripts/restore-backup.mjs", [tamperedPath, path.join(directory, "tampered.db")]).status, 0);
console.log("Backup/restore verified: encryption, retention, redaction, recovery, wrong key, tampering and overwrite refusal.");
