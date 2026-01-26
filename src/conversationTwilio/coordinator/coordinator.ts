import {
  Prisma,
  PrismaClient,
  type EventInvitePolicy,
  type EventMemberStatus,
} from "@prisma/client";
import logger from "../../utils/logger";
import { sendSms } from "../../utils/twilioClient";
import { DateTime } from "luxon";
import { fullNameForMember } from "../domain/homies";
import {
  buildAmbiguousInviteReplySms,
  buildMemberInviteAcknowledgementSms,
  buildMemberInviteFullSms,
  buildMemberInviteSms,
  buildUserNotifiedOfMemberResponseSms,
} from "../domain/inviteFormatting";
import {
  analyzeInviteResponse,
  buildInviteResponseAnalyzerSystemPrompt,
} from "../analyzers/inviteResponseAnalyzer";
import {
  ACTIVE_CAPACITY_STATUSES,
  normalizeMaxParticipants,
} from "../../domain/eventCapacity";
import {
  answerMemberEventQuestion,
  buildMemberEventQuestionSystemPrompt,
} from "../analyzers/memberEventQuestionAgent";

const prisma = new PrismaClient();

type InviteEventMemberReason = "event_created" | "timeout_backfill" | "decline_backfill";

function computeInviteExpiresAt(args: {
  now: DateTime;
  eventStart: DateTime;
  timeZone: string;
}): DateTime {
  const nowTz = args.now.setZone(args.timeZone);
  const startTz = args.eventStart.setZone(args.timeZone);

  // Defensive: if start isn't in the future, expire immediately.
  if (startTz <= nowTz) return nowTz;

  // 5% of the way from now -> start
  const deltaMs = startTz.toMillis() - nowTz.toMillis();
  const raw = nowTz.plus({ milliseconds: deltaMs * 0.05 });

  const withinWindow = (dt: DateTime): boolean => {
    const h = dt.hour;
    // 07:00 <= t < 22:00
    return h >= 7 && h < 22;
  };

  if (withinWindow(raw)) {
    // Ensure expiry does not exceed the event start.
    return raw <= startTz ? raw : startTz;
  }

  // If outside the allowed window, schedule for the next 7am in the user's timezone.
  // Per product decision:
  // - if now is before 7am => today at 7am
  // - else => tomorrow at 7am
  const next7amBase = nowTz.hour < 7 ? nowTz : nowTz.plus({ days: 1 });
  const next7am = next7amBase
    .startOf("day")
    .set({ hour: 7, minute: 0, second: 0, millisecond: 0 });

  // Still ensure we don't exceed event start (e.g. event starts before 7am).
  return next7am <= startTz ? next7am : startTz;
}

