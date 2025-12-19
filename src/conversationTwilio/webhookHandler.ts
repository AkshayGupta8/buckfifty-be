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

      // First: treat inbound as from the user.
      const user = await prisma.user.findUnique({
        where: { phone_number: from },
        select: { user_id: true },
      });

      // If not the user, try to match a Member.
      const member = !user
        ? await prisma.member.findFirst({
            where: { phone_number: from },
            select: { member_id: true, user_id: true },
          })
        : null;

      if (!user && !member) {
        logger.info(`Twilio inbound message from unknown number ${from}; ignoring.`);
        return;
      }

      const senderType = user ? "user" : "member";
      const userId = user?.user_id ?? member!.user_id;
      const memberId = member?.member_id ?? undefined;

      // Ensure conversation exists:
      // - user => Conversation(user_id)
      // - member => Conversation(event_id, member_id)
      let conversation: { conversation_id: string };
      let inferredEventId: string | undefined;

      if (senderType === "user") {
        conversation = await prisma.conversation.upsert({
          where: { user_id: userId },
          update: {},
          create: { user_id: userId },
          select: { conversation_id: true },
        });
      } else {
        const inferred = await inferActiveInvitedEventForMember({ memberId: memberId! });
        inferredEventId = inferred ?? undefined;
        if (!inferredEventId) {
          logger.info("Member inbound message but no active invited event found; ignoring", {
            memberId,
            from,
          });
          return;
        }

        conversation = await prisma.conversation.upsert({
          where: {
            event_id_member_id: {
              event_id: inferredEventId,
              member_id: memberId!,
            },
          },
          update: {},
          // Use unchecked create input so we don't depend on relation nested-create typing.
          create: {
            event_id: inferredEventId,
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
