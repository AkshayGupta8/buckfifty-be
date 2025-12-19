function formatDayForSms(d: Date, timeZone: string): string {
  // Example: "Sat, Dec 21"
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "short",
    month: "short",
    day: "numeric",
  });
  return fmt.format(d);
}

function formatTimeForSms(d: Date, timeZone: string): string {
  // Example: "7:00 PM"
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour: "numeric",
    minute: "2-digit",
  });
  return fmt.format(d);
}

function isSameLocalDay(a: Date, b: Date, timeZone: string): boolean {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });

  return fmt.format(a) === fmt.format(b);
}

export function buildEventConfirmationSms(args: {
  activityName: string;
  location: string;
  start: Date;
  end: Date;
  timeZone: string;
  /**
   * Names the user explicitly asked to invite ("definite" invites).
   *
   * IMPORTANT: For "any N" and "X + others" flows we intentionally do NOT
   * include the auto-selected names in user-facing confirmation messaging,
   * because the final attendee set may change based on availability.
   */
  preferredNames: string[];
  /** Max number of homies to invite (does NOT include the user). */
  maxHomies: number;

  /** Optional note/instruction to share with invited members. */
  inviteMessage?: string | null;
}): string {
  const when = isSameLocalDay(args.start, args.end, args.timeZone)
    ? `${formatDayForSms(args.start, args.timeZone)} ${formatTimeForSms(
        args.start,
        args.timeZone
      )} - ${formatTimeForSms(args.end, args.timeZone)}`
    : `${formatDayForSms(args.start, args.timeZone)} ${formatTimeForSms(
        args.start,
        args.timeZone
      )} - ${formatDayForSms(args.end, args.timeZone)} ${formatTimeForSms(args.end, args.timeZone)}`;

  const desiredHomieCount = Math.max(0, Math.trunc(args.maxHomies));
  const preferred = args.preferredNames.filter((n) => n.trim().length > 0);

  // "who" line rules:
  // 1) If user said "any N" => show no names
  // 2) If user said "X + others" => show preferred names only
  // 3) If user provided an exact list (preferred count == desired count) => show names
  let who: string;
  if (preferred.length === 0) {
    who = `Inviting ${desiredHomieCount} homies`;
  } else if (preferred.length < desiredHomieCount) {
    who = `Inviting: ${preferred.join(", ")} + others`;
  } else {
    who = `Inviting: ${preferred.join(", ")}`;
  }

  const note = (args.inviteMessage ?? "").trim();
  const noteLine = note.length ? `\nNote for homies: ${note}` : "";

  // Keep it short for SMS.
  return `Locked in: ${args.activityName}\nWhen: ${when}\nWhere: ${args.location}\n${who}${noteLine}`;
}
