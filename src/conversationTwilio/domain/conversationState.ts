import type { EventInvitePolicy } from "@prisma/client";

export type PendingEventDraft = {
  /** Used mainly for display and for safer event creation. */
  activityId: string;

  location: string;
  startIso: string;
  endIso: string;

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
