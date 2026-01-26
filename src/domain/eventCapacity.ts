import type { Event, EventMemberStatus } from "@prisma/client";

/**
 * Capacity rules for `Event.max_participants`.
 *
 * `Event.max_participants` is the maximum number of *homies* (EventMembers)
 * that may be in an “accepted” state. It NEVER includes the event creator.
 *
 * Per product decision:
 * - only `accepted` counts toward capacity
 * - `declined` does NOT count toward capacity (replacements allowed)
 * - `listed` does NOT count toward capacity (can maintain a large backup pool)
 * - `invited` / `messaged` do NOT count toward capacity (invites may exceed capacity)
 */

export function statusCountsTowardCapacity(status: EventMemberStatus): boolean {
  return ACTIVE_CAPACITY_STATUSES.includes(status as any);
}

/** EventMember statuses that count toward `Event.max_participants`. */
export const ACTIVE_CAPACITY_STATUSES = [
  "accepted",
] as const satisfies readonly EventMemberStatus[];

export function normalizeMaxParticipants(max: Event["max_participants"]): number | null {
  if (max === null || typeof max === "undefined") return null;
  if (typeof max !== "number" || !Number.isFinite(max)) return null;
  return Math.trunc(max);
}

export function validateMaxParticipantsValue(max: unknown):
  | { ok: true; value: number | null }
  | { ok: false; reason: string } {
  if (max === null || typeof max === "undefined") {
    return { ok: true, value: null };
  }

  const n = typeof max === "number" ? max : Number(max);
  if (!Number.isFinite(n)) {
    return { ok: false, reason: "max_participants must be a number or null" };
  }

  const v = Math.trunc(n);
  if (v < 1) {
    return { ok: false, reason: "max_participants must be at least 1 (or null)" };
  }
  return { ok: true, value: v };
}

export function assertWithinCapacity(args: {
  maxParticipants: number | null;
  activeCount: number;
  attemptedActiveCount: number;
}): { ok: true } | { ok: false; reason: string } {
  const max = args.maxParticipants;
  if (max === null) return { ok: true };
  if (args.attemptedActiveCount <= max) return { ok: true };

  // `activeCount` here is best-effort/diagnostic.
  return {
    ok: false,
    reason: `Event is at capacity (${max}).`,
  };
}
