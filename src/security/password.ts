import {
  randomBytes,
  scrypt as scryptCallback,
  timingSafeEqual,
} from "node:crypto";
import { promisify } from "node:util";

const scrypt = promisify(scryptCallback);
const KEY_LENGTH = 64;

export async function hashPassword(value: string): Promise<string> {
  const salt = randomBytes(16).toString("base64url");
  const key = (await scrypt(value, salt, KEY_LENGTH)) as Buffer;
  return `scrypt$${salt}$${key.toString("base64url")}`;
}

export async function verifyPassword(
  value: string,
  encoded: string,
): Promise<boolean> {
  const [algorithm, salt, expected] = encoded.split("$");
  if (algorithm !== "scrypt" || !salt || !expected) return false;

  try {
    const expectedBytes = Buffer.from(expected, "base64url");
    const actual = (await scrypt(value, salt, expectedBytes.length)) as Buffer;
    return (
      actual.length === expectedBytes.length &&
      timingSafeEqual(actual, expectedBytes)
    );
  } catch {
    return false;
  }
}
