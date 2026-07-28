import { createDecipheriv } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const [sourceArgument, destinationArgument] = process.argv.slice(2);
if (!sourceArgument || !destinationArgument) {
  throw new Error(
    "Usage: npm run restore -- <backup.db.aes> <restored.db>",
  );
}

const key = Buffer.from(process.env.BACKUP_ENCRYPTION_KEY ?? "", "base64");
if (key.length !== 32) {
  throw new Error("BACKUP_ENCRYPTION_KEY must be 32 random bytes in base64");
}

const encrypted = await readFile(path.resolve(sourceArgument));
if (encrypted.subarray(0, 4).toString("ascii") !== "LKB1") {
  throw new Error("Unsupported backup format");
}

const iv = encrypted.subarray(4, 16);
const tag = encrypted.subarray(16, 32);
const ciphertext = encrypted.subarray(32);
const decipher = createDecipheriv("aes-256-gcm", key, iv);
decipher.setAuthTag(tag);
const plaintext = Buffer.concat([
  decipher.update(ciphertext),
  decipher.final(),
]);

await writeFile(path.resolve(destinationArgument), plaintext, {
  flag: "wx",
  mode: 0o600,
});
console.log(`Backup restored to ${path.resolve(destinationArgument)}`);
