import type { LinkStats, LinksPage, ShortenPayload, ShortenResponse } from "./types";

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

// Same-origin by default (vite dev proxy / nginx prod); set VITE_API_URL at build
// time when the SPA and API live on different origins (e.g. Cloudflare Pages).
const API_BASE = (import.meta.env.VITE_API_URL ?? "").replace(/\/+$/, "");

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      headers: { "Content-Type": "application/json" },
      ...init,
    });
  } catch {
    throw new ApiError("can't reach the api — is the server running?", 0);
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
