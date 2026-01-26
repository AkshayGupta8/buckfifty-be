import type { EventInvitePolicy } from "@prisma/client";

export type BrandedInvitePolicyName =
  | "Open Invite"
  | "Priority Invite"
  | "Handpicked Invite";

/**
 * User-facing branding for invite policies.
 * Keep this the single source of truth so UI + SMS + prompts stay consistent.
 */
export function brandedInvitePolicyName(
  policy: EventInvitePolicy,
): BrandedInvitePolicyName {
  switch (policy) {
    case "max_only":
      return "Open Invite";
    case "prioritized":
      return "Priority Invite";
    case "exact":
      return "Handpicked Invite";
    default: {
      // Defensive fallback for future enum expansion.
      return "Open Invite";
    }
  }
}

/**
 * Detect whether the user explicitly referenced a branded invite policy.
 * Deterministic regex > relying on the LLM for this.
 */
export function detectBrandedInvitePolicyHintFromText(
  text: string,
): EventInvitePolicy | null {
  const t = (text ?? "").toLowerCase();

  // Allow hyphens/spaces and minor variants.
  const openInvite = /\bopen\s*-?\s*invite\b/;
  const priorityInvite = /\bpriority\s*-?\s*invite\b/;
  const exactInvite = /\bexact\s*-?\s*invite\b/;
  const handpickedInvite =
    /\bhand\s*-?\s*picked\s*-?\s*invite\b|\bhandpicked\s*-?\s*invite\b/;

  if (handpickedInvite.test(t) || exactInvite.test(t)) return "exact";
  if (priorityInvite.test(t)) return "prioritized";
  if (openInvite.test(t)) return "max_only";
  return null;
}

export function buildInvitePolicyExplainerLines(): string {
  // Keep SMS-safe: short lines, no markdown.
  // Use the same structure the coordinator follows so expectations match reality.
  return [
    "Currently Supported Invite policies:",
    "Open Invite:",
    "1) Randomly pick homies until you fill all the spots.",
    "2) If someone declines or times out, invite another homie.",
    "3) Stop when all spots are filled, or everyone has been invited.",
    "",
    "Priority Invite:",
    "1) Invite all priority homies (even if that's more than the number of spots).",
    "2) If you still need more yes's, randomly invite other homies.",
    "3) Replace declines/timeouts until all spots are filled, or everyone has been invited.",
    "",
    "Handpicked Invite:",
    "1) Invite only the exact homies you listed (no backups).",
  ].join("\n");
}
