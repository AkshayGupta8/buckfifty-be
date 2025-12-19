import { Prisma, PrismaClient } from "@prisma/client";
import type { Request, Response } from "express";
import logger from "../utils/logger";
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

      // Find user by phone number
      const user = await prisma.user.findUnique({
        where: { phone_number: from },
        select: { user_id: true },
      });

      if (!user) {
        logger.info(`Twilio inbound message from unknown number ${from}; ignoring.`);
        return;
      }

      // Ensure conversation exists for this user
      const conversation = await prisma.conversation.upsert({
        where: { user_id: user.user_id },
        update: {},
        create: { user_id: user.user_id },
        select: { conversation_id: true },
      });

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
        userId: user.user_id,
        from,
        to,
        body: messageBody,
        messageSid,
        conversationId: conversation.conversation_id,
        conversationMessageId,
      });
    } catch (err) {
      logger.error(`Error handling Twilio inbound webhook: ${err}`);
    }
  });
}
