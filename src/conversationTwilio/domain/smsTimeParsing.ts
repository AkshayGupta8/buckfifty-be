import { DateTime } from "luxon";

export type ParsedTimeOfDay = {
  hour24: number;
  minute: number;
};

export type ParsedTimeRangeOfDay = {
  start: ParsedTimeOfDay;
  end: ParsedTimeOfDay;
};

export function parseSimpleTimeOfDay(text: string): ParsedTimeOfDay | null {
  const t = text.trim().toLowerCase();
  if (!t) return null;

  // Matches:
  // - 10p, 10pm, 10 pm
  // - 10:30p, 10:30 pm
  // - 22:15 (24h)
  // - 10 (only if suffixed by am/pm) handled by the first pattern
  const ampmMatch = t.match(/\b(\d{1,2})(?::(\d{2}))?\s*(a|am|p|pm)\b/i);
  if (ampmMatch) {
    let h = Number.parseInt(ampmMatch[1], 10);
    const m = ampmMatch[2] ? Number.parseInt(ampmMatch[2], 10) : 0;
    const ap = ampmMatch[3];
    if (!Number.isFinite(h) || h < 1 || h > 12) return null;
    if (!Number.isFinite(m) || m < 0 || m > 59) return null;
    const isPm = ap.startsWith("p");
    if (h === 12) h = isPm ? 12 : 0;
    else h = isPm ? h + 12 : h;
    return { hour24: h, minute: m };
  }

  const h24Match = t.match(/\b([01]?\d|2[0-3]):([0-5]\d)\b/);
  if (h24Match) {
    const h = Number.parseInt(h24Match[1], 10);
    const m = Number.parseInt(h24Match[2], 10);
    return { hour24: h, minute: m };
  }

  return null;
}

function parseTimeToken(args: {
  token: string;
  /** If token lacks am/pm, optionally inherit from the other token in a range. */
  inheritMeridiem?: "am" | "pm";
}): { tod: ParsedTimeOfDay | null; meridiem: "am" | "pm" | null; hadMeridiem: boolean } {
  const raw = (args.token ?? "").trim().toLowerCase();
  if (!raw) return { tod: null, meridiem: null, hadMeridiem: false };

  // 24h times like 13:15
  const h24 = raw.match(/^\s*([01]?\d|2[0-3]):([0-5]\d)\s*$/);
  if (h24) {
    const h = Number.parseInt(h24[1], 10);
    const m = Number.parseInt(h24[2], 10);
    return { tod: { hour24: h, minute: m }, meridiem: null, hadMeridiem: false };
  }

  // 12h times with optional meridiem (for range parsing; we keep this strict-ish)
  const m12 = raw.match(/^\s*(\d{1,2})(?::(\d{2}))?\s*(a|am|p|pm)?\s*$/i);
  if (!m12) return { tod: null, meridiem: null, hadMeridiem: false };

  let h = Number.parseInt(m12[1], 10);
  const minute = m12[2] ? Number.parseInt(m12[2], 10) : 0;
  const apRaw = (m12[3] ?? "").toLowerCase();

  if (!Number.isFinite(h) || h < 1 || h > 12) return { tod: null, meridiem: null, hadMeridiem: false };
  if (!Number.isFinite(minute) || minute < 0 || minute > 59) return { tod: null, meridiem: null, hadMeridiem: false };

  const meridiem: "am" | "pm" | null = apRaw.startsWith("p")
    ? "pm"
    : apRaw.startsWith("a")
      ? "am"
      : args.inheritMeridiem ?? null;

  if (!meridiem) return { tod: null, meridiem: null, hadMeridiem: false };

  const isPm = meridiem === "pm";
  if (h === 12) h = isPm ? 12 : 0;
  else h = isPm ? h + 12 : h;

  return {
    tod: { hour24: h, minute },
    meridiem,
    hadMeridiem: apRaw.length > 0,
  };
}

/**
 * Parse common SMS time-range patterns like:
 * - "from 1pm to 3pm"
 * - "1pm-3pm" / "1pm - 3pm"
 * - "1-3pm" (inherit meridiem from the second token)
 *
 * NOTE: This returns only a TIME-OF-DAY range. Date anchoring happens elsewhere.
 */
