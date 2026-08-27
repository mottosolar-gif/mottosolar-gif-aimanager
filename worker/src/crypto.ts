const encoder = new TextEncoder();

function toHex(bytes: ArrayBuffer): string {
  return [...new Uint8Array(bytes)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export async function sha256Bytes(value: ArrayBuffer): Promise<string> {
  return toHex(await crypto.subtle.digest("SHA-256", value));
}

export async function sha256Text(value: string): Promise<string> {
  return sha256Bytes(encoder.encode(value).buffer);
}

export async function constantTimeEqual(left: string, right: string): Promise<boolean> {
  const [leftDigest, rightDigest] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(left)),
    crypto.subtle.digest("SHA-256", encoder.encode(right)),
  ]);
  const leftBytes = new Uint8Array(leftDigest);
  const rightBytes = new Uint8Array(rightDigest);
  let difference = 0;
  for (let index = 0; index < leftBytes.length; index += 1) {
    difference |= leftBytes[index] ^ rightBytes[index];
  }
  return difference === 0;
}

export async function hashSourceId(rawSourceId: string, salt: string): Promise<string> {
  // The separator prevents ambiguous concatenations; only the digest leaves this request.
  return sha256Text(`${salt}\u0000${rawSourceId}`);
}
