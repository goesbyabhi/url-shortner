export interface ShortenResponse {
  code: string;
  shortUrl: string;
  originalUrl: string;
  expiresAt: string | null;
}

export interface LinkStats {
  code: string;
  originalUrl: string;
  createdAt: string;
  expiresAt: string | null;
  totalClicks: number;
  byDay: { day: string; clicks: number }[];
  topReferrers: { referrer: string; clicks: number }[];
}

export interface RecentLink {
  code: string;
  shortUrl: string;
  originalUrl: string;
  createdAt: string;
  expiresAt: string | null;
}

export interface ShortenPayload {
  url: string;
  customAlias?: string;
  expiresInSeconds?: number;
}
