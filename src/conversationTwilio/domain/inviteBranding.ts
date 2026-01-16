import type { EventInvitePolicy } from "@prisma/client";

export type BrandedInvitePolicyName = "Open Invite" | "Priority Invite" | "Handpicked Invite";

/**
 * User-facing branding for invite policies.
 * Keep this the single source of truth so UI + SMS + prompts stay consistent.
 */
export function brandedInvitePolicyName(policy: EventInvitePolicy): BrandedInvitePolicyName {
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
export function detectBrandedInvitePolicyHintFromText(text: string): EventInvitePolicy | null {
  const t = (text ?? "").toLowerCase();

  // Allow hyphens/spaces and minor variants.
  const openInvite = /\bopen\s*-?\s*invite\b/;
  const priorityInvite = /\bpriority\s*-?\s*invite\b/;
  const handpickedInvite = /\bhand\s*-?\s*picked\s*-?\s*invite\b|\bhandpicked\s*-?\s*invite\b/;

  if (handpickedInvite.test(t)) return "exact";
  if (priorityInvite.test(t)) return "prioritized";
  if (openInvite.test(t)) return "max_only";
  return null;
}

export function buildInvitePolicyExplainerLines(): string {
  // Keep SMS-safe: short lines, no markdown.
  return [
    "Invite policies I can run:",
    "• Open Invite — invite any number of homies you choose.",
    "• Priority Invite — you name must-invite homies, and I’ll fill the rest.",
    "• Handpicked Invite — only invite the exact homies you list.",
  ].join("\n");
}

