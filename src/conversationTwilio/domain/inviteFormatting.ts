import type { Event, Member, TimeSlot } from "@prisma/client";

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

  const noteLine = note.length ? `\nNote: ${note}` : "";

  // Warm + clear identity, while still encouraging a simple yes/no response.
  // (The invite response analyzer can handle natural language, but a crisp ask reduces ambiguity.)
  const firstName = args.member.first_name.trim();
  const hello = firstName.length ? `Hi ${firstName} —` : "Hi —";

  return `${hello} I'm BuckFifty (the AI assistant), texting for ${args.creatorFirstName}.\nYou're invited to ${what}.\nWhen: ${when}\nWhere: ${where}${noteLine}\nCan you make it? Reply "yes" or "no".`;
}

export function buildAmbiguousInviteReplySms(): string {
  return "Just to confirm — can you make it? Reply \"yes\" or \"no\".";
}

export function buildUserNotifiedOfMemberResponseSms(args: {
  memberName: string;
  decision: "accepted" | "declined";
  summary?: string;
}): string {
  const s = (args.summary ?? "").trim();
  const base =
    args.decision === "accepted"
      ? `${args.memberName} accepted.`
      : `${args.memberName} declined.`;

  return s.length ? `${base} ${s}`.slice(0, 300) : base;
}
