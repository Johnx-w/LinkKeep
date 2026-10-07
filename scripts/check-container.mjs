import { randomBytes, scryptSync } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import * as OTPAuth from "otpauth";

await mkdir("artifacts", { recursive: true });
const salt = randomBytes(16).toString("base64url");
const hash = "scrypt$" + salt + "$" + scryptSync(randomBytes(24), salt, 64).toString("base64url");
const values = {
  APP_ORIGIN: "https://linkkeep.test", COPYRIGHT_EMAIL: "copyright@linkkeep.test", TRUST_PROXY_HEADERS: "true",
  SESSION_SECRET: randomBytes(32).toString("base64url"), DAILY_ID_SECRET: randomBytes(32).toString("base64url"),
  ADMIN_PASSWORD_HASH: "base64:" + Buffer.from(hash).toString("base64"), ADMIN_TOTP_SECRET: new OTPAuth.Secret({ size: 20 }).base32, ADMIN_RECOVERY_CODES_HASH: JSON.stringify(["base64:" + Buffer.from(hash).toString("base64")]),
  BACKUP_ENCRYPTION_KEY: randomBytes(32).toString("base64"), ENABLE_DOUYIN: "false", ENABLE_XIAOHONGSHU: "false",
};
const filename = path.resolve("artifacts/container.env");
await writeFile(filename, Object.entries(values).map(([name,value]) => name + "=" + value).join("\n") + "\n", { mode: 0o600 });
const env = { ...process.env, LINKKEEP_ENV_FILE: filename };
function docker(args) {
  const result = spawnSync("docker", ["compose", "-p", "linkkeep-smoke", ...args], { stdio: "inherit", env });
  if (result.status !== 0) throw new Error("Container smoke check failed: Docker, sandbox and runtime configuration must pass before release");
}
docker(["build"]);
docker(["run", "--rm", "--no-deps", "linkkeep", "node", "-e", "const fs=require('node:fs'); if(fs.existsSync('/app/.env'))process.exit(1); const {chromium}=require('playwright-core'); (async()=>{ const browser=await chromium.launch({executablePath:'/usr/bin/chromium',chromiumSandbox:true,headless:true}); const page=await browser.newPage(); await page.setContent('<p>Sandbox verification</p>'); if(await page.textContent('p')!=='Sandbox verification')throw new Error('Renderer verification failed'); await browser.close(); console.log('Container sandbox and secret exclusion verified'); })().catch(error=>{console.error(error);process.exit(1)});"]);
docker(["run", "--rm", "--no-deps", "linkkeep", "node", "-e", "const {spawn}=require('node:child_process'); const child=spawn(process.execPath,['scripts/start.mjs'],{stdio:'inherit'}); let tries=0; const timer=setInterval(async()=>{try{const response=await fetch('http://127.0.0.1:3000/api/health'); if(response.ok){clearInterval(timer);child.kill();process.exit(0);}}catch{} if(++tries>30){clearInterval(timer);child.kill();process.exit(1);}},1000);"]);
console.log('Container production startup and health verified');
