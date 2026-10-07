import { spawnSync } from "node:child_process";
import { cp, readdir, unlink, access } from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const result = spawnSync(process.execPath, [require.resolve("next/dist/bin/next"), "build"], { stdio: "inherit" });
if (result.status !== 0) process.exit(result.status ?? 1);
const standalone = path.resolve(".next/standalone");
const browserManifest = path.join(standalone, "node_modules/playwright-core/browsers.json");
if (!await access(browserManifest).then(() => true, () => false)) {
  throw new Error("Playwright browser manifest missing from standalone; browser fallback cannot run");
}
for (const name of await readdir(standalone)) {
  if (name === ".env" || name.startsWith(".env.")) await unlink(path.join(standalone, name));
}
await cp(".next/static", path.join(standalone, ".next/static"), { recursive: true });
await cp("public", path.join(standalone, "public"), { recursive: true });
for (const name of [".private", "artifacts", "data", "backups", ".git", ".cursor"]) {
  const exists = await access(path.join(standalone, name)).then(() => true, () => false);
  if (exists) throw new Error("Sensitive directory included in standalone: " + name);
}
console.log("Standalone prepared; environment files excluded.");
