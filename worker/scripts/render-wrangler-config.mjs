import { chmod, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const templateUrl = new URL("../wrangler.toml.example", import.meta.url);
const outputUrl = new URL("../wrangler.toml", import.meta.url);

function requiredIdentifier(name, pattern) {
  const value = process.env[name];
  if (!value || !pattern.test(value)) {
    throw new Error(
      `${name} is missing or malformed. Set it in the environment, then run npm run cf:config again.`,
    );
  }
  return value;
}

const accountId = requiredIdentifier("CLOUDFLARE_ACCOUNT_ID", /^[A-Za-z0-9_-]{16,64}$/);
const databaseId = requiredIdentifier(
  "CLOUDFLARE_D1_DATABASE_ID",
  /^[A-Fa-f0-9-]{32,36}$/,
);

const template = await readFile(templateUrl, "utf8");
const rendered = template
  .replace("__CLOUDFLARE_ACCOUNT_ID__", accountId)
  .replace("__CLOUDFLARE_D1_DATABASE_ID__", databaseId);

await writeFile(outputUrl, rendered, { encoding: "utf8", mode: 0o600 });
await chmod(fileURLToPath(outputUrl), 0o600);
console.log("Created ignored worker/wrangler.toml from environment values.");

