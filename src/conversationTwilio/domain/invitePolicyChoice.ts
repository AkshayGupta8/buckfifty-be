import type { EventInvitePolicy } from "@prisma/client";

export function normalizeInvitePolicyChoiceText(t: string): string {
  return (t ?? "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s]/g, "")
    .replace(/\s+/g, " ");
}

/**
 * Deterministically interpret a user's reply to:
 * "Quick check: do you want Priority Invite, or Handpicked Invite?"
 */
export function parseInvitePolicyChoiceFromUserText(args: {
  text: string;
  policyHint: EventInvitePolicy;
  inferredPolicy: EventInvitePolicy;
}): EventInvitePolicy | null {
  const t = normalizeInvitePolicyChoiceText(args.text);

  const hintText = normalizeInvitePolicyChoiceText(args.policyHint);
  const inferredText = normalizeInvitePolicyChoiceText(args.inferredPolicy);

  // If the user literally replies with one of the two options, accept.
  // (Example: assistant asked "Priority Invite or Handpicked Invite?" and user says "Priority Invite".)
  if (t === hintText) return args.policyHint;
  if (t === inferredText) return args.inferredPolicy;

  // Strong signals
  const wantsPriority =
    t.includes("priority") ||
    t.includes("prioritized") ||
    t === "p" ||
    t.includes("invite first") ||
    t.includes("starting with");

  const wantsHandpicked =
    t.includes("handpicked") ||
    t.includes("hand picked") ||
    t.includes("exact") ||
    t.includes("only") ||
    t.includes("no one else") ||
    t.includes("no backups");

  const wantsOpen =
    t.includes("open") ||
    t.includes("random") ||
    t.includes("anyone") ||
    t.includes("doesnt matter") ||
    t.includes("dont care");

  if (wantsPriority) return "prioritized";
  if (wantsHandpicked) return "exact";
  if (wantsOpen) return "max_only";

  return null;
}
