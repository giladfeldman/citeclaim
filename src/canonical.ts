import { createHash } from 'node:crypto';

/**
 * Canonical JSON: object keys sorted, no whitespace, non-ASCII characters kept
 * as-is (UTF-8). Identical to Python's
 *   json.dumps(obj, sort_keys=True, separators=(",", ":"), ensure_ascii=False)
 * for values made of strings, integers, booleans, null, arrays and objects.
 * Floats are the one difference between the two languages (Python writes 0.0,
 * JavaScript writes 0), so a call config holds integers or strings, never a
 * float written as a whole number. canonicalJson throws on a non-finite number
 * and on an integer beyond 2^53. Numbers are written the JavaScript way
 * (JSON.stringify); the Python side reproduces that format, and keys sort by
 * UTF-16 code unit on both sides.
 */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') {
    return JSON.stringify(value);
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error(`canonicalJson: non-finite number ${value}`);
    // An integer JavaScript cannot represent exactly would hash differently from
    // the same value in Python, so it is refused rather than rounded.
    if (Number.isInteger(value) && !Number.isSafeInteger(value)) {
      throw new Error(`canonicalJson: integer ${value} is outside the exactly representable range`);
    }
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((v) => canonicalJson(v)).join(',')}]`;
  }
  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    const keys = Object.keys(obj).filter((k) => obj[k] !== undefined).sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(obj[k])}`).join(',')}}`;
  }
  throw new Error(`canonicalJson: unsupported type ${typeof value}`);
}

export function sha256Hex(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

export function canonicalSha256(value: unknown): string {
  return sha256Hex(canonicalJson(value));
}
