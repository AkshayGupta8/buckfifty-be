import { Prisma, PrismaClient, type EventInvitePolicy, type EventMemberStatus } from "@prisma/client";
import logger from "../../utils/logger";
import { sendSms } from "../../utils/twilioClient";
import { fullNameForMember } from "../domain/homies";
import {
  buildAmbiguousInviteReplySms,
  buildMemberInviteSms,
  buildUserNotifiedOfMemberResponseSms,
} from "../domain/inviteFormatting";
import {
  analyzeInviteResponse,
  buildInviteResponseAnalyzerSystemPrompt,
} from "../analyzers/inviteResponseAnalyzer";

const prisma = new PrismaClient();

/**
 * In-memory timers (best-effort). If the server restarts, these are lost.
 * Keyed by eventId.
 */
const scheduledInviteChecks = new Map<string, NodeJS.Timeout>();

function clearInviteCheck(eventId: string): void {
  const t = scheduledInviteChecks.get(eventId);
  if (t) clearTimeout(t);
  scheduledInviteChecks.delete(eventId);
}

function scheduleInviteCheck(eventId: string, delayMs: number): void {
  clearInviteCheck(eventId);

  // Clamp delays to avoid immediate loops / or huge timers.
  const ms = Math.max(1_000, Math.min(delayMs, 1000 * 60 * 60 * 24 * 7)); // 1s..7d

  const t = setTimeout(() => {
    setImmediate(async () => {
      try {
        await maybeInviteMore(eventId);
      } catch (err) {
        logger.error(`coordinator: maybeInviteMore failed: ${String(err)}`);
      }
    });
  }, ms);

  scheduledInviteChecks.set(eventId, t);
}

function computeEscalationDelayMs(startTime: Date): number | null {
  const now = Date.now();
  const delta = startTime.getTime() - now;
  if (!Number.isFinite(delta) || delta <= 0) return null;
  return Math.max(60_000, Math.floor(delta * 0.05));
}

async function upsertEventMemberConversation(args: {
  eventId: string;
  memberId: string;
}): Promise<{ conversation_id: string }> {
  // Use relation-connect form to avoid relying on unchecked inputs.
  return prisma.conversation.upsert({
    where: {
      event_id_member_id: {
        event_id: args.eventId,
        member_id: args.memberId,
      },
    },
    update: {},
    create: {
      event: { connect: { event_id: args.eventId } },
      member: { connect: { member_id: args.memberId } },
    },
    select: { conversation_id: true },
  });
}

async function persistOutboundToConversation(args: {
  conversationId: string;
  content: string;
  twilioSid: string;
  attributes?: any;
}): Promise<void> {
  await prisma.conversationMessage.create({
    data: {
      conversation_id: args.conversationId,
      role: "assistant",
      direction: "outbound",
      content: args.content,
      twilio_sid: args.twilioSid,
      attributes: args.attributes ?? undefined,
    },
  });
}

async function persistInboundToConversation(args: {
  conversationId: string;
  content: string;
  messageSid?: string;
  attributes?: any;
}): Promise<void> {
  // messageSid could be undefined in internal calls; keep nullable.
  // Also: inbound Twilio webhooks are persisted upstream in `webhookHandler.ts`.
  // If this function is called with the same MessageSid, ignore the dedupe violation.
  try {
    await prisma.conversationMessage.create({
      data: {
        conversation_id: args.conversationId,
        role: "user",
        direction: "inbound",
        content: args.content,
        twilio_sid: args.messageSid,
        attributes: args.attributes ?? undefined,
      },
    });
  } catch (err: any) {
    if (
      err instanceof Prisma.PrismaClientKnownRequestError &&
      err.code === "P2002" &&
      Array.isArray(err.meta?.target) &&
      err.meta.target.includes("twilio_sid")
    ) {
      logger.info(`Duplicate inbound message persisted; ignoring. MessageSid=${args.messageSid}`);
      return;
    }
    throw err;
  }
}

