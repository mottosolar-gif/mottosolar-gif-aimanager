import { hashSourceId } from "./crypto.ts";
import type { EventMetadata } from "./types.ts";

const eventTypes = new Set([
  "accountLink",
  "beacon",
  "follow",
  "join",
  "leave",
  "memberJoined",
  "memberLeft",
  "message",
  "postback",
  "things",
  "unfollow",
  "unsend",
  "videoPlayComplete",
]);
const messageTypes = new Set([
  "audio",
  "file",
  "image",
  "location",
  "sticker",
  "text",
  "video",
]);
const sourceIdFields = {
  group: "groupId",
  room: "roomId",
  user: "userId",
} as const;
const postbackDataPattern = /^[A-Za-z0-9=&_-]*$/;

type JsonRecord = Record<string, unknown>;

export class InvalidPayloadError extends Error {}

function asRecord(value: unknown, label: string): JsonRecord {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new InvalidPayloadError(`${label} must be an object`);
  }
  return value as JsonRecord;
}

function requiredToken(value: unknown, label: string, allowed?: Set<string>): string {
  if (typeof value !== "string" || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(value)) {
    throw new InvalidPayloadError(`${label} is missing or malformed`);
  }
  if (allowed && !allowed.has(value)) {
    throw new InvalidPayloadError(`${label} is unsupported`);
  }
  return value;
}

function requiredEventId(value: unknown): string {
  const eventId = requiredToken(value, "webhookEventId");
  if (/^[UC][0-9a-f]{32}$/i.test(eventId)) {
    throw new InvalidPayloadError("webhookEventId cannot be a raw LINE identifier");
  }
  return eventId;
}

function occurredAt(value: unknown): string {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new InvalidPayloadError("timestamp is missing or malformed");
  }
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) {
    throw new InvalidPayloadError("timestamp is outside the supported range");
  }
  return date.toISOString();
}

export async function extractMetadata(
  payload: unknown,
  receivedAt: string,
  payloadBytes: number,
  payloadSha256: string,
  sourceHashSalt: string,
): Promise<EventMetadata[]> {
  const envelope = asRecord(payload, "payload");
  if (!Array.isArray(envelope.events) || envelope.events.length === 0) {
    throw new InvalidPayloadError("events must be a non-empty array");
  }
  if (envelope.events.length > 50) {
    throw new InvalidPayloadError(
      "send at most 50 events per request; split into multiple requests",
    );
  }

  return Promise.all(
    envelope.events.map(async (rawEvent, index) => {
      const event = asRecord(rawEvent, `events[${index}]`);
      const eventId = requiredEventId(event.webhookEventId);
      const eventType = requiredToken(event.type, "event type", eventTypes);
      const source = asRecord(event.source, "source");
      const sourceType = requiredToken(
        source.type,
        "source type",
        new Set(Object.keys(sourceIdFields)),
      ) as keyof typeof sourceIdFields;
      const sourceIdValue = source[sourceIdFields[sourceType]];
      if (
        typeof sourceIdValue !== "string" ||
        sourceIdValue.length === 0 ||
        sourceIdValue.length > 128
      ) {
        throw new InvalidPayloadError("source identifier is missing or malformed");
      }

      let messageType: string | null = null;
      if (eventType === "message") {
        const message = asRecord(event.message, "message");
        messageType = requiredToken(message.type, "message type", messageTypes);
      }

      let postbackData: string | null = null;
      if (eventType === "postback") {
        const postback = event.postback;
        if (typeof postback === "object" && postback !== null && !Array.isArray(postback)) {
          const data = (postback as JsonRecord).data;
          if (
            typeof data === "string" &&
            data.length <= 256 &&
            postbackDataPattern.test(data)
          ) {
            postbackData = data;
          }
        }
      }

      return {
        eventId,
        eventType,
        messageType,
        sourceType,
        sourceHash: await hashSourceId(sourceIdValue, sourceHashSalt),
        postbackData,
        occurredAt: occurredAt(event.timestamp),
        receivedAt,
        payloadBytes,
        payloadSha256,
      };
    }),
  );
}
