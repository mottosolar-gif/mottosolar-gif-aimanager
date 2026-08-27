import { mkdir, stat } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { spawnSync } from "node:child_process";

const require = createRequire(import.meta.url);
const wranglerPkgPath = require.resolve("wrangler/package.json");
const wranglerPkg = require("wrangler/package.json");
const binRelative =
  typeof wranglerPkg.bin === "string" ? wranglerPkg.bin : wranglerPkg.bin.wrangler;
const wranglerBin = path.join(path.dirname(wranglerPkgPath), binRelative);

const requestedMode = process.argv.includes("--remote")
  ? "remote"
  : process.argv.includes("--local")
    ? "local"
    : process.env.AIM_D1_MODE ?? "local";

if (requestedMode !== "local" && requestedMode !== "remote") {
  throw new Error("AIM_D1_MODE must be local or remote. Choose one and run npm run db:dump again.");
}

const timestamp = new Date().toISOString().replaceAll(":", "-");
const outputPath = path.resolve(
  process.env.AIM_DB_DUMP_PATH ?? `dumps/aim-db-${timestamp}.sql`,
);

try {
  await stat(outputPath);
  throw new Error(
    `Refusing to overwrite ${outputPath}. Choose a new AIM_DB_DUMP_PATH and retry.`,
  );
} catch (error) {
  if (error?.code !== "ENOENT") throw error;
}

await mkdir(path.dirname(outputPath), { recursive: true });

const config =
  requestedMode === "remote" ? "worker/wrangler.toml" : "worker/wrangler.local.toml";
const result = spawnSync(
  process.execPath,
  [
    wranglerBin,
    "d1",
    "export",
    "aim-db",
    `--${requestedMode}`,
    "--config",
    config,
    "--output",
    outputPath,
  ],
  { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
);

if (result.error) {
  throw new Error(`ไม่สามารถเรียก wrangler ได้: ${result.error.message}`);
}

if (result.status !== 0) {
  const detail = (result.stderr || result.stdout || "Wrangler returned no detail.").trim();
  throw new Error(
    `D1 dump failed in ${requestedMode} mode. Apply migrations and check the selected Wrangler configuration, then retry. ${detail}`,
  );
}

console.log(`D1 ${requestedMode} dump written to ${outputPath}`);
