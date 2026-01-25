import {
  Prisma,
  PrismaClient,
  type EventInvitePolicy,
  type EventMemberStatus,
} from "@prisma/client";
import logger from "../../utils/logger";
import { sendSms } from "../../utils/twilioClient";
import { fullNameForMember } from "../domain/homies";
import {
  buildAmbiguousInviteReplySms,
  buildMemberInviteAcknowledgementSms,
  buildMemberInviteSms,
  buildUserNotifiedOfMemberResponseSms,
} from "../domain/inviteFormatting";
import {
  analyzeInviteResponse,
  buildInviteResponseAnalyzerSystemPrompt,
} from "../analyzers/inviteResponseAnalyzer";

const prisma = new PrismaClient();

export async function onEventCreated(eventId: string): Promise<void> {
  // invite every event member listed as invited on the event
  console.log("----------------------------")
  console.log("----------------------------")
  console.log("----------------------------")
  console.log(`event created - ${eventId}`)
  console.log("----------------------------")
  console.log("----------------------------")
  console.log("----------------------------")
}

export async function onMemberInboundMessage(args: {
  eventId: string;
  memberId: string;
  inboundBody: string;
  inboundMessageSid: string;
}): Promise<void> {
  // Follow the invite policies as needed
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
    .map((em) => ({
      em,
      start:
        em.event.timeSlots[0]?.start_time?.getTime() ??
        Number.POSITIVE_INFINITY,
    }))
    .sort((a, b) => a.start - b.start);

  return sorted[0]?.em.event_id ?? null;
}
