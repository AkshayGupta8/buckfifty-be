import type { Member } from "@prisma/client";

export function fullNameForMember(m: Member): string {
  return `${m.first_name} ${m.last_name}`.trim();
}

/**
 * Compute the value to persist in `Event.max_participants`.
 *
 * IMPORTANT: In the Twilio scheduling flow, `Event.max_participants` is the
 * number of homies (members) invited/allowed — it does NOT include the user.
 */
export function computeMaxParticipantsTotal(
  maxHomies: number | null,
  preferredHomies: string[] | null
): number | null {
  if (typeof maxHomies === "number" && Number.isFinite(maxHomies)) {
    return Math.trunc(maxHomies);
  }

  if (preferredHomies && preferredHomies.length > 0) {
    // If user didn’t specify a max, default to “just the named homies”.
    return preferredHomies.length;
  }

  return null;
}

export function resolveExplicitHomiesForEvent(args: {
  allMembers: Member[];
  preferredNames: string[];
  /** Max allowed homies (does NOT include the user). */
  maxHomies: number;
}): { ok: true; preferredMembers: Member[] } | { ok: false; reason: string } {
  const maxHomies = Math.max(0, Math.trunc(args.maxHomies));

  if (maxHomies <= 0) {
    return { ok: false, reason: "max_participants must be at least 1" };
  }

  const memberByNameLower = new Map(
    args.allMembers.map((m) => [fullNameForMember(m).toLowerCase(), m] as const)
  );

  const preferredMembers: Member[] = [];
  for (const name of args.preferredNames) {
    const m = memberByNameLower.get(name.toLowerCase());
    if (!m) {
      return { ok: false, reason: `Could not find homie: ${name}` };
    }
    if (!preferredMembers.some((x) => x.member_id === m.member_id)) {
      preferredMembers.push(m);
    }
  }

  // Explicitly named homies must fit within capacity.
  if (preferredMembers.length > maxHomies) {
    return {
      ok: false,
      reason: `You picked ${preferredMembers.length} homies but capacity allows ${maxHomies}.`,
    };
  }

  return { ok: true, preferredMembers };
}