export async function inviteEventMember(args: {
  eventId: string;
  memberId: string;
  reason: InviteEventMemberReason;
}): Promise<void> {
  const event = await prisma.event.findUnique({
    where: { event_id: args.eventId },
    include: {
      createdBy: true,
      activity: true,
      timeSlots: { orderBy: { start_time: "asc" }, take: 1 },
    },
  });

  if (!event) {
    logger.warn("coordinator:inviteEventMember event not found", {
      eventId: args.eventId,
      memberId: args.memberId,
      reason: args.reason,
    });
    return;
  }

  const timeSlot = event.timeSlots[0];
  if (!timeSlot) {
    logger.warn("coordinator:inviteEventMember missing timeslot; cannot invite", {
      eventId: args.eventId,
      memberId: args.memberId,
      reason: args.reason,
    });
    return;
  }

  const member = await prisma.member.findUnique({
    where: { member_id: args.memberId },
  });

  if (!member) {
    logger.warn("coordinator:inviteEventMember member not found", {
      eventId: args.eventId,
      memberId: args.memberId,
      reason: args.reason,
    });
    return;
  }

  const timeZone = event.createdBy.timezone;
  const nowTz = DateTime.now().setZone(timeZone);
  const startTz = DateTime.fromJSDate(timeSlot.start_time, { zone: timeZone });

  if (!nowTz.isValid || !startTz.isValid) {
    logger.warn("coordinator:inviteEventMember invalid timezone or start time", {
      eventId: args.eventId,
      memberId: args.memberId,
      reason: args.reason,
      timeZone,
      nowIso: nowTz.toISO(),
      startIso: startTz.toISO(),
    });
    return;
  }

  // Don't send invites for events that already started.
  if (startTz <= nowTz) {
    logger.info("coordinator:inviteEventMember event already started; skipping invite", {
      eventId: args.eventId,
      memberId: args.memberId,
      reason: args.reason,
      startIso: startTz.toISO(),
      nowIso: nowTz.toISO(),
    });
    return;
  }

  const expiresAt = computeInviteExpiresAt({
    now: nowTz,
    eventStart: startTz,
    timeZone,
  });

  // Persist expiry even if the member lacks a phone number.
  await prisma.eventMember.update({
    where: {
      event_id_member_id: { event_id: event.event_id, member_id: member.member_id },
    },
    data: {
      status: "invited",
      invite_expires_at: expiresAt.toJSDate(),
      // Defensive: if we are (re)inviting, clear any previous timeout.
      invite_timed_out: false,
      // NOTE: Strict policy: reminders are sent at most once per (event_id,member_id) row.
      // We intentionally do NOT reset reminder_sent here.
    },
  });

  const phone = (member.phone_number ?? "").trim();
  if (!phone) {
    logger.warn("coordinator:inviteEventMember invited member has no phone; skipping SMS", {
      eventId: args.eventId,
      memberId: member.member_id,
      reason: args.reason,
      memberName: fullNameForMember(member),
    });
    return;
  }

  const sms = buildMemberInviteSms({
    member,
    event,
    timeSlot,
    activityName: event.activity?.name,
    creatorFirstName: event.createdBy.first_name,
    timeZone,
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
          kind: "member_invite",
          eventId: event.event_id,
          memberId: member.member_id,
          reason: args.reason,
          inviteExpiresAtIso: expiresAt.toISO({ suppressMilliseconds: true }),
        },
      },
    });

    logger.info("coordinator:inviteEventMember invited member", {
      eventId: args.eventId,
      memberId: member.member_id,
      reason: args.reason,
      messageSid: sid,
      inviteExpiresAtIso: expiresAt.toISO({ suppressMilliseconds: true }),
    });
  } catch (err: any) {
    logger.error("coordinator:inviteEventMember failed inviting member", {
      eventId: args.eventId,
      memberId: args.memberId,
      reason: args.reason,
      errorMessage: err?.message ?? String(err),
      stack: err?.stack,
    });
  }
}

export async function onEventCreated(eventId: string): Promise<void> {
  // Invite every event member listed as `invited` on this event.
  // Also set `invite_expires_at` based on the event start.

  const event = await prisma.event.findUnique({
    where: { event_id: eventId },
    include: {
      createdBy: true,
      activity: true,
      timeSlots: { orderBy: { start_time: "asc" }, take: 1 },
      eventMembers: { include: { member: true } },
    },
  });

  if (!event) {
    logger.warn("coordinator:onEventCreated event not found", { eventId });
    return;
  }

  const timeSlot = event.timeSlots[0];
  if (!timeSlot) {
    logger.warn("coordinator:onEventCreated missing timeslot; cannot invite", {
      eventId,
    });
    return;
  }

  const timeZone = event.createdBy.timezone;
  const nowTz = DateTime.now().setZone(timeZone);
  const startTz = DateTime.fromJSDate(timeSlot.start_time, { zone: timeZone });

  if (!nowTz.isValid || !startTz.isValid) {
    logger.warn("coordinator:onEventCreated invalid timezone or start time", {
      eventId,
      timeZone,
      nowIso: nowTz.toISO(),
      startIso: startTz.toISO(),
    });
    return;
  }

  // Don't send invites for events that already started.
  if (startTz <= nowTz) {
    logger.info("coordinator:onEventCreated event already started; skipping invites", {
      eventId,
      startIso: startTz.toISO(),
      nowIso: nowTz.toISO(),
    });
    return;
  }

  const invited = event.eventMembers.filter((em) => em.status === "invited");

  logger.info("coordinator:onEventCreated", {
    eventId,
    invitedCount: invited.length,
    timeZone,
    startIso: startTz.toISO(),
  });

  for (const em of invited) {
    await inviteEventMember({
      eventId: event.event_id,
      memberId: em.member_id,
      reason: "event_created",
    });
  }
}

