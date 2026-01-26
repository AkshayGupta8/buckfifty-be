import type { Event, Member, TimeSlot } from "@prisma/client";

function pick<T>(arr: readonly T[]): T {
  // Small randomized phrase-bank selection.
  return arr[Math.floor(Math.random() * arr.length)];
}

function compactSms(s: string, maxLen = 600): string {
  return (s ?? "").replace(/\s+\n/g, "\n").replace(/\n\s+/g, "\n").trim().slice(0, maxLen);
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
    args.timeSlot.start_time
  )} - ${timeFmt.format(args.timeSlot.end_time)}`;

  const what = (args.activityName ?? "hang")?.trim() || "hang";
  const where = (args.event.location ?? "").trim() || "(location TBD)";

  const firstName = args.member.first_name.trim();

  // Phrase banks (keep SMS-friendly; no emojis).
  const hello = firstName.length
    ? pick([`Hey ${firstName} —`, `Hi ${firstName} —`, `Yo ${firstName} —`])
    : pick(["Hey —", "Hi —"]);

  const intro = pick([
    `I’m BuckFifty (the AI assistant), reaching out for ${args.creatorFirstName}.`,
    `BuckFifty here — messaging you for ${args.creatorFirstName}.`,
    `This is BuckFifty (AI assistant) texting on behalf of ${args.creatorFirstName}.`,
  ]);

  const inviteLine = pick([
    `${args.creatorFirstName} wants to see if you’re down to ${what}.`,
    `You’re invited to ${what}.`,
    `${args.creatorFirstName} is putting together ${what} — you in?`,
  ]);

  const noteLine = note.length
    ? `\n${pick(["Note", "Quick note", "FYI"])}: ${note}`
    : "";

  // Keep a crisp RSVP ask to reduce ambiguity.
  const rsvp = pick([
    "Can you make it?",
    "Are you able to make it?",
    "Are you in? Reply YES or NO.",
    "Can you come? Reply YES or NO.",
  ]);

  const sms = `${hello} ${intro}\n${inviteLine}\nWhen: ${when}\nWhere: ${where}${noteLine}\n${rsvp}`;
  return compactSms(sms);
}

export function buildAmbiguousInviteReplySms(): string {
  return pick([
    "Just to confirm — can you make it?",
    "Quick check — are you able to make it?",
    "Sorry, didn’t catch that — can you make it? Reply YES or NO.",
  ]);
}

export function buildMemberInviteAcknowledgementSms(args: {
  decision: "accepted" | "declined";
}): string {
  // Keep it short + generic (no event details) to minimize accidental confusion.
  if (args.decision === "accepted") {
    return pick([
      "Awesome — see you there!",
      "Sweet — you’re in.",
      "Perfect — glad you can make it!",
    ]);
  }

  return pick([
    "All good — thanks for letting me know. Maybe next time.",
    "No worries — catch you next time.",
    "Got it. Sorry you can’t make it — maybe next time.",
  ]);
}

export function buildMemberInviteFullSms(): string {
  // Specific message for the case where the homie said “yes” but capacity was already reached.
  // Keep it short and SMS-friendly.
  return pick([
    "Ah — it just filled up. Hope you can make the next one!",
    "Sorry — it’s full now. Next time!",
    "Bummer — we’re at capacity now. Catch you next time.",
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
