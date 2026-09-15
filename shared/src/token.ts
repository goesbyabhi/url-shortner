import { createHash, randomBytes } from "node:crypto";

/**
 * 32 random bytes as base64url (43 chars). Header-safe, no padding, and
 * 256 bits of entropy — brute-forcing a key is not a realistic attack.
 */
export function generateToken(): string {
  return randomBytes(32).toString("base64url");
}

/**
 * API keys are stored as SHA-256 hashes, never in plaintext: a leaked database
 * (backup, replica, log) cannot be replayed against the API. Cheap here because
 * tokens are high-entropy, so no salt/slow-KDF is needed — unlike passwords.
 */
export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}
