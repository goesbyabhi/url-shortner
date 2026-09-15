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

export interface LinkSummary {
  code: string;
  shortUrl: string;
  originalUrl: string;
  createdAt: string;
  expiresAt: string | null;
  clicks: number;
}

export interface LinksPage {
  links: LinkSummary[];
  nextCursor: number | null;
  /** Present on the first page only; null on subsequent pages */
  total: number | null;
}

export interface ShortenPayload {
  url: string;
  customAlias?: string;
  expiresInSeconds?: number;
}
