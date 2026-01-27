import type { Event, Member, TimeSlot } from "@prisma/client";

function pick<T>(arr: readonly T[]): T {
  // Small randomized phrase-bank selection.
  return arr[Math.floor(Math.random() * arr.length)];
}

function compactSms(s: string, maxLen = 600): string {
  return (s ?? "")
    // Trim *spaces/tabs* around newlines, but preserve blank lines ("\n\n") for readability.
    .replace(/[\t ]+\n/g, "\n")
    .replace(/\n[\t ]+/g, "\n")
    // Avoid excessive vertical whitespace in SMS (cap at 2 newlines).
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, maxLen);
}

function formatEventWhenForCreator(args: {
  timeSlot: TimeSlot;
  timeZone: string;
}): string {
  // Example: "Sat, Jan 17 7:00 PM - 8:30 PM" (timezone implied by creator tz)
  const dayFmt = new Intl.DateTimeFormat("en-US", {
    timeZone: args.timeZone,
    weekday: "short",
    month: "short",
    day: "numeric",
  });

  const timeFmt = new Intl.DateTimeFormat("en-US", {
    timeZone: args.timeZone,
    hour: "numeric",
    minute: "2-digit",
  });

  return `${dayFmt.format(args.timeSlot.start_time)} ${timeFmt.format(
    args.timeSlot.start_time,
  )} - ${timeFmt.format(args.timeSlot.end_time)}`;
}

function formatRosterSection(args: {
  title: string;
  names: string[];
  maxNames?: number;
}): string {
  const max = Math.max(0, Math.trunc(args.maxNames ?? 6));
  const names = (args.names ?? []).map((n) => (n ?? "").trim()).filter(Boolean);

  if (names.length === 0) {
    return `${args.title}:\n- (none)`;
  }

  const shown = names.slice(0, max);
  const remaining = names.length - shown.length;
  const lines = shown.map((n) => `- ${n}`);
  if (remaining > 0) lines.push(`- (and ${remaining} more)`);
  return `${args.title}:\n${lines.join("\n")}`;
}

export function buildCreatorRosterAfterMemberDecisionSms(args: {
  memberName: string;
  decision: "accepted" | "declined" | "declined_full";
  /** Short, SMS-safe summary of the member's reply (from the inviteResponseAnalyzer). */
  summary?: string;
  activityName?: string | null;
  timeSlot: TimeSlot;
  timeZone: string;
  /** If null/undefined, omit the open-spots line (used when max_participants is null). */
  openSpots?: number | null;
  roster: {
    accepted: string[];
    pending: string[]; // invited + messaged
    declined: string[];
    backups: string[]; // listed
  };
}): string {
  const what = (args.activityName ?? "hang")?.trim() || "hang";
  const when = formatEventWhenForCreator({
    timeSlot: args.timeSlot,
    timeZone: args.timeZone,
  });

  const summary = (args.summary ?? "").trim().slice(0, 300);
  const summarySuffix = summary.length ? ` ${summary}` : "";

  const header =
    args.decision === "accepted"
      ? `${args.memberName} is in for ${what} (${when}).${summarySuffix}`
      : args.decision === "declined_full"
        ? `${args.memberName} said yes for ${what} (${when}), but it was already full.${summarySuffix}`
        : `${args.memberName} declined ${what} (${when}).${summarySuffix}`;

  const rosterIntroLine =
    typeof args.openSpots === "number" && Number.isFinite(args.openSpots)
      ? Math.trunc(args.openSpots) <= 0
        ? "There are no more open spots. Roster:"
        : `We still have ${Math.trunc(args.openSpots)} open ${
            Math.trunc(args.openSpots) === 1 ? "spot" : "spots"
          }. Roster:`
      : "Roster:";

  const roster = [
    rosterIntroLine,
    formatRosterSection({ title: "Approved", names: args.roster.accepted }),
    formatRosterSection({
      title: "Pending response",
      names: args.roster.pending,
    }),
    formatRosterSection({ title: "Declined", names: args.roster.declined }),
    formatRosterSection({ title: "Backups", names: args.roster.backups }),
  ].join("\n\n");

  return compactSms(`${header}\n\n${roster}`, 1200);
}

export function buildMemberInviteSms(args: {
  member: Member;
  event: Event;
  timeSlot: TimeSlot;
  activityName?: string | null;
  creatorFirstName: string;
  timeZone: string;
}): string {
  // Keep it short; this is what the homie sees.
  const note = (args.event.invite_message ?? "").trim();

  // Basic time formatting in creator's timezone (same as user timezone).
  const dayFmt = new Intl.DateTimeFormat("en-US", {
    timeZone: args.timeZone,
    weekday: "short",
    month: "short",
    day: "numeric",
  });

  const timeFmt = new Intl.DateTimeFormat("en-US", {
    timeZone: args.timeZone,
    hour: "numeric",
    minute: "2-digit",
  });

  const when = `${dayFmt.format(args.timeSlot.start_time)} ${timeFmt.format(
    args.timeSlot.start_time,
  )} - ${timeFmt.format(args.timeSlot.end_time)}`;

  const what = (args.activityName ?? "hang")?.trim() || "hang";
  const where = (args.event.location ?? "").trim() || "(location TBD)";

  const firstName = args.member.first_name.trim();

  // Phrase banks (keep SMS-friendly; no emojis).
  const hello = firstName.length
    ? pick([`Hi ${firstName},`, `Hello ${firstName},`])
    : pick(["Hi,", "Hello,"]);

  const intro = pick([
    `I’m BuckFifty (the AI assistant), reaching out for ${args.creatorFirstName}.`,
    `This is BuckFifty, messaging you for ${args.creatorFirstName}.`,
    `This is BuckFifty (AI assistant) texting on behalf of ${args.creatorFirstName}.`,
  ]);

  const inviteLine = pick([
    `${args.creatorFirstName} wants to see if you’re down to ${what}.`,
    `You’re invited to ${what}.`,
    `${args.creatorFirstName} is putting together ${what}. Would you like to join?`,
  ]);

  const noteLine = note.length
    ? `\n${pick(["Note", "Quick note", "FYI"])}: ${note}`
    : "";

  // Keep a crisp RSVP ask to reduce ambiguity.
  const rsvp = pick([
    "Can you make it?",
    "Are you able to make it?",
    "Are you in?",
    "Can you come?",
  ]);

  const sms = `${hello} ${intro}\n${inviteLine}\nWhen: ${when}\nWhere: ${where}${noteLine}\n${rsvp}`;
  return compactSms(sms);
}

