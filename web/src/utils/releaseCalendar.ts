import type { Game } from '../types';
import { onBacklogPage } from './library';

export interface ParsedRelease {
  /** Exact calendar day in local time (midnight), when day + month + year are known. */
  exactDate: Date | null;
  /** ISO YYYY-MM-DD key when `exactDate` is known. */
  isoDay: string | null;
  /** Display label such as "Dec 11, 2026", "Q1 2027", or "Coming soon". */
  label: string;
  /** True when the game has not yet been released relative to `now`. */
  unreleased: boolean;
  /** Whole days from `now` (midnight) until `exactDate`, when `exactDate` is known. */
  daysUntil: number | null;
}

const MONTHS: Record<string, number> = {
  jan: 0, january: 0,
  feb: 1, february: 1,
  mar: 2, march: 2,
  apr: 3, april: 3,
  may: 4,
  jun: 5, june: 5,
  jul: 6, july: 6,
  aug: 7, august: 7,
  sep: 8, sept: 8, september: 8,
  oct: 9, october: 9,
  nov: 10, november: 10,
  dec: 11, december: 11,
};

export function toIsoDayKey(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function startOfLocalDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

/**
 * Parse store or user-entered release date strings:
 * - ISO: "2026-12-11"
 * - Steam US: "Dec 11, 2026"
 * - Steam EU: "11 Dec, 2026" or "11 December 2026"
 * - Quarter / Window: "Q1 2027", "2027", "Coming soon", "TBA", "To be announced"
 */
export function parseGameRelease(game: Game, now: Date = new Date()): ParsedRelease {
  const today = startOfLocalDay(now);
  const currentYear = today.getFullYear();
  const raw = (game.meta?.releaseDate ?? '').trim();
  const comingSoonFlag = game.meta?.comingSoon === true;
  const releaseYear = game.meta?.releaseYear ?? null;

  // 1. ISO YYYY-MM-DD
  const isoMatch = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(raw);
  if (isoMatch) {
    const y = Number(isoMatch[1]);
    const m = Number(isoMatch[2]) - 1;
    const d = Number(isoMatch[3]);
    const exact = new Date(y, m, d);
    if (!Number.isNaN(exact.getTime()) && exact.getFullYear() === y && exact.getMonth() === m && exact.getDate() === d) {
      const daysUntil = Math.round((exact.getTime() - today.getTime()) / 86_400_000);
      const formatted = exact.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
      return {
        exactDate: exact,
        isoDay: toIsoDayKey(exact),
        label: formatted,
        unreleased: daysUntil > 0 || (daysUntil === 0 && comingSoonFlag),
        daysUntil,
      };
    }
  }

  // 2. "Dec 11, 2026"
  const mdyMatch = /^([A-Za-z]+)\s+(\d{1,2}),?\s+(\d{4})$/.exec(raw);
  if (mdyMatch) {
    const m = MONTHS[mdyMatch[1].toLowerCase()];
    const d = Number(mdyMatch[2]);
    const y = Number(mdyMatch[3]);
    if (m !== undefined) {
      const exact = new Date(y, m, d);
      if (!Number.isNaN(exact.getTime()) && exact.getMonth() === m && exact.getDate() === d) {
        const daysUntil = Math.round((exact.getTime() - today.getTime()) / 86_400_000);
        return {
          exactDate: exact,
          isoDay: toIsoDayKey(exact),
          label: raw,
          unreleased: daysUntil > 0 || (daysUntil === 0 && comingSoonFlag),
          daysUntil,
        };
      }
    }
  }

  // 3. "11 Dec, 2026" or "11 Dec 2026"
  const dmyMatch = /^(\d{1,2})\s+([A-Za-z]+),?\s+(\d{4})$/.exec(raw);
  if (dmyMatch) {
    const d = Number(dmyMatch[1]);
    const m = MONTHS[dmyMatch[2].toLowerCase()];
    const y = Number(dmyMatch[3]);
    if (m !== undefined) {
      const exact = new Date(y, m, d);
      if (!Number.isNaN(exact.getTime()) && exact.getMonth() === m && exact.getDate() === d) {
        const daysUntil = Math.round((exact.getTime() - today.getTime()) / 86_400_000);
        return {
          exactDate: exact,
          isoDay: toIsoDayKey(exact),
          label: raw,
          unreleased: daysUntil > 0 || (daysUntil === 0 && comingSoonFlag),
          daysUntil,
        };
      }
    }
  }

  // 4. Quarter / Month+Year / TBA / Coming soon strings
  if (raw) {
    const lower = raw.toLowerCase();
    const isTbaWord =
      lower.includes('coming soon') ||
      lower.includes('to be announced') ||
      lower === 'tba' ||
      lower === 'tbd' ||
      lower.includes('wishlist');
    const yearMatch = /\b(19\d{2}|20\d{2})\b/.exec(raw);
    const parsedYear = yearMatch ? Number(yearMatch[1]) : releaseYear;

    // Month + Year e.g. "December 2026"
    const myMatch = /^([A-Za-z]+)\s+(\d{4})$/.exec(raw);
    if (myMatch && MONTHS[myMatch[1].toLowerCase()] !== undefined) {
      const m = MONTHS[myMatch[1].toLowerCase()];
      const y = Number(myMatch[2]);
      const endOfMonth = new Date(y, m + 1, 0);
      const unreleased = comingSoonFlag || endOfMonth.getTime() > today.getTime();
      return {
        exactDate: null,
        isoDay: null,
        label: raw,
        unreleased,
        daysUntil: null,
      };
    }

    // Quarter e.g. "Q1 2027"
    const qMatch = /^Q([1-4])\s+(\d{4})$/i.exec(raw);
    if (qMatch) {
      const q = Number(qMatch[1]);
      const y = Number(qMatch[2]);
      const endMonth = q * 3; // 3, 6, 9, 12
      const endOfQuarter = new Date(y, endMonth, 0);
      return {
        exactDate: null,
        isoDay: null,
        label: raw.toUpperCase(),
        unreleased: comingSoonFlag || endOfQuarter.getTime() > today.getTime(),
        daysUntil: null,
      };
    }

    if (isTbaWord) {
      return {
        exactDate: null,
        isoDay: null,
        label: raw,
        unreleased: true,
        daysUntil: null,
      };
    }

    if (parsedYear !== null) {
      const unreleased = comingSoonFlag || parsedYear > currentYear;
      return {
        exactDate: null,
        isoDay: null,
        label: raw,
        unreleased,
        daysUntil: null,
      };
    }
  }

  // 5. Fallback to comingSoon flag or future releaseYear
  if (comingSoonFlag) {
    return {
      exactDate: null,
      isoDay: null,
      label: releaseYear ? String(releaseYear) : 'Coming soon',
      unreleased: true,
      daysUntil: null,
    };
  }

  if (releaseYear !== null && releaseYear > currentYear) {
    return {
      exactDate: null,
      isoDay: null,
      label: String(releaseYear),
      unreleased: true,
      daysUntil: null,
    };
  }

  return {
    exactDate: null,
    isoDay: null,
    label: releaseYear ? String(releaseYear) : '',
    unreleased: false,
    daysUntil: null,
  };
}

export interface UpcomingBacklogEntry {
  game: Game;
  release: ParsedRelease;
}

/**
 * Collect every Backlog / Planned game that has not yet been released, sorted
 * chronologically with exact-date titles first and TBA/window titles after.
 */
export function getUnreleasedBacklogGames(
  games: Game[],
  syncLibrary: boolean,
  backlogOn: string[],
  backlogOff: string[],
  now: Date = new Date(),
): UpcomingBacklogEntry[] {
  const candidates = games.filter(
    (g) => (g.planned === true || onBacklogPage(g, syncLibrary, backlogOn, backlogOff)) && g.status !== 'completed',
  );
  const unreleased: UpcomingBacklogEntry[] = [];
  for (const game of candidates) {
    // A game already played on disk with recorded sessions is clearly out unless explicitly marked comingSoon
    if (!game.planned && game.playSecs > 0 && game.meta?.comingSoon !== true) continue;
    const release = parseGameRelease(game, now);
    if (release.unreleased) {
      unreleased.push({ game, release });
    }
  }

  return unreleased.sort((a, b) => {
    if (a.release.exactDate && b.release.exactDate) {
      return a.release.exactDate.getTime() - b.release.exactDate.getTime() || a.game.title.localeCompare(b.game.title);
    }
    if (a.release.exactDate) return -1;
    if (b.release.exactDate) return 1;
    const ay = a.game.meta?.releaseYear ?? 9999;
    const by = b.game.meta?.releaseYear ?? 9999;
    return ay - by || a.game.title.localeCompare(b.game.title);
  });
}

export interface CalendarCell {
  date: Date;
  isoDay: string;
  inMonth: boolean;
  isToday: boolean;
  isPast: boolean;
  entries: UpcomingBacklogEntry[];
}

/**
 * Build a Steam Personal Calendar-style Monday-first month grid (weeks of 7 days)
 * for `(year, month)` where `month` is 0..11.
 */
export function buildPersonalCalendarGrid(
  year: number,
  month: number,
  entries: UpcomingBacklogEntry[],
  now: Date = new Date(),
): CalendarCell[] {
  const today = startOfLocalDay(now);
  const todayKey = toIsoDayKey(today);
  const byDay = new Map<string, UpcomingBacklogEntry[]>();
  for (const entry of entries) {
    if (!entry.release.isoDay) continue;
    const list = byDay.get(entry.release.isoDay) ?? [];
    list.push(entry);
    byDay.set(entry.release.isoDay, list);
  }

  const firstOfMonth = new Date(year, month, 1);
  // Convert JS Sunday=0..Saturday=6 into Monday=0..Sunday=6
  const startDow = (firstOfMonth.getDay() + 6) % 7;
  const gridStart = new Date(year, month, 1 - startDow);

  const lastOfMonth = new Date(year, month + 1, 0);
  const endDow = (lastOfMonth.getDay() + 6) % 7;
  const gridEnd = new Date(year, month + 1, 6 - endDow);

  const cells: CalendarCell[] = [];
  const cursor = new Date(gridStart);
  while (cursor.getTime() <= gridEnd.getTime()) {
    const cellDate = new Date(cursor.getFullYear(), cursor.getMonth(), cursor.getDate());
    const iso = toIsoDayKey(cellDate);
    cells.push({
      date: cellDate,
      isoDay: iso,
      inMonth: cellDate.getMonth() === month && cellDate.getFullYear() === year,
      isToday: iso === todayKey,
      isPast: cellDate.getTime() < today.getTime(),
      entries: byDay.get(iso) ?? [],
    });
    cursor.setDate(cursor.getDate() + 1);
  }
  return cells;
}
