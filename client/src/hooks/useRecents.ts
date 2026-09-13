import { useCallback, useState } from "react";
import type { RecentLink } from "../types";

const KEY = "snip:recents";
const MAX = 10;

function load(): RecentLink[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as RecentLink[]) : [];
  } catch {
    return [];
  }
}

export function useRecents(): {
  recents: RecentLink[];
  addRecent: (link: RecentLink) => void;
  removeRecent: (code: string) => void;
} {
  const [recents, setRecents] = useState<RecentLink[]>(load);

  const persist = useCallback((next: RecentLink[]) => {
    setRecents(next);
    try {
      localStorage.setItem(KEY, JSON.stringify(next));
    } catch {
      // storage full/unavailable — the in-memory list still works
    }
  }, []);

  const addRecent = useCallback(
    (link: RecentLink) => {
      persist([link, ...recents.filter((r) => r.code !== link.code)].slice(0, MAX));
    },
    [recents, persist]
  );

  const removeRecent = useCallback(
    (code: string) => {
      persist(recents.filter((r) => r.code !== code));
    },
    [recents, persist]
  );

  return { recents, addRecent, removeRecent };
}
