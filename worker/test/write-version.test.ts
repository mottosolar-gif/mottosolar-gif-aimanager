// write-version.test.ts — เฝ้า worker/scripts/write-version.mjs ที่รันจริงทุกครั้งที่ deploy production
// (npm run deploy -> node worker/scripts/write-version.mjs && wrangler deploy) แต่ไม่เคยมีเทสจับมาก่อน:
// eslint.config.mjs:4 ignore "**/*.mjs" ทั้งไฟล์ · tsc ไม่ check เพราะไม่อยู่ใน tsconfig include ·
// ⇒ ตรรกะสำคัญ 3 จุด (cleanSha กัน injection, ลำดับ fallback หา sha, เขียนไฟล์ไม่ได้ต้องไม่ throw) ไม่เคยถูกพิสูจน์
//
// สคริปต์เป็น .mjs ไม่มี .d.ts คู่กัน (ตั้งใจ ไม่แก้ tsconfig.json/eslint.config.mjs — นอกขอบเขตงานนี้)
// ⇒ import ตรงจะชน TS7016 (implicit any) จุดเดียว ปิดเฉพาะบรรทัดนั้นด้วย @ts-expect-error แล้ว cast
// ชนิดให้ทันทีด้านล่าง เพื่อให้โค้ดเทสที่เหลือทั้งไฟล์ยังพิมพ์ type ถูกตามปกติ (vitest/esbuild ไม่เช็ก type อยู่แล้ว)
import { describe, expect, it, vi } from "vitest";
// @ts-expect-error -- .mjs ไม่มีไฟล์ประกาศชนิดคู่กัน (by design ตามขอบเขตงานนี้) ดูคอมเมนต์ด้านบน
import { cleanSha as cleanShaRaw, resolveSha as resolveShaRaw, writeVersionFile as writeVersionFileRaw } from "../scripts/write-version.mjs";

const cleanSha = cleanShaRaw as (value: unknown) => string;
const resolveSha = resolveShaRaw as (
  env: Record<string, string | undefined>,
  runGit: () => string,
) => string;
const writeVersionFile = writeVersionFileRaw as (
  targetPath: string,
  sha: string,
  builtAt: string,
  fsWrite?: (path: string, data: string, encoding: string) => void,
) => boolean;

describe("cleanSha — กันของแปลกปลอมฝังลงซอร์ส TypeScript", () => {
  it("รับ sha รูปร่างถูกต้อง (40 hex และ 12 hex) แล้ว lowercase ให้", () => {
    const full = "A".repeat(40);
    const short = "B".repeat(12);
    expect(cleanSha(full)).toBe(full.toLowerCase());
    expect(cleanSha(full)).toHaveLength(40);
    expect(cleanSha(short)).toBe(short.toLowerCase());
    expect(cleanSha(short)).toHaveLength(12);
  });

  it("ปฏิเสธของแปลกปลอมทุกรูปแบบ (fail-closed) — คืนค่าว่างเสมอ ไม่ throw", () => {
    const badValues: unknown[] = [
      '"; DROP TABLE task; --', // quote
      "abc def0123", // space
      "abcdef012345;", // semicolon
      "abcdef${process.env.SECRET}", // template injection
      "", // empty
      123456789012, // ไม่ใช่ string
      null,
      undefined,
      {},
    ];
    for (const value of badValues) {
      expect(cleanSha(value)).toBe("");
    }
  });
});

describe("resolveSha — ลำดับ fallback WORKERS_CI_COMMIT_SHA -> GITHUB_SHA -> git -> unknown", () => {
  it("เลือก WORKERS_CI_COMMIT_SHA ก่อนเสมอ แม้ GITHUB_SHA และ git จะมีค่าที่ถูกต้องด้วย", () => {
    const runGit = vi.fn(() => "c".repeat(40));
    const sha = resolveSha(
      { WORKERS_CI_COMMIT_SHA: "A".repeat(40), GITHUB_SHA: "b".repeat(40) },
      runGit,
    );
    expect(sha).toBe("a".repeat(12));
    expect(runGit).not.toHaveBeenCalled();
  });

  it("ตกไป GITHUB_SHA เมื่อ WORKERS_CI_COMMIT_SHA ไม่มี/ไม่ใช่รูปร่าง sha", () => {
    const runGit = vi.fn(() => "c".repeat(40));
    const missing = resolveSha({ GITHUB_SHA: "B".repeat(40) }, runGit);
    expect(missing).toBe("b".repeat(12));
    expect(runGit).not.toHaveBeenCalled();

    const malformed = resolveSha(
      { WORKERS_CI_COMMIT_SHA: "not a sha", GITHUB_SHA: "D".repeat(40) },
      runGit,
    );
    expect(malformed).toBe("d".repeat(12));
    expect(runGit).not.toHaveBeenCalled();
  });

  it("ตกไปหา git เฉพาะตอนทั้งสอง env ไม่มี/ไม่ใช่รูปร่าง sha", () => {
    const runGit = vi.fn(() => "E".repeat(40));
    const sha = resolveSha({ WORKERS_CI_COMMIT_SHA: "", GITHUB_SHA: "bad" }, runGit);
    expect(sha).toBe("e".repeat(12));
    expect(runGit).toHaveBeenCalledTimes(1);
  });

  it('คืน "unknown" เมื่อ env ไม่มีค่าและ git runner throw (ไม่มี git ในเครื่อง build)', () => {
    const runGit = vi.fn(() => {
      throw new Error("git not found");
    });
    const sha = resolveSha({}, runGit);
    expect(sha).toBe("unknown");
    expect(runGit).toHaveBeenCalledTimes(1);
  });
});

describe("writeVersionFile — ต้องไม่ throw แม้เขียนไฟล์ไม่ได้", () => {
  it("เขียนเนื้อไฟล์รูปแบบ two-export เป๊ะ แล้วคืน true", () => {
    const calls: Array<[string, string, string]> = [];
    const fsWrite = (path: string, data: string, encoding: string) => {
      calls.push([path, data, encoding]);
    };

    const ok = writeVersionFile("/fake/worker/src/version.ts", "abc123def456", "2026-09-10T00:00:00.000Z", fsWrite);

    expect(ok).toBe(true);
    expect(calls).toHaveLength(1);
    const [path, contents, encoding] = calls[0];
    expect(path).toBe("/fake/worker/src/version.ts");
    expect(encoding).toBe("utf8");
    expect(contents).toBe(
      "// ไฟล์นี้ถูกเขียนทับตอน deploy โดย worker/scripts/write-version.mjs — ห้ามแก้ด้วยมือ\n" +
        'export const GIT_SHA = "abc123def456";\n' +
        'export const BUILT_AT = "2026-09-10T00:00:00.000Z";\n',
    );
  });

  it("เมื่อตัวเขียนไฟล์ที่ฉีดเข้ามา throw ต้องไม่ throw ออกมา — คืน false แทน", () => {
    const throwingWrite = () => {
      throw new Error("EACCES: permission denied");
    };

    let result: boolean | undefined;
    expect(() => {
      result = writeVersionFile("/fake/worker/src/version.ts", "unknown", "", throwingWrite);
    }).not.toThrow();
    expect(result).toBe(false);
  });
});
