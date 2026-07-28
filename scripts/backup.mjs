import { createCipheriv, randomBytes } from "node:crypto";
import {
  mkdir,
  readFile,
  readdir,
  rm,
  unlink,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

const databasePath = path.resolve(
  process.env.DATABASE_PATH ?? "./data/linkkeep.db",
);
const backupDirectory = path.resolve(
  process.env.BACKUP_DIRECTORY ?? "./backups",
);
const key = Buffer.from(process.env.BACKUP_ENCRYPTION_KEY ?? "", "base64");

if (key.length !== 32) {
  throw new Error("BACKUP_ENCRYPTION_KEY must be 32 random bytes in base64");
}

await mkdir(backupDirectory, { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/gu, "-");
const snapshotPath = path.join(backupDirectory, `${stamp}.db`);
const encryptedPath = `${snapshotPath}.aes`;

const database = new DatabaseSync(databasePath, { readOnly: true });
try {
  database.exec(
    `VACUUM INTO '${snapshotPath.replaceAll("'", "''")}'`,
  );
} finally {
  database.close();
}

try {
  const plaintext = await readFile(snapshotPath);
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([
    cipher.update(plaintext),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  await writeFile(
    encryptedPath,
    Buffer.concat([Buffer.from("LKB1"), iv, tag, ciphertext]),
    { mode: 0o600 },
  );
} finally {
  await unlink(snapshotPath).catch(() => undefined);
}

const backups = (await readdir(backupDirectory))
  .filter((name) => name.endsWith(".db.aes"))
  .sort()
  .reverse();
await Promise.all(
  backups.slice(7).map((name) =>
    rm(path.join(backupDirectory, name), { force: true }),
  ),
);

console.log(`Encrypted backup written: ${encryptedPath}`);