export function parseTimeRangeOfDay(text: string): ParsedTimeRangeOfDay | null {
  const raw = (text ?? "").trim();
  if (!raw) return null;

  // Normalize dash variants so we can match with a single pattern.
  const t = raw
    .toLowerCase()
    .replace(/[–—−]/g, "-")
    .replace(/\s+/g, " ")
    .trim();

  // Capture the two sides of a range.
  // We require the second token to have am/pm OR be 24h (HH:MM), so we don't
  // incorrectly parse random "1-3" sequences.
  const m = t.match(
    /(?:\bfrom\b\s*)?(\d{1,2}(?::\d{2})?\s*(?:a|am|p|pm)?)\s*(?:-|\bto\b)\s*(\d{1,2}(?::\d{2})?\s*(?:a|am|p|pm)|(?:[01]?\d|2[0-3]):[0-5]\d)\b/i
  );
  if (!m) return null;

  const left = (m[1] ?? "").trim();
  const right = (m[2] ?? "").trim();
  if (!left || !right) return null;

  // Parse right first so we can inherit am/pm into the left token ("1-3pm").
  const rightParsed = parseTimeToken({ token: right });
  if (!rightParsed.tod) return null;

  const leftParsed = parseTimeToken({
    token: left,
    inheritMeridiem: rightParsed.meridiem ?? undefined,
  });

  if (!leftParsed.tod) return null;

  return { start: leftParsed.tod, end: rightParsed.tod };
}

export function parseDurationMinutes(text: string): number | null {
  const t = text.trim().toLowerCase();
  if (!t) return null;

  // Examples: "for 90 minutes", "90 mins", "2 hours", "for 2h"
  const minMatch = t.match(/\b(\d{1,3})\s*(min|mins|minute|minutes)\b/);
  if (minMatch) {
    const n = Number.parseInt(minMatch[1], 10);
    if (Number.isFinite(n) && n > 0) return n;
  }

  const hourMatch = t.match(/\b(\d{1,2})\s*(h|hr|hrs|hour|hours)\b/);
  if (hourMatch) {
    const n = Number.parseInt(hourMatch[1], 10);
    if (Number.isFinite(n) && n > 0) return n * 60;
  }

  return null;
}

export function textMentionsStartOrEnd(text: string): { isStart: boolean; isEnd: boolean } {
  const t = text.toLowerCase();
  const isEnd = /\b(end|end\s*time|until|til|till)\b/i.test(t);
  const isStart = /\b(start|starting|begin|beginning|from)\b/i.test(t);
  return { isStart, isEnd };
}

/**
 * Detect an explicit day anchor like "today", "tonight", "tomorrow".
 * Returns a day offset relative to "now".
 */
export function detectExplicitDayOffset(text: string): number | null {
  const t = (text ?? "").toLowerCase();
  if (!t.trim()) return null;

  if (/\btomorrow\b/i.test(t)) return 1;
  if (/\b(today|tonight)\b/i.test(t)) return 0;

  return null;
}

/**
 * If the user gives a bare time-of-day without a date, we anchor it to the closest sensible
 * occurrence relative to now in the user's timezone.
 *
 * - If the time-of-day is later today => today
 * - Else => tomorrow
 */
export function anchorTimeOfDayToNow(args: {
  userTimezone: string;
  now: DateTime;
  tod: ParsedTimeOfDay;
}): DateTime {
  const base = args.now.setZone(args.userTimezone);
  let candidate = base.set({ hour: args.tod.hour24, minute: args.tod.minute, second: 0, millisecond: 0 });

  // If the candidate time is <= now (within 1 minute), push to next day.
  if (candidate <= base.plus({ minutes: 1 })) {
    candidate = candidate.plus({ days: 1 });
  }
  return candidate;
}

/**
 * Anchor a time-of-day to an explicit day offset (e.g. "tomorrow").
 * We still keep it future-leaning (if the resulting time is <= now, bump a day).
 */
export function anchorTimeOfDayToExplicitDayOffset(args: {
  userTimezone: string;
  now: DateTime;
  tod: ParsedTimeOfDay;
  dayOffset: number;
}): DateTime {
  const base = args.now.setZone(args.userTimezone);
  let candidate = base
    .startOf("day")
    .plus({ days: Math.trunc(args.dayOffset) })
    .set({ hour: args.tod.hour24, minute: args.tod.minute, second: 0, millisecond: 0 });

  if (candidate <= base.plus({ minutes: 1 })) {
    candidate = candidate.plus({ days: 1 });
  }

  return candidate;
}

/**
 * Anchor a time-of-day to the same calendar date as `reference`.
 * This is especially useful when we already know the event start date and
 * we’re parsing a bare end time like "3pm".
 */
export function anchorTimeOfDayToReferenceDay(args: {
  reference: DateTime;
  tod: ParsedTimeOfDay;
}): DateTime {
  return args.reference.set({ hour: args.tod.hour24, minute: args.tod.minute, second: 0, millisecond: 0 });
}
