import type { EventInvitePolicy } from "@prisma/client";

export type PendingEventDraft = {
  /** Used mainly for display and for safer event creation. */
  activityId: string;

  location: string;
  startIso: string;
  endIso: string;

  /**
   * If true, the user edited the start time without providing an updated end/duration.
   * We should ask for end/duration before allowing confirmation.
   */
  needsEndTime?: boolean;

  /** Max number of homies to invite (does NOT include the user). */
  maxHomies: number;
  invitePolicy: EventInvitePolicy;

  /** Explicitly listed member ids (if any), in priority order. */
  preferredMemberIds: string[];

  /** Cached names for SMS display (avoid extra DB round-trips). */
  preferredNamesForSms: string[];

  /**
   * Locked invite plan computed at preview-time.
   *
   * We persist this so that (a) the confirmation SMS can list exact names, and
   * (b) the event-creation step cannot reshuffle and change who gets invited.
   */
  immediateMemberIds?: string[];
  followUpMemberIds?: string[];

  /** Cached names for the locked invite plan (SMS display). */
  immediateNamesForSms?: string[];
  followUpNamesForSms?: string[];

  /**
   * Sticky exclusions for this draft ("don’t invite X").
   *
   * These are applied to both Inviting-now and Backup lists and MUST remain excluded
   * unless the user explicitly unbans them.
   */
  excludedMemberIds?: string[];

  /** Cached names for excluded members (SMS display only). */
  excludedNamesForSms?: string[];

  inviteMessage?: string | null;

  /** The preview SMS text we sent (so the analyzer can reference it). */
  previewSms: string;
  previewSentAtIso: string;
};

export type PendingEvent = {
  status: "awaiting_confirmation";
  draft: PendingEventDraft;
};

/**
 * Short-lived state for the current planning session.
 *
 * This is intentionally separate from durable memory (`memorySummary`) and from
 * `pendingEvent` (which is the locked preview awaiting confirmation).
 */
export type ActiveEventDraft = {
  status: "collecting_details";

  /** Used mainly for display and for safer event creation. */
  activityId: string;

  /**
   * Location text exactly as the user described it (best-effort).
   *
   * NOTE: we store this explicitly so the assistant doesn't re-ask after the
   * message falls out of the last-N history window.
   */
  location?: string;

  /**
   * Event start/end in ISO-8601 including explicit offset.
   *
   * endIso is optional until explicitly provided; we should ask the user for
   * end/duration if missing.
   */
  startIso?: string;
  endIso?: string;

  /** Optional extracted duration (minutes). */
  durationMinutes?: number;

  /**
   * Names the user explicitly asked to invite (if any), in the order they were specified.
   * These are strings (not ids) because we may not have enough info to resolve to ids yet.
   */
  preferredNames?: string[];

  /** Max number of homies to invite (does NOT include the user). */
  maxHomies?: number;

  /**
   * Optional invite-policy override chosen explicitly by the user.
   *
   * This exists to break loops where:
   * - the LLM detects a branded policy hint (e.g. "Priority Invite")
   * - but the inferred policy from (preferredNames,maxHomies) differs.
   */
  invitePolicyOverride?: EventInvitePolicy;

  /**
   * When set, the assistant has asked a "Quick check" policy question and is
   * awaiting the user's reply (e.g. "priority" vs "handpicked").
   */
  pendingInvitePolicyChoice?: {
    policyHint: EventInvitePolicy;
    inferredPolicy: EventInvitePolicy;
    askedAtIso: string;
  };

  /** Optional note/instruction to share with invited members. */
  inviteMessage?: string | null;

  /** Timestamp for debugging / potential expiry. */
  updatedAtIso: string;
};

export type ConversationState = {
  /**
   * Compact, durable memory used across multiple event-planning “sessions”.
   * MUST avoid including specific past event time/location (to avoid biasing next plans).
   */
  memorySummary?: string;
  memorySummaryUpdatedAt?: string;

  /** ISO timestamp of the most recently created event (used as planning-session boundary). */
  lastEventCreatedAt?: string;

  /** Last created event id (for reference only). */
  lastCreatedEventId?: string;

  /** Legacy keys (kept here so we can clean them up). */
  createdEventId?: string;
  draftEvent?: unknown;

  /** New: when we have a complete draft but we're waiting for the user to confirm it. */
  pendingEvent?: PendingEvent;

  /** New: draft details being collected for the current planning session. */
  activeDraft?: ActiveEventDraft;
};

export function asConversationState(
  state: unknown
): ConversationState & Record<string, unknown> {
  if (state && typeof state === "object" && !Array.isArray(state)) {
    return state as ConversationState & Record<string, unknown>;
  }
  return {};
}

export function parseIsoDateOrNull(iso: unknown): Date | null {
  if (typeof iso !== "string" || iso.trim().length === 0) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
}