async function inviteMembers(args: {
  eventId: string;
  memberIds: string[];
  markStatus: EventMemberStatus;
}): Promise<void> {
  if (!args.memberIds.length) return;

  const event = await prisma.event.findUnique({
    where: { event_id: args.eventId },
    include: {
      createdBy: true,
      activity: true,
      timeSlots: {
        orderBy: { start_time: "asc" },
        take: 1,
      },
    },
  });

  if (!event) throw new Error(`Event not found eventId=${args.eventId}`);
  const timeSlot = event.timeSlots[0];
  if (!timeSlot) throw new Error(`Event has no timeSlot eventId=${args.eventId}`);

  const members = await prisma.member.findMany({
    where: { member_id: { in: args.memberIds } },
  });

  const invitedWithPhone: string[] = [];

  for (const m of members) {
    if (!m.phone_number) {
      logger.info("Skipping invite because member has no phone", { memberId: m.member_id });
      continue;
    }

    invitedWithPhone.push(m.member_id);

    const sms = buildMemberInviteSms({
      member: m,
      event,
      timeSlot,
      activityName: event.activity?.name ?? null,
      creatorFirstName: event.createdBy.first_name,
      timeZone: event.createdBy.timezone,
    });

    const sid = await sendSms(m.phone_number, sms);

    // Ensure (event,member) conversation exists and store outbound.
    const c = await upsertEventMemberConversation({ eventId: args.eventId, memberId: m.member_id });
    await persistOutboundToConversation({
      conversationId: c.conversation_id,
      content: sms,
      twilioSid: sid,
      attributes: {
        participant: { type: "assistant" },
        coordinator: { kind: "invite" },
      },
    });
  }

  // Update status in EventMember (create if needed) for members we actually messaged.
  await prisma.$transaction(async (tx) => {
    for (const memberId of invitedWithPhone) {
      await tx.eventMember.upsert({
        where: { event_id_member_id: { event_id: args.eventId, member_id: memberId } },
        create: { event_id: args.eventId, member_id: memberId, status: args.markStatus },
        update: { status: args.markStatus },
      });
    }
  });
}

function pickRandom<T>(arr: T[], count: number): T[] {
  const a = [...arr];
  // Fisher-Yates shuffle partial
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a.slice(0, Math.max(0, count));
}

async function getEventCoordinationState(eventId: string): Promise<{
  invitePolicy: EventInvitePolicy;
  maxParticipants: number;
  startTime: Date;
  acceptedCount: number;
  invitedOrAcceptedOrDeclinedMemberIds: Set<string>;
  prioritizedMemberIds: string[];
  userId: string;
  userPhone: string;
  userTimezone: string;
}> {
  const event = await prisma.event.findUnique({
    where: { event_id: eventId },
    include: {
      createdBy: true,
      eventMembers: true,
      timeSlots: { orderBy: { start_time: "asc" }, take: 1 },
    },
  });

  if (!event) throw new Error(`Event not found eventId=${eventId}`);
  const timeSlot = event.timeSlots[0];
  if (!timeSlot) throw new Error(`Event has no timeSlot eventId=${eventId}`);

  const maxParticipants = Math.max(0, Math.trunc(event.max_participants ?? 0));

  const acceptedCount = event.eventMembers.filter((em) => em.status === "accepted").length;

  const already = new Set<string>();
  for (const em of event.eventMembers) {
    if (em.status !== "listed") already.add(em.member_id);
  }

  const prioritized = event.eventMembers
    .filter((em) => em.priority_rank !== null && typeof em.priority_rank === "number")
    .sort((a, b) => (a.priority_rank ?? 0) - (b.priority_rank ?? 0))
    .map((em) => em.member_id);

  if (!event.createdBy.phone_number) {
    throw new Error(`User has no phone_number userId=${event.createdBy.user_id}`);
  }

  return {
    invitePolicy: event.invite_policy,
    maxParticipants,
    startTime: timeSlot.start_time,
    acceptedCount,
    invitedOrAcceptedOrDeclinedMemberIds: already,
    prioritizedMemberIds: prioritized,
    userId: event.createdBy.user_id,
    userPhone: event.createdBy.phone_number,
    userTimezone: event.createdBy.timezone,
  };
}

