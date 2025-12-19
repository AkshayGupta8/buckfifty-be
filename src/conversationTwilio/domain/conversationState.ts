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
