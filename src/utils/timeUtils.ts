import { DateTime } from "luxon";

export type ClosestFutureAdjustment = {
  adjusted: DateTime;
  daysAdded: number;
};

/**
 * Given a DateTime `dt`, return the closest occurrence in the future relative to `now`.
 *
 * Behavior:
 * - If `dt` is already > now, returns it unchanged.
 * - Otherwise, repeatedly adds 1 day until it becomes > now.
 *
 * This is intentionally lenient for natural-language times like "7pm".
 */
export function adjustDateTimeToClosestFuture(args: {
  dt: DateTime;
  now: DateTime;
  maxDays?: number;
}): ClosestFutureAdjustment {
  const maxDays = typeof args.maxDays === "number" ? args.maxDays : 370;

  let candidate = args.dt;
  let daysAdded = 0;

  for (let i = 0; i < maxDays && candidate <= args.now; i++) {
    candidate = candidate.plus({ days: 1 });
    daysAdded += 1;
  }

  return { adjusted: candidate, daysAdded };
}
