import type { LinkStats, LinksPage, ShortenPayload, ShortenResponse } from "./types";

// Same-origin by default (vite dev proxy / nginx prod); set VITE_API_URL at build
// time when the SPA and API live on different origins (e.g. Cloudflare Pages).
const API_BASE = (import.meta.env.VITE_API_URL ?? "").replace(/\/+$/, "");

// Where the anonymous API key lives. Clearing site data loses the key (and with
// it, access to your links) — the tradeoff of having no accounts.
const KEY_STORAGE = "snip:api_key";

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

function readKey(): string | null {
  try {
    return localStorage.getItem(KEY_STORAGE);
  } catch {
    return null;
  }
}

function writeKey(token: string): void {
  try {
    localStorage.setItem(KEY_STORAGE, token);
  } catch {
    // private mode / storage disabled: the key still works for this page load
  }
}

function clearKey(): void {
  try {
    localStorage.removeItem(KEY_STORAGE);
  } catch {
    // ignore
  }
}

let inflightKey: Promise<string> | null = null;

/**
 * Anonymous key, provisioned once on first use and reused from localStorage.
 * Concurrent callers share a single /api/keys request.
 */
function ensureKey(forceReissue = false): Promise<string> {
  if (forceReissue) clearKey();
  const existing = readKey();
  if (existing) return Promise.resolve(existing);

  inflightKey ??= (async () => {
    let res: Response;
    try {
      res = await fetch(`${API_BASE}/api/keys`, { method: "POST" });
    } catch {
      throw new ApiError("can't reach the api — is the server running?", 0);
    }
    const body = (await res.json().catch(() => ({}))) as { token?: string; error?: string };
    if (!res.ok || !body.token) {
      throw new ApiError(body.error ?? "could not provision an api key", res.status);
    }
    writeKey(body.token);
    return body.token;
  })().finally(() => {
    inflightKey = null;
  });

  return inflightKey;
}

async function request<T>(path: string, init?: RequestInit, canRetry = true): Promise<T> {
  const token = await ensureKey();

  let res: Response;
  try {
    res = await fetch(path, {
      ...init,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
        ...(init?.headers ?? {}),
      },
    });
  } catch {
    throw new ApiError("can't reach the api — is the server running?", 0);
  }

  // Key revoked or no longer recognised: mint a fresh one and replay once.
  if (res.status === 401 && canRetry) {
    await ensureKey(true);
    return request<T>(path, init, false);
  }

  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    throw new ApiError(typeof body.error === "string" ? body.error : "something went wrong", res.status);
  }
  return body as T;
}

export function shorten(payload: ShortenPayload): Promise<ShortenResponse> {
  return request<ShortenResponse>(`${API_BASE}/api/shorten`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function getStats(code: string): Promise<LinkStats> {
  return request<LinkStats>(`${API_BASE}/api/stats/${encodeURIComponent(code)}`);
}

export function listLinks(limit = 20, cursor?: number): Promise<LinksPage> {
  const params = new URLSearchParams({ limit: String(limit) });
  if (cursor !== undefined) params.set("cursor", String(cursor));
  return request<LinksPage>(`${API_BASE}/api/links?${params.toString()}`);
}

export function deleteLink(code: string): Promise<void> {
  return request<void>(`${API_BASE}/api/links/${encodeURIComponent(code)}`, { method: "DELETE" });
}
