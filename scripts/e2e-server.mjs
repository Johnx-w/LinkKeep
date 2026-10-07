// Test-only TLS ingress and random credentials; never used for deployment.
import { spawnSync } from "node:child_process";
import { createServer } from "node:https";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { randomBytes, scryptSync } from "node:crypto";
import path from "node:path";
import * as OTPAuth from "otpauth";

await mkdir("artifacts/e2e", { recursive: true });
const directory = await mkdtemp(path.resolve("artifacts/e2e/run-"));
const keyPath = path.join(directory, "tls.key"); const certPath = path.join(directory, "tls.crt");
const openssl = process.platform === "win32" ? "C:/Program Files/Git/usr/bin/openssl.exe" : "openssl";
const certificate = spawnSync(openssl, ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", keyPath, "-out", certPath, "-days", "1", "-subj", "/CN=127.0.0.1", "-addext", "subjectAltName=IP:127.0.0.1"], { stdio: "pipe" });
if (certificate.status !== 0) throw new Error("OpenSSL required for isolated production TLS tests");
const password = randomBytes(24).toString("base64url");
const salt = randomBytes(16).toString("base64url");
const hash = "scrypt$" + salt + "$" + scryptSync(password, salt, 64).toString("base64url");
const totp = new OTPAuth.Secret({ size: 20 }).base32;
await writeFile("artifacts/e2e/operator.json", JSON.stringify({ password, totp }), { mode: 0o600 });
Object.assign(process.env, {
  ...process.env, NODE_ENV: "production", PORT: "3107", HOSTNAME: "127.0.0.1",
  APP_ORIGIN: "https://127.0.0.1:3443", COPYRIGHT_EMAIL: "copyright@linkkeep.test", TRUST_PROXY_HEADERS: "true",
  SESSION_SECRET: randomBytes(32).toString("base64url"), DAILY_ID_SECRET: randomBytes(32).toString("base64url"),
  ADMIN_PASSWORD_HASH: "base64:" + Buffer.from(hash).toString("base64"), ADMIN_TOTP_SECRET: totp, ADMIN_RECOVERY_CODES_HASH: JSON.stringify(["base64:" + Buffer.from(hash).toString("base64")]),
  BACKUP_ENCRYPTION_KEY: randomBytes(32).toString("base64"), VALIDATION_TOKEN: "",
  DATABASE_PATH: path.join(directory, "test.db"), ENABLE_DOUYIN: "false", ENABLE_XIAOHONGSHU: "false",
});
const standalone = path.resolve(".next/standalone");
const requiredFiles = JSON.parse(await readFile(path.join(standalone, ".next/required-server-files.json"), "utf8"));
process.env.__NEXT_PRIVATE_STANDALONE_CONFIG = JSON.stringify(requiredFiles.config);
const { default: next } = await import("next");
const app = next({ dev: false, dir: standalone, hostname: "127.0.0.1", port: 3443, conf: requiredFiles.config });
await app.prepare();
const handle = app.getRequestHandler();
const server = createServer({ key: await readFile(keyPath), cert: await readFile(certPath) }, (incoming, outgoing) => {
  incoming.headers["x-real-ip"] = incoming.socket.remoteAddress ?? "127.0.0.1";
  incoming.headers["x-forwarded-for"] = incoming.socket.remoteAddress ?? "127.0.0.1";
  incoming.headers["x-forwarded-proto"] = "https";
  void handle(incoming, outgoing);
});
server.listen(3443, "127.0.0.1");
let stopping = false;
const shutdown = () => {
  if (stopping) return; stopping = true;
  server.closeAllConnections(); server.close();
  void app.close().finally(() => process.exit(0));
  setTimeout(() => process.exit(0), 5000).unref();
};
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, shutdown);
