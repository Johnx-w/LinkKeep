import { createHash, randomBytes } from "node:crypto";
import { jwtVerify, SignJWT } from "jose";
import * as OTPAuth from "otpauth";

import { env } from "@/config/env";
import { verifyPassword } from "@/security/password";
import { getStore } from "@/storage/server-store";

const SESSION_TTL_SECONDS = 2 * 60 * 60;

function sessionKey(): Uint8Array {
  return new TextEncoder().encode(env.SESSION_SECRET);
}

export interface AdminSession {
  csrf: string;
  expiresAt: number;
}

export async function verifyAdminCredentials(
  password: string,
  secondFactor: string,
): Promise<boolean> {
  if (!env.ADMIN_PASSWORD_HASH) return false;
  const passwordValid = await verifyPassword(
    password,
    env.ADMIN_PASSWORD_HASH,
  );
  if (!passwordValid) return false;

  if (/^\d{6}$/u.test(secondFactor)) {
    return verifyTotp(secondFactor);
  }
  return verifyRecoveryCode(secondFactor);
}

function verifyTotp(totpToken: string): boolean {
  if (!env.ADMIN_TOTP_SECRET) return false;
  try {
    const totp = new OTPAuth.TOTP({
      issuer: "LinkKeep",
      label: "operator",
      algorithm: "SHA1",
      digits: 6,
      period: 30,
      secret: OTPAuth.Secret.fromBase32(env.ADMIN_TOTP_SECRET),
    });
    return totp.validate({ token: totpToken, window: 1 }) !== null;
  } catch {
    return false;
  }
}

async function verifyRecoveryCode(code: string): Promise<boolean> {
  let encodedCodes: string[];
  try {
    const parsed: unknown = JSON.parse(env.ADMIN_RECOVERY_CODES_HASH);
    encodedCodes = Array.isArray(parsed)
      ? parsed.filter((value): value is string => typeof value === "string")
      : [];
  } catch {
    return false;
  }

  const fingerprint = recoveryCodeFingerprint(code);
  const store = getStore();
  if (store.isRecoveryCodeUsed(fingerprint)) return false;

  for (const encoded of encodedCodes) {
    if (await verifyPassword(code, encoded)) {
      store.markRecoveryCodeUsed(fingerprint);
      return true;
    }
  }
  return false;
}

export async function createAdminSession(): Promise<{
  token: string;
  csrf: string;
}> {
  const csrf = randomBytes(24).toString("base64url");
  const token = await new SignJWT({ csrf })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject("linkkeep-operator")
    .setIssuedAt()
    .setExpirationTime(`${SESSION_TTL_SECONDS}s`)
    .sign(sessionKey());
  return { token, csrf };
}

export async function readAdminSession(
  token: string | undefined,
): Promise<AdminSession | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, sessionKey(), {
      algorithms: ["HS256"],
      subject: "linkkeep-operator",
    });
    if (typeof payload.csrf !== "string" || typeof payload.exp !== "number") {
      return null;
    }
    return { csrf: payload.csrf, expiresAt: payload.exp * 1000 };
  } catch {
    return null;
  }
}

export function recoveryCodeFingerprint(code: string): string {
  return createHash("sha256")
    .update(`${env.SESSION_SECRET}\0${code}`)
    .digest("base64url");
}
