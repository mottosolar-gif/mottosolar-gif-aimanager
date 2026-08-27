export interface Env {
  AIM_INGEST_KEY: string;
  AIM_SOURCE_HASH_SALT: string;
  DB: D1Database;
}

export interface EventMetadata {
  eventId: string;
  eventType: string;
  messageType: string | null;
  sourceType: string;
  sourceHash: string | null;
  occurredAt: string;
  receivedAt: string;
  payloadBytes: number;
  payloadSha256: string;
}

export interface IngestResult {
  accepted: number;
  duplicates: number;
}

