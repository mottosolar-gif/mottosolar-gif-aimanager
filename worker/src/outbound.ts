import type { Env } from "./types.ts";

export type OutboundResult =
  | { ok: true; reason: "sent" }
  | { ok: false; reason: string; retryable: boolean };

export type Fetcher = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

const notifyTimeoutMilliseconds = 10_000;

export async function sendTextNotification(
  env: Env,
  personCode: string,
  text: string,
  idempotencyKey: string,
  fetcher: Fetcher = fetch,
): Promise<OutboundResult> {
  if (!env.AIM_NOTIFY_URL || !env.AIM_NOTIFY_KEY) {
    return { ok: false, reason: "config_missing", retryable: true };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), notifyTimeoutMilliseconds);
  try {
    const response = await fetcher(env.AIM_NOTIFY_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json; charset=utf-8",
        "X-AIM-Notify-Key": env.AIM_NOTIFY_KEY,
        "X-AIM-Idempotency-Key": idempotencyKey,
      },
      body: JSON.stringify({ kind: "text", person_code: personCode, text }),
      redirect: "error",
      signal: controller.signal,
    });
    if (!response.ok) {
      return {
        ok: false,
        reason: `http_${response.status}`,
        retryable: response.status < 400 || response.status >= 500,
      };
    }

    let body: unknown;
    try {
      body = await response.json();
    } catch {
      return { ok: false, reason: "invalid_response", retryable: false };
    }
    if (
      typeof body !== "object" ||
      body === null ||
      Array.isArray(body) ||
      (body as Record<string, unknown>).ok !== true
    ) {
      return { ok: false, reason: "endpoint_rejected", retryable: false };
    }
    return { ok: true, reason: "sent" };
  } catch {
    return { ok: false, reason: "network", retryable: true };
  } finally {
    clearTimeout(timeout);
  }
}
