import { randomBytes, scrypt as scryptCallback } from "node:crypto";
import { promisify } from "node:util";
import * as OTPAuth from "otpauth";
import { mkdir, readFile, writeFile } from "node:fs/promises";

const scrypt = promisify(scryptCallback);

async function hash(value) {
  const salt = randomBytes(16).toString("base64url");
  const key = await scrypt(value, salt, 64);
  return `scrypt$${salt}$${Buffer.from(key).toString("base64url")}`;
}

const password = randomBytes(18).toString("base64url");
const secret = new OTPAuth.Secret({ size: 20 });
const recoveryCodes = Array.from({ length: 10 }, () =>
  randomBytes(9).toString("base64url"),
);
const recoveryHashes = await Promise.all(recoveryCodes.map(hash));
const envHash = (value) => "base64:" + Buffer.from(value).toString("base64");

if (process.argv.includes("--write-env")) {
  const original = await readFile(".env", "utf8").catch(() => "");
  if (/^ADMIN_PASSWORD_HASH=.+$/m.test(original) && !process.argv.includes("--rotate")) throw new Error("Admin already configured. Use --rotate only when intending to replace credentials.");
  const updates = {
    SESSION_SECRET: randomBytes(32).toString("base64url"), DAILY_ID_SECRET: randomBytes(32).toString("base64url"),
    ADMIN_PASSWORD_HASH: envHash(await hash(password)), ADMIN_TOTP_SECRET: secret.base32,
    ADMIN_RECOVERY_CODES_HASH: JSON.stringify(recoveryHashes.map(envHash)), BACKUP_ENCRYPTION_KEY: randomBytes(32).toString("base64"),
    VALIDATION_TOKEN: randomBytes(32).toString("base64url"),
  };
  // Preserve the backup encryption key: rotating it would make existing snapshots unreadable.
  const existingBackupKey = original.match(/^BACKUP_ENCRYPTION_KEY=(.+)$/m)?.[1];
  if (existingBackupKey && Buffer.from(existingBackupKey, "base64").length === 32) updates.BACKUP_ENCRYPTION_KEY = existingBackupKey;
  let text = original;
  for (const [name, value] of Object.entries(updates)) {
    const pattern = new RegExp("^" + name + "=.*$", "m");
    text = pattern.test(text) ? text.replace(pattern, () => name + "=" + value) : text.trimEnd() + "\n" + name + "=" + value + "\n";
  }
  await mkdir(".private", { recursive: true });
  const credentialsPath = ".private/operator-credentials-" + Date.now() + ".txt";
  await writeFile(credentialsPath, ["Admin password: " + password, "TOTP secret: " + secret.base32, "Recovery codes: " + recoveryCodes.join(", "), "Move these credentials to your password manager and remove this file."].join("\n") + "\n", { mode: 0o600, flag: "wx" });
  await writeFile(".env", text, { mode: 0o600 });
  console.log("Local credentials configured. One-time credentials saved in " + credentialsPath);
  process.exit(0);
}

console.log("Store these values in a password manager before closing:");
console.log(`Admin password: ${password}`);
console.log(`TOTP secret: ${secret.base32}`);
console.log(`Recovery codes: ${recoveryCodes.join(", ")}`);
console.log("");
console.log("Environment values:");
console.log(`ADMIN_PASSWORD_HASH=${envHash(await hash(password))}`);
console.log(`ADMIN_TOTP_SECRET=${secret.base32}`);
console.log(
  `ADMIN_RECOVERY_CODES_HASH=${JSON.stringify(recoveryHashes.map(envHash))}`,
);
