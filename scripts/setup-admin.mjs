import { randomBytes, scrypt as scryptCallback } from "node:crypto";
import { promisify } from "node:util";
import * as OTPAuth from "otpauth";

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

console.log("Store these values in a password manager before closing:");
console.log(`Admin password: ${password}`);
console.log(`TOTP secret: ${secret.base32}`);
console.log(`Recovery codes: ${recoveryCodes.join(", ")}`);
console.log("");
console.log("Environment values:");
console.log(`ADMIN_PASSWORD_HASH=${await hash(password)}`);
console.log(`ADMIN_TOTP_SECRET=${secret.base32}`);
console.log(
  `ADMIN_RECOVERY_CODES_HASH=${JSON.stringify(recoveryHashes)}`,
);
