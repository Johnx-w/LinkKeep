const placeholder = /development|replace-with|example\.(?:com|org|net)|localhost/i;
const decodePasswordHash = (value) => value.startsWith("base64:") ? Buffer.from(value.slice(7), "base64").toString("utf8") : value;

export function assertProductionConfiguration(values) {
  const failures = [];
  for (const name of ["SESSION_SECRET", "DAILY_ID_SECRET", "VALIDATION_TOKEN"]) {
    const value = values[name] ?? "";
    if (name === "VALIDATION_TOKEN" && !value) continue;
    if (value.length < 43 || new Set(value).size < 16 || placeholder.test(value)) failures.push(name);
  }
  if (values.SESSION_SECRET === values.DAILY_ID_SECRET) failures.push("distinct secrets");
  if (!/^scrypt\$[A-Za-z0-9_-]{22}\$[A-Za-z0-9_-]{86}$/.test(decodePasswordHash(values.ADMIN_PASSWORD_HASH ?? ""))) failures.push("ADMIN_PASSWORD_HASH");
  if (!/^[A-Z2-7]{32,}$/.test(values.ADMIN_TOTP_SECRET ?? "")) failures.push("ADMIN_TOTP_SECRET");
  try {
    const hashes = JSON.parse(values.ADMIN_RECOVERY_CODES_HASH ?? "[]");
    if (!Array.isArray(hashes) || !hashes.length || !hashes.every((h) => typeof h === "string" && /^scrypt\$[A-Za-z0-9_-]{22}\$[A-Za-z0-9_-]{86}$/.test(decodePasswordHash(h)))) failures.push("ADMIN_RECOVERY_CODES_HASH");
  } catch { failures.push("ADMIN_RECOVERY_CODES_HASH"); }
  if (Buffer.from(values.BACKUP_ENCRYPTION_KEY ?? "", "base64").length !== 32) failures.push("BACKUP_ENCRYPTION_KEY");
  try {
    const origin = new URL(values.APP_ORIGIN ?? "");
    if (origin.protocol !== "https:" || origin.origin !== values.APP_ORIGIN || placeholder.test(origin.hostname) || origin.username || origin.password) failures.push("APP_ORIGIN");
  } catch { failures.push("APP_ORIGIN"); }
  const email = values.COPYRIGHT_EMAIL ?? "";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || placeholder.test(email)) failures.push("COPYRIGHT_EMAIL");
  if (values.TRUST_PROXY_HEADERS !== "true") failures.push("TRUST_PROXY_HEADERS");
  if (failures.length) throw new Error(`Production configuration required: ${[...new Set(failures)].join(", ")}`);
}
