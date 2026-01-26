import { PrismaClient } from "@prisma/client";
import logger from "../../utils/logger";
import { sendSms } from "../../utils/twilioClient";
import { buildMemberInviteReminderSms } from "../domain/inviteFormatting";

const prisma = new PrismaClient();

type PollerHandle = {
  stop: () => void;
};

/**
 * Poll every N ms for invites that are nearing expiry and have not been reminded.
 *
 * Eligibility:
 * - EventMember.status = invited
 * - invite_timed_out = false
 * - reminder_sent = false
 * - invite_expires_at exists AND now < invite_expires_at <= now + threshold
 * - event has a future timeslot (start_time > now)
 *
 * Strict policy: `reminder_sent` is set once per (event_id, member_id) row ever.
 */
export function startInviteReminderPoller(args?: {
  intervalMs?: number;
  /** Default 30 minutes. */
  thresholdMs?: number;
}): PollerHandle {
  const intervalMs = Math.max(1_000, Math.trunc(args?.intervalMs ?? 60_000));
  const thresholdMs = Math.max(60_000, Math.trunc(args?.thresholdMs ?? 30 * 60_000));

  let stopped = false;
  let timer: NodeJS.Timeout | null = null;
  let inFlight = false;

  async function tick(): Promise<void> {
    if (stopped) return;
    if (inFlight) {
      logger.warn("inviteReminderPoller.tick skipped (previous tick still running)");
      return;
    }

    inFlight = true;
    try {
      const now = new Date();
      const deadline = new Date(now.getTime() + thresholdMs);

      // Find candidates (small select) then process per row.
      const candidates = await prisma.eventMember.findMany({
        where: {
          status: "invited",
          invite_timed_out: false,
          reminder_sent: false,
          invite_expires_at: {
            gt: now,
            lte: deadline,
          },
          event: {
            timeSlots: {
              some: {
                start_time: { gt: now },
              },
            },
          },
        },
        select: {
          event_id: true,
          member_id: true,
        },
        take: 250,
      });

      if (candidates.length === 0) return;

      logger.info("inviteReminderPoller.tick found reminder candidates", {
        count: candidates.length,
        thresholdMs,
      });

      for (const c of candidates) {
        if (stopped) return;

        // Claim reminder inside a transaction so we don't double-send.
        const claimed = await prisma.$transaction(async (tx) => {
          const current = await tx.eventMember.findUnique({
            where: {
              event_id_member_id: {
                event_id: c.event_id,
                member_id: c.member_id,
              },
            },
            select: {
              status: true,
              invite_timed_out: true,
              reminder_sent: true,
              invite_expires_at: true,
            },
          });

          const stillEligible =
            current?.status === "invited" &&
            current.invite_timed_out === false &&
            current.reminder_sent === false &&
            current.invite_expires_at &&
            current.invite_expires_at.getTime() > now.getTime() &&
            current.invite_expires_at.getTime() <= deadline.getTime();

          if (!stillEligible) return { didClaim: false as const, inviteExpiresAt: null as Date | null };

          await tx.eventMember.update({
            where: {
              event_id_member_id: {
                event_id: c.event_id,
                member_id: c.member_id,
              },
            },
            data: {
              reminder_sent: true,
            },
          });

          return { didClaim: true as const, inviteExpiresAt: current.invite_expires_at };
        });

        if (!claimed.didClaim || !claimed.inviteExpiresAt) continue;

        // Load event/member context after claim.
        const event = await prisma.event.findUnique({
          where: { event_id: c.event_id },
          include: {
            createdBy: true,
            activity: true,
            timeSlots: { orderBy: { start_time: "asc" }, take: 1 },
          },
        });

        if (!event) {
          logger.warn("inviteReminderPoller missing event after claim", {
            eventId: c.event_id,
            memberId: c.member_id,
          });
          continue;
        }

        const timeSlot = event.timeSlots[0];
        if (!timeSlot) {
          logger.warn("inviteReminderPoller missing timeslot after claim", {
            eventId: c.event_id,
            memberId: c.member_id,
          });
          continue;
        }

        // Defensive: if event already started, don't send.
        if (timeSlot.start_time.getTime() <= now.getTime()) {
          logger.info("inviteReminderPoller event started; skipping send", {
            eventId: c.event_id,
            memberId: c.member_id,
            startIso: timeSlot.start_time.toISOString(),
          });
          continue;
        }

        const member = await prisma.member.findUnique({
          where: { member_id: c.member_id },
        });

        if (!member) {
          logger.warn("inviteReminderPoller missing member after claim", {
            eventId: c.event_id,
            memberId: c.member_id,
          });
          continue;
        }

        const phone = (member.phone_number ?? "").trim();
        if (!phone) {
          logger.warn("inviteReminderPoller member has no phone; skipping SMS", {
            eventId: c.event_id,
            memberId: c.member_id,
          });
          continue;
        }

        const timeZone = event.createdBy.timezone;
        const sms = buildMemberInviteReminderSms({
          member,
          event,
          timeSlot,
          activityName: event.activity?.name,
          creatorFirstName: event.createdBy.first_name,
          timeZone,
          inviteExpiresAt: claimed.inviteExpiresAt,
        });

        try {
          const sid = await sendSms(phone, sms);

          // Ensure member conversation exists (event_id + member_id).
          const conversation = await prisma.conversation.upsert({
            where: {
              event_id_member_id: {
                event_id: event.event_id,
                member_id: member.member_id,
              },
            },
            update: {},
            create: {
              event_id: event.event_id,
              member_id: member.member_id,
            },
            select: { conversation_id: true },
          });

          await prisma.conversationMessage.create({
            data: {
              conversation_id: conversation.conversation_id,
              role: "assistant",
              direction: "outbound",
              content: sms,
              twilio_sid: sid,
              attributes: {
                kind: "member_invite_reminder",
                eventId: event.event_id,
                memberId: member.member_id,
                inviteExpiresAtIso: claimed.inviteExpiresAt.toISOString(),
              },
            },
          });

          logger.info("inviteReminderPoller.sent", {
            eventId: event.event_id,
            memberId: member.member_id,
            messageSid: sid,
          });
        } catch (err: any) {
          logger.error("inviteReminderPoller failed sending SMS", {
            eventId: event.event_id,
            memberId: member.member_id,
            errorMessage: err?.message ?? String(err),
            stack: err?.stack,
          });
        }
      }
    } catch (err: any) {
      logger.error("inviteReminderPoller.tick failed", {
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

  logger.info("inviteReminderPoller.started", { intervalMs, thresholdMs });

  return {
    stop: () => {
      stopped = true;
      if (timer) clearInterval(timer);
      timer = null;
      logger.info("inviteReminderPoller.stopped");
    },
  };
}
