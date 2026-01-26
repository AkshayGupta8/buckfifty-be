import { PrismaClient } from "@prisma/client";
import logger from "../../utils/logger";
import { inviteEventMember } from "../coordinator/coordinator";

const prisma = new PrismaClient();

type PollerHandle = {
  stop: () => void;
};

/**
 * Poll every N ms for expired invites (invite_expires_at < now, invite_timed_out=false).
 *
 * Behavior per product decision:
 * - When an invite times out: set invite_timed_out=true but keep status=invited
 * - For each timed-out invite: promote exactly ONE `listed` EventMember for that event
 *   to `invited`, set their new invite_expires_at, and send the invite SMS.
 */
export function startInviteTimeoutPoller(args?: {
  intervalMs?: number;
}): PollerHandle {
  const intervalMs = Math.max(1_000, Math.trunc(args?.intervalMs ?? 60_000));

  let stopped = false;
  let timer: NodeJS.Timeout | null = null;
  let inFlight = false;

  async function tick(): Promise<void> {
    if (stopped) return;
    if (inFlight) {
      logger.warn("inviteTimeoutPoller.tick skipped (previous tick still running)");
      return;
    }

    inFlight = true;
    try {
      const now = new Date();

      // Find candidates (small select) then process per row.
      const expired = await prisma.eventMember.findMany({
        where: {
          status: "invited",
          invite_timed_out: false,
          invite_expires_at: { lt: now },
        },
        select: {
          event_id: true,
          member_id: true,
        },
        take: 250,
      });

      if (expired.length === 0) return;

      logger.info("inviteTimeoutPoller.tick found expired invites", {
        count: expired.length,
      });

      for (const e of expired) {
        if (stopped) return;

        // Claim timeout + choose replacement deterministically inside a transaction.
        const res = await prisma.$transaction(async (tx) => {
          // Re-check still expired and not already timed out.
          const current = await tx.eventMember.findUnique({
            where: {
              event_id_member_id: {
                event_id: e.event_id,
                member_id: e.member_id,
              },
            },
            select: {
              invite_timed_out: true,
              invite_expires_at: true,
              status: true,
            },
          });

          const stillExpired =
            current?.status === "invited" &&
            current.invite_timed_out === false &&
            current.invite_expires_at &&
            current.invite_expires_at.getTime() < now.getTime();

          if (!stillExpired) {
            return { didTimeout: false as const, replacementMemberId: null as string | null };
          }

          await tx.eventMember.update({
            where: {
              event_id_member_id: {
                event_id: e.event_id,
                member_id: e.member_id,
              },
            },
            data: {
              invite_timed_out: true,
            },
          });

          // Pick next replacement from the backup pool.
          // Respect ordered list semantics: priority_rank asc (NULLs last), then stable tie-breaker.
          const replacement = await tx.eventMember.findFirst({
            where: {
              event_id: e.event_id,
              status: "listed",
            },
            orderBy: [
              { priority_rank: { sort: "asc", nulls: "last" } },
              { event_member_id: "asc" },
            ],
            select: {
              member_id: true,
            },
          });

          if (!replacement) {
            return { didTimeout: true as const, replacementMemberId: null as string | null };
          }

          // Claim the replacement by promoting to invited BEFORE sending SMS.
          await tx.eventMember.update({
            where: {
              event_id_member_id: {
                event_id: e.event_id,
                member_id: replacement.member_id,
              },
            },
            data: {
              status: "invited",
              // Will be set again by inviteEventMember, but set defensively
              // so other workers don't pick it up as listed.
              invite_timed_out: false,
            },
          });

          return {
            didTimeout: true as const,
            replacementMemberId: replacement.member_id,
          };
        });

        if (!res.didTimeout) continue;

        if (!res.replacementMemberId) {
          logger.info("inviteTimeoutPoller.no_replacement", {
            eventId: e.event_id,
            timedOutMemberId: e.member_id,
          });
          continue;
        }

        // Send invite + set invite_expires_at using coordinator logic.
        await inviteEventMember({
          eventId: e.event_id,
          memberId: res.replacementMemberId,
          reason: "timeout_backfill",
        });
      }
    } catch (err: any) {
      logger.error("inviteTimeoutPoller.tick failed", {
        errorMessage: err?.message ?? String(err),
        stack: err?.stack,
      });
    } finally {
      inFlight = false;
    }
  }

  // Run once on startup so we don't have to wait a full interval.
  setImmediate(() => {
    tick().catch(() => void 0);
  });

  timer = setInterval(() => {
    tick().catch(() => void 0);
  }, intervalMs);

  logger.info("inviteTimeoutPoller.started", { intervalMs });

  return {
    stop: () => {
      stopped = true;
      if (timer) clearInterval(timer);
      timer = null;
      logger.info("inviteTimeoutPoller.stopped");
    },
  };
}
