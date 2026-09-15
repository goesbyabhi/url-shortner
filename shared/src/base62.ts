import { randomBytes } from "node:crypto";

// 62-char alphabet: 0-9, a-z, A-Z. 62^7 ≈ 3.5 trillion codes.
const ALPHABET = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";
const BASE = BigInt(ALPHABET.length);

export function encode(n: bigint): string {
  if (n < 0n) throw new RangeError("encode expects a non-negative integer");
  if (n === 0n) return ALPHABET[0]!;
  let out = "";
  while (n > 0n) {
    out = ALPHABET[Number(n % BASE)] + out;
    n = n / BASE;
  }
  return out;
}

export function decode(s: string): bigint {
  if (s.length === 0) throw new RangeError("decode expects a non-empty string");
  let n = 0n;
  for (const ch of s) {
    const d = ALPHABET.indexOf(ch);
    if (d === -1) throw new RangeError(`invalid base62 character: ${ch}`);
    n = n * BASE + BigInt(d);
  }
  return n;
}

/**
 * Cryptographically secure random code. Uses rejection sampling per byte to
 * avoid modulo bias (256 % 62 != 0).
 */
export function randomCode(length: number): string {
  const bytes = randomBytes(length * 2);
  let out = "";
  let i = 0;
  while (out.length < length) {
    const b = bytes[i++];
    if (b === undefined) throw new Error("randomBytes exhausted");
    if (b < 248) out += ALPHABET[b % ALPHABET.length]!; // 248 = 62 * 4
  }
  return out;
}
