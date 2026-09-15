export type UrlCheck = { ok: true; url: string } | { ok: false; error: string };

const RESERVED_ALIAS_PREFIXES = ["api", "health"];
const RESERVED_ALIASES = new Set(["admin", "root"]);

export function validateUrl(raw: unknown): UrlCheck {
  if (typeof raw !== "string") return { ok: false, error: "url must be a string" };
  const trimmed = raw.trim();
  if (trimmed.length === 0) return { ok: false, error: "url is required" };
  if (trimmed.length > 2048) return { ok: false, error: "url must be at most 2048 characters" };

  // UX nicety: accept scheme-less input ("example.com/page")
  const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;

  let parsed: URL;
  try {
    parsed = new URL(withScheme);
  } catch {
    return { ok: false, error: "invalid url" };
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return { ok: false, error: "only http and https urls are supported" };
  }
  if (parsed.hostname.length === 0) return { ok: false, error: "url is missing a hostname" };
  // Hostname must look like a domain, IP, or localhost — rejects scheme-prepending
  // accidents like "ftp://example.com" becoming "https://ftp://example.com".
  const host = parsed.hostname;
  const hostOk = host === "localhost" || host.includes(".") || host.includes(":");
  if (!hostOk) return { ok: false, error: "url is missing a valid hostname" };

  return { ok: true, url: parsed.toString() };
}

export type AliasCheck = { ok: true; alias: string } | { ok: false; error: string };

export function validateAlias(raw: unknown): AliasCheck {
  if (typeof raw !== "string") return { ok: false, error: "customAlias must be a string" };
  const alias = raw.trim();
  if (!/^[a-zA-Z0-9_-]{3,32}$/.test(alias)) {
    return { ok: false, error: "alias must be 3-32 characters: letters, numbers, - or _" };
  }
  const lower = alias.toLowerCase();
  if (RESERVED_ALIASES.has(lower) || RESERVED_ALIAS_PREFIXES.some((p) => lower.startsWith(p))) {
    return { ok: false, error: "that alias is reserved" };
  }
  return { ok: true, alias };
}

export function validateExpiresInSeconds(raw: unknown): { ok: true; seconds: number } | { ok: false; error: string } {
  const min = 1;
  const max = 31_536_000; // one year
  const n = Number(raw);
  if (!Number.isInteger(n) || n < min || n > max) {
    return { ok: false, error: `expiresInSeconds must be an integer between ${min} and ${max}` };
  }
  return { ok: true, seconds: n };
}

export function isValidCode(code: string): boolean {
  return /^[a-zA-Z0-9_-]{1,32}$/.test(code);
}