export async function onMemberInboundMessage(args: {
  eventId: string;
  memberId: string;
  inboundBody: string;
  inboundMessageSid: string;
}): Promise<void> {
  const inboundText = (args.inboundBody ?? "").trim();
  if (!inboundText) return;

  // Load the event context so we can:
  // - enforce capacity
  // - answer questions with details
  // - notify the event creator
  const event = await prisma.event.findUnique({
    where: { event_id: args.eventId },
    include: {
      createdBy: true,
      activity: true,
      timeSlots: { orderBy: { start_time: "asc" }, take: 1 },
    },
  });

  if (!event) {
    logger.warn("coordinator:onMemberInboundMessage event not found", {
      eventId: args.eventId,
      memberId: args.memberId,
    });
    return;
  }

  const timeSlot = event.timeSlots[0];
  if (!timeSlot) {
    logger.warn("coordinator:onMemberInboundMessage missing timeslot", {
      eventId: args.eventId,
      memberId: args.memberId,
    });
    return;
  }

  const member = await prisma.member.findUnique({
    where: { member_id: args.memberId },
  });

  if (!member) {
    logger.warn("coordinator:onMemberInboundMessage member not found", {
      eventId: args.eventId,
      memberId: args.memberId,
    });
    return;
  }

  const eventMember = await prisma.eventMember.findUnique({
    where: {
      event_id_member_id: {
        event_id: args.eventId,
        member_id: args.memberId,
      },
    },
    select: {
      status: true,
      event_member_id: true,
    },
  });

  if (!eventMember) {
    logger.warn("coordinator:onMemberInboundMessage eventMember not found", {
      eventId: args.eventId,
      memberId: args.memberId,
    });
    return;
  }

  // Ensure we have the member conversation so we can pull history + store outbound replies.
  const conversation = await prisma.conversation.upsert({
    where: {
      event_id_member_id: {
        event_id: args.eventId,
        member_id: args.memberId,
      },
    },
    update: {},
    create: { event_id: args.eventId, member_id: args.memberId },
    select: { conversation_id: true },
  });

  const history = await prisma.conversationMessage.findMany({
    where: { conversation_id: conversation.conversation_id },
    orderBy: { created_at: "desc" },
    take: 20,
    select: { role: true, content: true },
  });

  // OpenAI expects oldest-first.
  const recentMessages = history
    .reverse()
    .map((m) => ({
      role: m.role === "user" ? "user" : "assistant",
      content: m.content,
    })) as Array<{ role: "user" | "assistant"; content: string }>;

  // 1) First: check if this is an accept/decline.
  const systemPrompt = buildInviteResponseAnalyzerSystemPrompt();
  const inviteDecision = await analyzeInviteResponse({
    systemPrompt,
    messages: recentMessages,
  });

  logger.info("coordinator:inviteResponse", {
    eventId: args.eventId,
    memberId: args.memberId,
    decision: inviteDecision.decision,
    summary: inviteDecision.summary,
    rawText: inviteDecision.rawText,
  });

  const creatorPhone = (event.createdBy.phone_number ?? "").trim();
  const creatorName = (event.createdBy.first_name ?? "").trim() || "Your friend";
  const memberName = fullNameForMember(member);

  // Helper for sending + logging to this member conversation.
  const sendToMember = async (sms: string, attributes?: Prisma.InputJsonValue) => {
    const phone = (member.phone_number ?? "").trim();
    if (!phone) {
      logger.warn("coordinator:onMemberInboundMessage member has no phone; cannot reply", {
        eventId: args.eventId,
        memberId: args.memberId,
      });
      return;
    }

    const sid = await sendSms(phone, sms);
    await prisma.conversationMessage.create({
      data: {
        conversation_id: conversation.conversation_id,
        role: "assistant",
        direction: "outbound",
        content: sms,
        twilio_sid: sid,
        attributes: attributes ?? undefined,
      },
    });
  };

  // Helper for sending + logging to creator (creator has a separate per-user conversation).
  const sendToCreator = async (sms: string, attributes?: Prisma.InputJsonValue) => {
    if (!creatorPhone) {
      logger.warn("coordinator:onMemberInboundMessage creator has no phone; cannot notify", {
        eventId: args.eventId,
        memberId: args.memberId,
      });
      return;
    }

    const creatorConversation = await prisma.conversation.upsert({
      where: { user_id: event.created_by_user_id },
      update: {},
      create: { user_id: event.created_by_user_id },
      select: { conversation_id: true },
    });

    const sid = await sendSms(creatorPhone, sms);
    await prisma.conversationMessage.create({
      data: {
        conversation_id: creatorConversation.conversation_id,
        role: "assistant",
        direction: "outbound",
        content: sms,
        twilio_sid: sid,
        attributes: attributes ?? undefined,
      },
    });
  };

  const maybeTriggerDeclineBackfill = async (): Promise<void> => {
    // When someone declines, invite exactly ONE backup homie.
    // This mirrors inviteTimeoutPoller semantics.
    const promoted = await prisma.$transaction(async (tx) => {
      // Find the next listed homie.
      const replacement = await tx.eventMember.findFirst({
        where: {
          event_id: args.eventId,
          status: "listed",
        },
        orderBy: [
          { priority_rank: { sort: "asc", nulls: "last" } },
          { event_member_id: "asc" },
        ],
        select: { member_id: true },
      });

      if (!replacement) return null;

      // Claim by promoting to invited BEFORE sending SMS.
      await tx.eventMember.update({
        where: {
          event_id_member_id: {
            event_id: args.eventId,
            member_id: replacement.member_id,
          },
        },
        data: {
          status: "invited",
          invite_timed_out: false,
        },
      });

      return replacement.member_id;
    });

    if (!promoted) {
      logger.info("coordinator:declineBackfill none_available", {
        eventId: args.eventId,
      });
      return;
    }

    await inviteEventMember({
      eventId: args.eventId,
      memberId: promoted,
      reason: "decline_backfill",
    });
  };

  // =========================
  // Accept / decline
  // =========================
  if (inviteDecision.decision === "accepted") {
    const res = await prisma.$transaction(async (tx) => {
      const em = await tx.eventMember.findUnique({
        where: {
          event_id_member_id: { event_id: args.eventId, member_id: args.memberId },
        },
        select: { status: true },
      });

      // If already accepted/declined, keep idempotent and don’t flip-flop.
      if (em?.status === "accepted") {
        return { finalDecision: "accepted" as const };
      }
      if (em?.status === "declined") {
        return { finalDecision: "declined" as const };
      }

      const max = normalizeMaxParticipants(event.max_participants);
      if (typeof max === "number") {
        const activeCount = await tx.eventMember.count({
          where: {
            event_id: args.eventId,
            status: { in: [...ACTIVE_CAPACITY_STATUSES] as any },
          },
        });

        // With accepted-only capacity semantics, accepting adds 1 to the count
        // unless we already returned early for em.status === "accepted".
        const attempted = activeCount + 1;

        if (attempted > max) {
          await tx.eventMember.update({
            where: {
              event_id_member_id: { event_id: args.eventId, member_id: args.memberId },
            },
            data: { status: "declined" },
          });
          return { finalDecision: "declined" as const, reason: "full" as const };
        }
      }

      await tx.eventMember.update({
        where: {
          event_id_member_id: { event_id: args.eventId, member_id: args.memberId },
        },
        data: { status: "accepted" },
      });

      return { finalDecision: "accepted" as const };
    });

    if (res.finalDecision === "accepted") {
      await sendToMember(buildMemberInviteAcknowledgementSms({ decision: "accepted" }), {
        kind: "member_invite_ack",
        decision: "accepted",
        eventId: args.eventId,
        memberId: args.memberId,
      });
    } else {
      // Full
      await sendToMember(buildMemberInviteFullSms(), {
        kind: "member_invite_ack",
        decision: "declined_full",
        eventId: args.eventId,
        memberId: args.memberId,
      });
    }

    const creatorSms = buildUserNotifiedOfMemberResponseSms({
      memberName,
      decision: res.finalDecision,
      summary: inviteDecision.summary,
      declinedReason: res.finalDecision === "declined" ? (res as any).reason ?? null : null,
    });

    await sendToCreator(creatorSms, {
      kind: "creator_notified_member_response",
      eventId: args.eventId,
      memberId: args.memberId,
      memberName,
      decision: res.finalDecision,
      summary: inviteDecision.summary,
      ...(res.finalDecision === "declined" ? { declinedReason: (res as any).reason ?? null } : {}),
    });

    // Backfill on declines (including "yes but full") per product decision.
    if (res.finalDecision === "declined") {
      await maybeTriggerDeclineBackfill();
    }

    return;
  }

  if (inviteDecision.decision === "declined") {
    await prisma.eventMember.update({
      where: {
        event_id_member_id: { event_id: args.eventId, member_id: args.memberId },
      },
      data: { status: "declined" },
    });

    await sendToMember(buildMemberInviteAcknowledgementSms({ decision: "declined" }), {
      kind: "member_invite_ack",
      decision: "declined",
      eventId: args.eventId,
      memberId: args.memberId,
    });

    const creatorSms = buildUserNotifiedOfMemberResponseSms({
      memberName,
      decision: "declined",
      summary: inviteDecision.summary,
    });

    await sendToCreator(creatorSms, {
      kind: "creator_notified_member_response",
      eventId: args.eventId,
      memberId: args.memberId,
      memberName,
      decision: "declined",
      summary: inviteDecision.summary,
    });

    await maybeTriggerDeclineBackfill();
    return;
  }

  // =========================
  // Unknown / questions path
  // =========================
  const qaSystemPrompt = buildMemberEventQuestionSystemPrompt({
    creatorFirstName: creatorName,
    activityName: event.activity?.name ?? null,
    location: event.location ?? null,
    inviteMessage: event.invite_message ?? null,
    start: timeSlot.start_time,
    end: timeSlot.end_time,
    timeZone: event.createdBy.timezone,
    memberStatus: eventMember.status,
  });

  const qa = await answerMemberEventQuestion({
    systemPrompt: qaSystemPrompt,
    messages: recentMessages,
  });

  const outbound = (qa.answer ?? "").trim() || buildAmbiguousInviteReplySms();
  await sendToMember(outbound, {
    kind: "member_event_question_answer",
    eventId: args.eventId,
    memberId: args.memberId,
  });
}

export async function inferActiveInvitedEventForMember(args: {
  memberId: string;
}): Promise<string | null> {
  // Find an event where this member is currently invited and the event hasn't started yet.
  // Prisma ordering across nested relations can be tricky; fetch a small set and sort in JS.
  const ems = await prisma.eventMember.findMany({
    where: {
      member_id: args.memberId,
      // Keep member routing active after accept/decline so the homie can ask questions.
      status: { in: ["invited", "accepted", "messaged", "declined"] },
      event: {
        timeSlots: {
          some: { start_time: { gt: new Date() } },
        },
      },
    },
    include: {
      event: {
        include: {
          timeSlots: { orderBy: { start_time: "asc" }, take: 1 },
        },
      },
    },
    take: 10,
  });

  const sorted = ems
    .map((em) => ({
      em,
      start:
        em.event.timeSlots[0]?.start_time?.getTime() ??
        Number.POSITIVE_INFINITY,
    }))
    .sort((a, b) => a.start - b.start);

  return sorted[0]?.em.event_id ?? null;
}
