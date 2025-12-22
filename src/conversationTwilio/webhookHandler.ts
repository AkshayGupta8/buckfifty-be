import { Prisma, PrismaClient } from "@prisma/client";
import type { Request, Response } from "express";
import logger from "../utils/logger";
import { inferActiveInvitedEventForMember } from "./coordinator/coordinator";
import { onInboundTwilioMessage } from "./inboundHandler";
import type { TwilioInboundWebhookBody } from "./types";

const prisma = new PrismaClient();

/**
 * Twilio inbound webhook.
 * Twilio typically sends application/x-www-form-urlencoded.
 *
 * IMPORTANT: We return 200 immediately, then do background processing.
 */
export async function twilioWebhookHandler(req: Request, res: Response): Promise<void> {
  // Respond immediately so Twilio doesn't retry due to our processing time.
  res.status(200).send("OK");

  const body = req.body as TwilioInboundWebhookBody;
  const from = body.From;
  const to = body.To;
  const messageBody = body.Body;
  const messageSid = body.MessageSid;

  // Fire-and-forget background handler
  setImmediate(async () => {
    try {
      if (!from || !messageBody || !messageSid) {
        logger.warn(
          `Twilio webhook missing required fields (From/Body/MessageSid). Body=${JSON.stringify(body)}`
        );
        return;
      }

      // A phone number can belong to BOTH:
      // - a User (event creator / scheduling)
      // - one-or-more Members (invite responses / coordination)
      // We must disambiguate when both exist.
      const userByPhone = await prisma.user.findUnique({
        where: { phone_number: from },
        select: { user_id: true },
      });

      const membersByPhone = await prisma.member.findMany({
        where: { phone_number: from },
        select: { member_id: true, user_id: true },
      });

      if (!userByPhone && membersByPhone.length === 0) {
        logger.info(`Twilio inbound message from unknown number ${from}; ignoring.`);
        return;
      }

      // If any member(s) match, see if they have an active invite.
      // If multiple matches exist, pick the soonest-starting invited event.
      let selectedMember: { member_id: string; user_id: string } | null = null;
      let selectedEventId: string | null = null;
      let selectedEventStart: number = Number.POSITIVE_INFINITY;

      for (const m of membersByPhone) {
        const eventId = await inferActiveInvitedEventForMember({ memberId: m.member_id });
        if (!eventId) continue;

        const ts = await prisma.timeSlot.findFirst({
          where: { event_id: eventId },
          orderBy: { start_time: "asc" },
          select: { start_time: true },
        });

        const start = ts?.start_time?.getTime() ?? Number.POSITIVE_INFINITY;
        if (start < selectedEventStart) {
          selectedEventStart = start;
          selectedMember = m;
          selectedEventId = eventId;
        }
      }

      // Default routing (when not ambiguous):
      // - if there's no user, it must be member (but only if we found an active invite)
      // - if there's no active invite, it must be user
      let senderType: "user" | "member";
      let userId: string;
      let memberId: string | undefined;
      let inferredEventId: string | undefined;

      if (!userByPhone) {
        // Member-only phone number.
        if (!selectedMember || !selectedEventId) {
          logger.info("Member inbound message but no active invited event found; ignoring", {
            from,
            membersMatched: membersByPhone.length,
          });
          return;
        }

        senderType = "member";
        userId = selectedMember.user_id;
        memberId = selectedMember.member_id;
        inferredEventId = selectedEventId;
      } else if (!selectedMember || !selectedEventId) {
        // User-only (or member exists but no active invite).
        senderType = "user";
        userId = userByPhone.user_id;
      } else {
        // Ambiguous: phone belongs to both a user + an invited member.
        // Always use the message router model to decide.
        const { analyzeMessageRoute, buildMessageRouterSystemPrompt } = await import(
          "./analyzers/messageRouterAnalyzer"
        );

        const routeRes = await analyzeMessageRoute({
          systemPrompt: buildMessageRouterSystemPrompt(),
          messages: [{ role: "user", content: messageBody }],
        });

        if (routeRes.route === "coordination") {
          senderType = "member";
          userId = selectedMember.user_id;
          memberId = selectedMember.member_id;
          inferredEventId = selectedEventId;
        } else {
          senderType = "user";
          userId = userByPhone.user_id;
        }
      }

      // Ensure conversation exists:
      // - user => Conversation(user_id)
      // - member => Conversation(event_id, member_id)
      let conversation: { conversation_id: string };

      if (senderType === "user") {
        conversation = await prisma.conversation.upsert({
          where: { user_id: userId },
          update: {},
          create: { user_id: userId },
          select: { conversation_id: true },
        });
      } else {
        conversation = await prisma.conversation.upsert({
          where: {
            event_id_member_id: {
              event_id: inferredEventId!,
              member_id: memberId!,
            },
          },
          update: {},
          // Use unchecked create input so we don't depend on relation nested-create typing.
          create: {
            event_id: inferredEventId!,
            member_id: memberId!,
          },
          select: { conversation_id: true },
        });
      }

      // Persist message (dedupe via unique twilio_sid)
      let conversationMessageId: string | undefined;
      try {
        const created = await prisma.conversationMessage.create({
          data: {
            conversation_id: conversation.conversation_id,
            role: "user",
            direction: "inbound",
            content: messageBody,
            twilio_sid: messageSid,
            attributes: {
              twilio: {
                from,
                to,
              },
              participant: {
                type: senderType,
                ...(memberId ? { memberId } : {}),
                ...(inferredEventId ? { eventId: inferredEventId } : {}),
              },
            },
          },
          select: { message_id: true },
        });
        conversationMessageId = created.message_id;
      } catch (err: any) {
        // Twilio can retry webhooks. If we've already stored this MessageSid,
        // treat as success and ignore.
        if (
          err instanceof Prisma.PrismaClientKnownRequestError &&
          err.code === "P2002" &&
          Array.isArray(err.meta?.target) &&
          err.meta.target.includes("twilio_sid")
        ) {
          logger.info(`Duplicate Twilio webhook received for MessageSid=${messageSid}; ignoring.`);
          return;
        } else {
          throw err;
        }
      }

      // Call custom handler
      await onInboundTwilioMessage({
        userId,
        from,
        to,
        body: messageBody,
        messageSid,
        conversationId: conversation.conversation_id,
        conversationMessageId,
        senderType,
        memberId,
        eventId: inferredEventId,
      });
    } catch (err) {
      logger.error(`Error handling Twilio inbound webhook: ${err}`);
    }
  });
}
