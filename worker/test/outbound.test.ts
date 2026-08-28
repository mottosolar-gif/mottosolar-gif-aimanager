import { describe, expect, it, vi } from "vitest";
import { type Fetcher, sendTextNotification } from "../src/outbound.ts";
import type { Env } from "../src/types.ts";

function env(overrides: Partial<Env> = {}): Env {
  return {
    AIM_ASK_KEY: "ask",
    AIM_LINK_KEY: "link",
    AIM_INGEST_KEY: "ingest",
    AIM_NOTIFY_KEY: "notify-secret",
    AIM_NOTIFY_URL: "https://notify.example/api/aim_notify.php",
    AIM_SOURCE_HASH_SALT: "salt",
    DB: {} as D1Database,
    ...overrides,
  };
}

describe("text notification outbound adapter", () => {
  it("sends the approved text-mode contract without putting the key in the URL or body", async () => {
    const fetcher = vi.fn<Fetcher>(async () =>
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );

    await expect(
      sendTextNotification(
        env(),
        "P-ASSIST",
        "ข้อความสรุปค่ะ",
        "28/08/2569:morning:P-ASSIST",
        fetcher,
      ),
    ).resolves.toEqual({ ok: true, reason: "sent" });

    expect(fetcher).toHaveBeenCalledTimes(1);
    const [url, init] = fetcher.mock.calls[0];
    expect(url).toBe("https://notify.example/api/aim_notify.php");
    expect(String(url)).not.toContain("notify-secret");
    expect(init?.headers).toMatchObject({
      "content-type": "application/json; charset=utf-8",
      "X-AIM-Notify-Key": "notify-secret",
      "X-AIM-Idempotency-Key": "28/08/2569:morning:P-ASSIST",
    });
    expect(init?.redirect).toBe("error");
    expect(JSON.parse(String(init?.body))).toEqual({
      kind: "text",
      person_code: "P-ASSIST",
      text: "ข้อความสรุปค่ะ",
    });
    expect(String(init?.body)).not.toContain("notify-secret");
  });

  it("fails closed for missing config, HTTP errors, and malformed success bodies", async () => {
    const fetcher = vi.fn(async () => new Response("no", { status: 503 }));
    await expect(
      sendTextNotification(env({ AIM_NOTIFY_KEY: "" }), "P-ASSIST", "x", "idem", fetcher),
    ).resolves.toEqual({ ok: false, reason: "config_missing", retryable: true });
    expect(fetcher).not.toHaveBeenCalled();

    await expect(
      sendTextNotification(env(), "P-ASSIST", "x", "idem", fetcher),
    ).resolves.toEqual({ ok: false, reason: "http_503", retryable: true });

    const permanent = vi.fn(async () => new Response("missing", { status: 404 }));
    await expect(
      sendTextNotification(env(), "P-ASSIST", "x", "idem", permanent),
    ).resolves.toEqual({ ok: false, reason: "http_404", retryable: false });

    const malformed = vi.fn(async () => new Response("not-json", { status: 200 }));
    await expect(
      sendTextNotification(env(), "P-ASSIST", "x", "idem", malformed),
    ).resolves.toEqual({ ok: false, reason: "invalid_response", retryable: false });
  });
});