async function maybeInviteMore(eventId: string): Promise<void> {
  const state = await getEventCoordinationState(eventId);

  if (state.maxParticipants <= 0) {
    clearInviteCheck(eventId);
    return;
  }

  // Stop if we hit max accepted.
  if (state.acceptedCount >= state.maxParticipants) {
    clearInviteCheck(eventId);
    return;
  }

  // Stop if start time passed.
  if (state.startTime.getTime() <= Date.now()) {
    clearInviteCheck(eventId);
    return;
  }

  // Candidate pool: all user's members with phone numbers, excluding already invited/accepted/declined.
  const allMembers = await prisma.member.findMany({
    where: {
      user_id: state.userId,
      phone_number: { not: null },
    },
  });

  const candidates = allMembers
    .map((m) => m.member_id)
    .filter((id) => !state.invitedOrAcceptedOrDeclinedMemberIds.has(id));

  if (!candidates.length) {
    clearInviteCheck(eventId);
    return;
  }

  // Invite one more at a time for simplicity.
  const [nextId] = pickRandom(candidates, 1);
  await inviteMembers({ eventId, memberIds: [nextId], markStatus: "invited" });

  // Schedule another check.
  const delayMs = computeEscalationDelayMs(state.startTime);
  if (delayMs === null) {
    clearInviteCheck(eventId);
    return;
  }

  scheduleInviteCheck(eventId, delayMs);
}

async function initialInviteSelection(args: {
  eventId: string;
  policy: EventInvitePolicy;
  maxParticipants: number;
  prioritizedMemberIds: string[];
}): Promise<string[]> {
  if (args.maxParticipants <= 0) return [];

  if (args.policy === "exact") {
    // Exact: invite all listed members.
    const listed = await prisma.eventMember.findMany({
      where: { event_id: args.eventId },
      select: { member_id: true },
    });
    return listed.map((x) => x.member_id);
  }

  const event = await prisma.event.findUnique({
    where: { event_id: args.eventId },
    select: { created_by_user_id: true },
  });
  if (!event) throw new Error(`Event not found eventId=${args.eventId}`);

  // For max_only / prioritized:
  // - start with prioritized list (if any)
  // - fill remaining invite slots randomly
  const allMembers = await prisma.member.findMany({
    where: {
      user_id: event.created_by_user_id,
      phone_number: { not: null },
    },
    select: { member_id: true },
  });

  const allIds = allMembers.map((m) => m.member_id);

  const chosen: string[] = [];
  const pushUnique = (id: string) => {
    if (!chosen.includes(id)) chosen.push(id);
  };

  if (args.policy === "prioritized") {
    for (const id of args.prioritizedMemberIds) {
      pushUnique(id);
      if (chosen.length >= args.maxParticipants) break;
    }
  }

  if (chosen.length < args.maxParticipants) {
    const remaining = allIds.filter((id) => !chosen.includes(id));
    const needed = args.maxParticipants - chosen.length;
    for (const id of pickRandom(remaining, needed)) pushUnique(id);
  }

  return chosen.slice(0, args.maxParticipants);
}

export async function onEventCreated(eventId: string): Promise<void> {
  const state = await getEventCoordinationState(eventId);

  // For exact, maxParticipants may be null at creation time; treat as the number of listed.
  let max = state.maxParticipants;
  if (max <= 0 && state.invitePolicy === "exact") {
    const count = await prisma.eventMember.count({ where: { event_id: eventId } });
    max = count;
  }

  if (max <= 0) {
    logger.info("coordinator: event has no max_participants; skipping invites", { eventId });
    return;
  }

  const selected = await initialInviteSelection({
    eventId,
    policy: state.invitePolicy,
    maxParticipants: max,
    prioritizedMemberIds: state.prioritizedMemberIds,
  });

  await inviteMembers({ eventId, memberIds: selected, markStatus: "invited" });

  // Schedule next invite escalation for max_only/prioritized only.
  if (state.invitePolicy !== "exact") {
    const delayMs = computeEscalationDelayMs(state.startTime);
    if (delayMs !== null) scheduleInviteCheck(eventId, delayMs);
  }
}