function formatInviteWhen(args: {
  timeSlot: TimeSlot;
  timeZone: string;
}): string {
  const dayFmt = new Intl.DateTimeFormat("en-US", {
    timeZone: args.timeZone,
    weekday: "short",
    month: "short",
    day: "numeric",
  });

  const timeFmt = new Intl.DateTimeFormat("en-US", {
    timeZone: args.timeZone,
    hour: "numeric",
    minute: "2-digit",
  });

  return `${dayFmt.format(args.timeSlot.start_time)} ${timeFmt.format(
    args.timeSlot.start_time,
  )} - ${timeFmt.format(args.timeSlot.end_time)}`;
}

function formatInviteDeadline(args: {
  deadline: Date;
  timeZone: string;
}): string {
  // Example: "Mon, Jan 26 3:00 PM" (timezone implied by timeZone)
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: args.timeZone,
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
  return fmt.format(args.deadline);
}

export function buildMemberInviteReminderSms(args: {
  member: Member;
  event: Event;
  timeSlot: TimeSlot;
  activityName?: string | null;
  creatorFirstName: string;
  timeZone: string;
  inviteExpiresAt: Date;
}): string {
  const note = (args.event.invite_message ?? "").trim();
  const what = (args.activityName ?? "hang")?.trim() || "hang";
  const where = (args.event.location ?? "").trim() || "(location TBD)";

  const when = formatInviteWhen({
    timeSlot: args.timeSlot,
    timeZone: args.timeZone,
  });
  const deadline = formatInviteDeadline({
    deadline: args.inviteExpiresAt,
    timeZone: args.timeZone,
  });

  const noteLine = note.length ? `\nNote: ${note}` : "";

  const firstName = args.member.first_name.trim();
  const hello = firstName.length
    ? pick([`Hi ${firstName},`, `Hello ${firstName},`])
    : pick(["Hi,", "Hello,"]);

  const sms = `${hello} quick reminder from BuckFifty for ${args.creatorFirstName}.\n${what}\nWhen: ${when}\nWhere: ${where}${noteLine}\n\nYour spot is currently yours if you want it, but at ${deadline} I’m going to start inviting others.`;
  return compactSms(sms);
}

export function buildAmbiguousInviteReplySms(): string {
  return pick([
    "Just to confirm, can you make it?",
    "Quick check, are you able to make it?",
    "Sorry, I didn’t catch that. Can you make it?",
  ]);
}

export function buildMemberInviteAcknowledgementSms(args: {
  decision: "accepted" | "declined";
}): string {
  // Keep it short + generic (no event details) to minimize accidental confusion.
  if (args.decision === "accepted") {
    return pick([
      "Great, see you there!",
      "Perfect, you’re in.",
      "Glad you can make it!",
    ]);
  }

  return pick([
    "All good. Thanks for letting me know. Maybe next time.",
    "No worries. Catch you next time.",
    "Got it. Sorry you can’t make it. Maybe next time.",
  ]);
}

export function buildMemberInviteFullSms(): string {
  // Specific message for the case where the homie said “yes” but capacity was already reached.
  // Keep it short and SMS-friendly.
  return pick([
    "Sorry, it just filled up. Hope you can make the next one!",
    "Sorry, it’s full now. Next time!",
    "We’re at capacity now. Catch you next time.",
  ]);
}

export function buildUserNotifiedOfMemberResponseSms(args: {
  memberName: string;
  decision: "accepted" | "declined";
  summary?: string;
  declinedReason?: "full" | null;
}): string {
  const s = (args.summary ?? "").trim();

  // NOTE: We store this as a decline internally (to trigger backfill), but the creator-facing
  // message should reflect that the homie *wanted* to come and was blocked by capacity.
  const isFull = args.decision === "declined" && args.declinedReason === "full";

  const base = isFull
    ? pick([
        `${args.memberName} said yes, but it was already full.`,
        `${args.memberName} was in, but the event was already full.`,
        `${args.memberName} tried to accept, but capacity was already reached.`,
      ])
    : args.decision === "accepted"
      ? pick([
          `${args.memberName} accepted.`,
          `${args.memberName} is in.`,
          `${args.memberName} can make it.`,
        ])
      : pick([
          `${args.memberName} declined.`,
          `${args.memberName} can’t make it.`,
          `${args.memberName} is out.`,
        ]);

  return compactSms(s.length ? `${base} ${s}` : base, 300);
}
