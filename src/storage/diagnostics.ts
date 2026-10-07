import { appendFile, mkdir, readdir, stat, unlink } from "node:fs/promises";
import path from "node:path";

function directory(): string {
  return path.join(path.dirname(path.resolve(/* turbopackIgnore: true */ process.env.DATABASE_PATH ?? "data/linkkeep.db")), "diagnostics");
}

export async function recordParseFailure(requestId: string): Promise<void> {
  if (!/^req_[a-f0-9-]{36}$/.test(requestId)) return;
  const folder = directory();
  await mkdir(folder, { recursive: true, mode: 0o700 });
  const filename = path.join(folder, new Date().toISOString().slice(0, 10) + ".jsonl");
  if ((await stat(filename).catch(() => ({ size: 0 }))).size >= 1024 * 1024) return;
  // Strict whitelist: never accepts arbitrary errors, input, URLs, headers or client addresses.
  await appendFile(filename, JSON.stringify({ at: new Date().toISOString(), code: "PARSE_FAILED", requestId }) + "\n", { mode: 0o600 });
}

export async function pruneDiagnostics(now = new Date()): Promise<void> {
  const folder = directory();
  const cutoff = new Date(now.getTime() - 6 * 86_400_000).toISOString().slice(0, 10);
  for (const name of await readdir(folder).catch(() => [] as string[])) {
    if (/^\d{4}-\d{2}-\d{2}\.jsonl$/.test(name) && name.slice(0,10) < cutoff) await unlink(path.join(folder, name));
  }
}
