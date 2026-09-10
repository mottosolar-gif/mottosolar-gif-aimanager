// เขียน worker/src/version.ts ใหม่ก่อน deploy ทุกครั้ง เพื่อให้ /healthz บอกได้ว่า production
// รัน commit ไหนอยู่ · Workers Builds สั่ง `npm run deploy` ⇒ สคริปต์นี้ต้องทำงานเองโดยไม่มีใครกด
// กติกา: ห้าม throw เด็ดขาด — อ่าน sha ไม่ได้ให้เขียน "unknown" ไม่ใช่ล้ม deploy ทิ้ง
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

// ค่าที่อ่านมาจะถูกฝังลงซอร์ส TypeScript ⇒ รับเฉพาะรูปร่าง sha จริงเท่านั้น
// ของแปลกปลอม (ช่องว่าง · เครื่องหมายคำพูด · โค้ด) = ไม่รู้จัก ⇒ ตกไปหาแหล่งถัดไป (fail-closed)
export function cleanSha(value) {
  if (typeof value !== "string") return "";
  const trimmed = value.trim();
  return /^[0-9a-fA-F]{7,64}$/.test(trimmed) ? trimmed.toLowerCase() : "";
}

// runGit ถูกฉีดเข้ามาแทนเรียก execFileSync ตรง ๆ ⇒ เทสสั่งให้พัง/คืนค่าอะไรก็ได้โดยไม่ต้องมี git จริง
function shaFromGit(runGit) {
  try {
    return cleanSha(runGit());
  } catch {
    // ไม่มี git ในเครื่องที่ build (Workers Builds ใช้ env แทนอยู่แล้ว) = ไม่ใช่ความล้มเหลว
    return "";
  }
}

// env/runGit ถูกฉีดเข้ามาแทน process.env/execFileSync ตรง ๆ ⇒ ฟังก์ชันนี้ pure ทดสอบได้ไม่ง้อเครื่องจริง
// ลำดับหาค่า: WORKERS_CI_COMMIT_SHA -> GITHUB_SHA -> git rev-parse HEAD -> "unknown"
export function resolveSha(env, runGit) {
  try {
    const sha =
      cleanSha(env.WORKERS_CI_COMMIT_SHA) ||
      cleanSha(env.GITHUB_SHA) ||
      shaFromGit(runGit);
    return sha ? sha.slice(0, 12) : "unknown";
  } catch {
    return "unknown";
  }
}

function resolveBuiltAt() {
  try {
    return new Date().toISOString();
  } catch {
    return "";
  }
}

// fsWrite ถูกฉีดเข้ามาแทน writeFileSync ตรง ๆ ⇒ เทสเคส "เขียนไม่ได้" ได้โดยไม่ต้องพังดิสก์จริง
// กติกา: เขียนไม่ได้ห้าม throw — คืน false แล้วให้ผู้เรียก (main) ตัดสินใจว่าจะเตือนยังไง
export function writeVersionFile(targetPath, sha, builtAt, fsWrite = writeFileSync) {
  const contents =
    "// ไฟล์นี้ถูกเขียนทับตอน deploy โดย worker/scripts/write-version.mjs — ห้ามแก้ด้วยมือ\n" +
    `export const GIT_SHA = ${JSON.stringify(sha)};\n` +
    `export const BUILT_AT = ${JSON.stringify(builtAt)};\n`;
  try {
    fsWrite(targetPath, contents, "utf8");
    return true;
  } catch {
    return false;
  }
}

function main() {
  const outputUrl = new URL("../src/version.ts", import.meta.url);
  const runGit = () =>
    execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: new URL("../..", import.meta.url),
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 10_000,
    });

  const gitSha = resolveSha(process.env, runGit);
  const builtAt = resolveBuiltAt();

  if (writeVersionFile(outputUrl, gitSha, builtAt)) {
    console.log(`worker/src/version.ts -> GIT_SHA=${gitSha} BUILT_AT=${builtAt}`);
  } else {
    // เขียนไฟล์ไม่ได้ = ของเดิมในรีโปยังอยู่ (GIT_SHA="dev") · แจ้งให้เห็นแต่ไม่ล้ม deploy
    console.warn(
      `worker/src/version.ts not rewritten; the committed default stays in the bundle.`,
    );
  }
}

// รันเป็น CLI จริงเท่านั้นถึงจะทำงาน (Workers Builds เรียก `node worker/scripts/write-version.mjs`)
// import เข้าไปเทส (worker/test/write-version.test.ts) ต้องไม่ทำให้เขียนไฟล์จริงโดยไม่ได้ตั้งใจ
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
