import type { LinkStats, ShortenPayload, ShortenResponse } from "./types";

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

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
  return request<ShortenResponse>("/api/shorten", { method: "POST", body: JSON.stringify(payload) });
}

export function getStats(code: string): Promise<LinkStats> {
  return request<LinkStats>(`/api/stats/${encodeURIComponent(code)}`);
}
