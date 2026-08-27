export interface SafeLogRecord {
  ts: string;
  eventType: string;
  result: string;
  ref: string;
}

export function writeSafeLog(record: SafeLogRecord): void {
  // Callers pass only enumerated metadata. Never widen this function to accept payloads.
  console.log(JSON.stringify(record));
}

