type CryptoLike = {
  randomUUID?: () => string;
  getRandomValues?: (array: Uint8Array) => Uint8Array;
};

let fallbackSequence = 0;

function formatUuidV4(bytes: Uint8Array): string {
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x40;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = Array.from(bytes, (value) => value.toString(16).padStart(2, "0"));
  return `${hex.slice(0, 4).join("")}-${hex.slice(4, 6).join("")}-${hex.slice(6, 8).join("")}-${hex.slice(8, 10).join("")}-${hex.slice(10, 16).join("")}`;
}

function mathRandomByte(index: number): number {
  try {
    return Math.floor(Math.random() * 256);
  } catch {
    fallbackSequence = (fallbackSequence + 1) >>> 0;
    let now = 0;
    try {
      now = Date.now();
    } catch {
      // Keep the final fallback operational even in a heavily restricted context.
    }
    return (now + fallbackSequence * 31 + index * 17) & 0xff;
  }
}

/** Creates an RFC-4122 v4 UUID without assuming Web Crypto is available. */
export function safeRandomUUID(): string {
  try {
    const cryptoObject = globalThis.crypto as CryptoLike | undefined;
    if (typeof cryptoObject?.randomUUID === "function") {
      try {
        const value = cryptoObject.randomUUID.call(cryptoObject);
        if (typeof value === "string" && value.length > 0) return value;
      } catch {
        // Fall through to getRandomValues or the Math.random implementation.
      }
    }

    if (typeof cryptoObject?.getRandomValues === "function") {
      try {
        const bytes = new Uint8Array(16);
        cryptoObject.getRandomValues.call(cryptoObject, bytes);
        return formatUuidV4(bytes);
      } catch {
        // Fall through to the Math.random implementation.
      }
    }
  } catch {
    // Access to global crypto itself can be blocked in sandboxed contexts.
  }

  fallbackSequence = (fallbackSequence + 1) >>> 0;
  const bytes = new Uint8Array(16);
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = mathRandomByte(index);
  }
  bytes[0] = ((bytes[0] ?? 0) ^ (fallbackSequence & 0xff)) & 0xff;
  bytes[1] = ((bytes[1] ?? 0) ^ ((fallbackSequence >>> 8) & 0xff)) & 0xff;
  return formatUuidV4(bytes);
}
