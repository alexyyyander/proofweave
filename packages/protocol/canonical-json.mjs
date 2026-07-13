/**
 * Serialize JSON deterministically before hashing or signing it. Protocol
 * payloads deliberately support only ordinary JSON values: objects with a
 * custom prototype, undefined values, and non-finite numbers are rejected.
 */
export function canonicalJson(value) {
  if (value === null) return "null";

  switch (typeof value) {
    case "boolean":
      return value ? "true" : "false";
    case "number":
      if (!Number.isFinite(value)) {
        throw new TypeError("Canonical JSON does not allow non-finite numbers.");
      }
      return JSON.stringify(value);
    case "string":
      return JSON.stringify(value);
    case "object":
      return canonicalObject(value);
    default:
      throw new TypeError(`Canonical JSON does not allow ${typeof value} values.`);
  }
}

export function canonicalUtf8(value) {
  return new TextEncoder().encode(canonicalJson(value));
}

export async function sha256Canonical(value) {
  const digest = await crypto.subtle.digest("SHA-256", canonicalUtf8(value));
  return `sha256:${toHex(new Uint8Array(digest))}`;
}

function canonicalObject(value) {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }

  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new TypeError("Canonical JSON accepts only plain objects.");
  }

  const entries = Object.entries(value).sort(([left], [right]) =>
    left < right ? -1 : left > right ? 1 : 0,
  );
  return `{${entries.map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`).join(",")}}`;
}

function toHex(bytes) {
  return [...bytes]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}
