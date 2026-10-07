import { loadEnvFile } from "node:process";
import { existsSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { assertProductionConfiguration } from "../src/config/production.mjs";

if (existsSync(".env")) loadEnvFile(".env");
process.env.NODE_ENV = "production";
assertProductionConfiguration(process.env);
process.env.DATABASE_PATH = path.resolve(process.env.DATABASE_PATH ?? "data/linkkeep.db");
const entry = existsSync(".next/standalone/server.js") ? ".next/standalone/server.js" : "server.js";
await import(pathToFileURL(path.resolve(entry)).href);
