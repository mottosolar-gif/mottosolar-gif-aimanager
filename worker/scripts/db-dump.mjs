import { mkdir, stat } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const requestedMode = process.argv.includes("--remote")
  ? "remote"
  : process.argv.includes("--local")
    ? "local"
    : process.env.AIM_D1_MODE ?? "local";

if (requestedMode !== "local" && requestedMode !== "remote") {
  throw new Error("AIM_D1_MODE must be local or remote. Choose one and run npm run db:dump again.");
}

const timestamp = new Date().toISOString().replaceAll(":", "-");
const outputPath = resolve(
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

await mkdir(dirname(outputPath), { recursive: true });

const config =
  requestedMode === "remote" ? "worker/wrangler.toml" : "worker/wrangler.local.toml";
const npx = process.platform === "win32" ? "npx.cmd" : "npx";
const result = spawnSync(
  npx,
  [
    "--no-install",
    "wrangler",
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

if (result.status !== 0) {
  const detail = (result.stderr || result.stdout || "Wrangler returned no detail.").trim();
  throw new Error(
    `D1 dump failed in ${requestedMode} mode. Apply migrations and check the selected Wrangler configuration, then retry. ${detail}`,
  );
}

console.log(`D1 ${requestedMode} dump written to ${outputPath}`);