export async function onMemberInboundMessage(args: {
  eventId: string;
  memberId: string;
  inboundBody: string;
  inboundMessageSid: string;
}): Promise<void> {
  const event = await prisma.event.findUnique({
    where: { event_id: args.eventId },
    include: { createdBy: true },
  });
  if (!event) throw new Error(`Event not found eventId=${args.eventId}`);

  const member = await prisma.member.findUnique({
    where: { member_id: args.memberId },
  });
  if (!member) throw new Error(`Member not found memberId=${args.memberId}`);

  const memberName = fullNameForMember(member);

  // Upsert conversation and persist inbound.
  const c = await upsertEventMemberConversation({ eventId: args.eventId, memberId: args.memberId });
  await persistInboundToConversation({
    conversationId: c.conversation_id,
    content: args.inboundBody,
    messageSid: args.inboundMessageSid,
    attributes: { participant: { type: "member", memberId: args.memberId, eventId: args.eventId } },
  });

  // Run classification
  const systemPrompt = buildInviteResponseAnalyzerSystemPrompt();
  const analysis = await analyzeInviteResponse({
    systemPrompt,
    messages: [{ role: "user", content: args.inboundBody }],
  });

  if (analysis.decision === "unknown") {
    // Ask homie to clarify.
    if (member.phone_number) {
      const ask = buildAmbiguousInviteReplySms();
      const sid = await sendSms(member.phone_number, ask);
      await persistOutboundToConversation({
        conversationId: c.conversation_id,
        content: ask,
        twilioSid: sid,
        attributes: { coordinator: { kind: "clarify" } },
      });
    }
    return;
  }

  // Update EventMember status
  await prisma.eventMember.upsert({
    where: { event_id_member_id: { event_id: args.eventId, member_id: args.memberId } },
    create: {
      event_id: args.eventId,
      member_id: args.memberId,
      status: analysis.decision,
    },
    update: {
      status: analysis.decision,
    },
  });

  // Notify user (event creator)
  if (event.createdBy.phone_number) {
    const sms = buildUserNotifiedOfMemberResponseSms({
      memberName: memberName || "A homie",
      decision: analysis.decision,
      summary: analysis.summary,
    });
    const sid = await sendSms(event.createdBy.phone_number, sms);

    // Persist to the user's conversation thread
    const userConversation = await prisma.conversation.upsert({
      where: { user_id: event.createdBy.user_id },
      update: {},
      create: { user_id: event.createdBy.user_id },
      select: { conversation_id: true },
    });

    await persistOutboundToConversation({
      conversationId: userConversation.conversation_id,
      content: sms,
      twilioSid: sid,
      attributes: {
        coordinator: { kind: "member_response", eventId: args.eventId, memberId: args.memberId },
      },
    });
  }

  // For max_only/prioritized: consider inviting more.
  if (event.invite_policy !== "exact") {
    const nextDelay = await (async () => {
      const ts = await prisma.timeSlot.findFirst({
        where: { event_id: args.eventId },
        orderBy: { start_time: "asc" },
      });
      return ts ? computeEscalationDelayMs(ts.start_time) : null;
    })();

    if (nextDelay !== null) scheduleInviteCheck(args.eventId, nextDelay);
  }
}

export async function inferActiveInvitedEventForMember(args: {
  memberId: string;
}): Promise<string | null> {
  // Find an event where this member is currently invited and the event hasn't started yet.
  // Prisma ordering across nested relations can be tricky; fetch a small set and sort in JS.
  const ems = await prisma.eventMember.findMany({
    where: {
      member_id: args.memberId,
      status: "invited",
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
    .map((em) => ({ em, start: em.event.timeSlots[0]?.start_time?.getTime() ?? Number.POSITIVE_INFINITY }))
    .sort((a, b) => a.start - b.start);

  return sorted[0]?.em.event_id ?? null;
}
