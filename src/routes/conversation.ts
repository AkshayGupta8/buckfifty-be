import { Router, Request, Response } from "express";
import { Prisma, PrismaClient } from "@prisma/client";
import logger from "../utils/logger";

const prisma = new PrismaClient();
const router = Router();

type TwilioInboundWebhookBody = {
  From?: string;
  To?: string;
  Body?: string;
  MessageSid?: string;
};

export type InboundTwilioMessageContext = {
  userId: string;
  from: string;
  to?: string;
  body: string;
  messageSid: string;
  conversationId: string;
  conversationMessageId?: string;
};

/**
 * Hook point: implement whatever you want to happen after we receive + store
 * an inbound Twilio message.
 */
export async function onInboundTwilioMessage(
  _ctx: InboundTwilioMessageContext,
): Promise<void> {
  // TODO: implement your custom behavior (LLM call, scheduling logic, etc.)
}

/**
 * -------------------------
 * Conversations (CRUD)
 * -------------------------
 * Base path mounted at /conversations
 */

// Create Conversation
// Body example: { "user_id": "...", "state": {"foo":"bar"} }
router.post("/", async (req: Request, res: Response) => {
  try {
    const conversation = await prisma.conversation.create({
      data: req.body,
    });
    res.status(201).json(conversation);
  } catch (error: any) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002" &&
      Array.isArray(error.meta?.target) &&
      error.meta.target.includes("user_id")
    ) {
      return res.status(400).json({ error: "Conversation already exists for this user" });
    }
    res.status(500).json({ error: `Failed to create conversation - ${error}` });
  }
});

// List all Conversations
// Optional: ?includeMessages=1
router.get("/", async (req: Request, res: Response) => {
  try {
    const includeMessages = req.query.includeMessages === "1" || req.query.includeMessages === "true";

    const conversations = await prisma.conversation.findMany({
      include: includeMessages
        ? {
            messages: {
              orderBy: { created_at: "asc" },
            },
          }
        : undefined,
    });

    res.json(conversations);
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch conversations" });
  }
});

// Get Conversation by conversation_id
// Optional: ?includeMessages=1
router.get("/:id", async (req: Request, res: Response) => {
  try {
    const includeMessages = req.query.includeMessages === "1" || req.query.includeMessages === "true";

    const conversation = await prisma.conversation.findUnique({
      where: { conversation_id: req.params.id },
      include: includeMessages
        ? {
            messages: {
              orderBy: { created_at: "asc" },
            },
          }
        : undefined,
    });

    if (!conversation) return res.status(404).json({ error: "Conversation not found" });
    res.json(conversation);
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch conversation" });
  }
});

// Get Conversation by user_id (unique)
// Optional: ?includeMessages=1
router.get("/by-user/:userId", async (req: Request, res: Response) => {
  try {
    const includeMessages = req.query.includeMessages === "1" || req.query.includeMessages === "true";

    const conversation = await prisma.conversation.findUnique({
      where: { user_id: req.params.userId },
      include: includeMessages
        ? {
            messages: {
              orderBy: { created_at: "asc" },
            },
          }
        : undefined,
    });

    if (!conversation) return res.status(404).json({ error: "Conversation not found" });
    res.json(conversation);
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch conversation by user" });
  }
});

// Update Conversation by conversation_id
router.put("/:id", async (req: Request, res: Response) => {
  try {
    const conversation = await prisma.conversation.update({
      where: { conversation_id: req.params.id },
      data: req.body,
    });
    res.json(conversation);
  } catch (error: any) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2025") {
      return res.status(404).json({ error: "Conversation not found" });
    }
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002" &&
      Array.isArray(error.meta?.target) &&
      error.meta.target.includes("user_id")
    ) {
      return res.status(400).json({ error: "Conversation already exists for this user" });
    }
    res.status(500).json({ error: "Failed to update conversation" });
  }
});

// Delete Conversation by conversation_id (cascades to messages)
router.delete("/:id", async (req: Request, res: Response) => {
  try {
    await prisma.conversation.delete({
      where: { conversation_id: req.params.id },
    });
    res.status(204).send();
  } catch (error: any) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2025") {
      return res.status(404).json({ error: "Conversation not found" });
    }
    res.status(500).json({ error: "Failed to delete conversation" });
  }
});

/**
 * -------------------------
 * Conversation Messages (CRUD)
 * -------------------------
 * Nested under /conversations/:conversationId/messages
 */

// Create message
// Body example: { "role":"user", "direction":"inbound", "content":"hi", "twilio_sid":"...", "attributes": {...} }
router.post("/:conversationId/messages", async (req: Request, res: Response) => {
  const { conversationId } = req.params;

  try {
    const conversation = await prisma.conversation.findUnique({
      where: { conversation_id: conversationId },
      select: { conversation_id: true },
    });

    if (!conversation) return res.status(404).json({ error: "Conversation not found" });

    const message = await prisma.conversationMessage.create({
      data: {
        ...req.body,
        conversation_id: conversationId,
      },
    });

    res.status(201).json(message);
  } catch (error: any) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002" &&
      Array.isArray(error.meta?.target) &&
      error.meta.target.includes("twilio_sid")
    ) {
      return res.status(400).json({ error: "twilio_sid is already registered for another message" });
    }

    res.status(500).json({ error: `Failed to create conversation message - ${error}` });
  }
});

// List messages for a conversation
// Optional: ?take=50&skip=0
router.get("/:conversationId/messages", async (req: Request, res: Response) => {
  const { conversationId } = req.params;

  try {
    const take = req.query.take ? Number(req.query.take) : undefined;
    const skip = req.query.skip ? Number(req.query.skip) : undefined;

    const messages = await prisma.conversationMessage.findMany({
      where: { conversation_id: conversationId },
      orderBy: { created_at: "asc" },
      ...(Number.isFinite(take) ? { take } : {}),
      ...(Number.isFinite(skip) ? { skip } : {}),
    });

    res.json(messages);
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch conversation messages" });
  }
});

// Get a single message (scoped to a conversation)
router.get("/:conversationId/messages/:messageId", async (req: Request, res: Response) => {
  const { conversationId, messageId } = req.params;

  try {
    const message = await prisma.conversationMessage.findFirst({
      where: {
        message_id: messageId,
        conversation_id: conversationId,
      },
    });

    if (!message) return res.status(404).json({ error: "Conversation message not found" });
    res.json(message);
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch conversation message" });
  }
});

// Update a message (scoped to a conversation)
router.put("/:conversationId/messages/:messageId", async (req: Request, res: Response) => {
  const { conversationId, messageId } = req.params;

  try {
    const existing = await prisma.conversationMessage.findFirst({
      where: {
        message_id: messageId,
        conversation_id: conversationId,
      },
      select: { message_id: true },
    });

    if (!existing) return res.status(404).json({ error: "Conversation message not found" });

    const updated = await prisma.conversationMessage.update({
      where: { message_id: messageId },
      data: req.body,
    });

    res.json(updated);
  } catch (error: any) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002" &&
      Array.isArray(error.meta?.target) &&
      error.meta.target.includes("twilio_sid")
    ) {
      return res.status(400).json({ error: "twilio_sid is already registered for another message" });
    }

    res.status(500).json({ error: "Failed to update conversation message" });
  }
});

// Delete a message (scoped to a conversation)
router.delete("/:conversationId/messages/:messageId", async (req: Request, res: Response) => {
  const { conversationId, messageId } = req.params;

  try {
    const existing = await prisma.conversationMessage.findFirst({
      where: {
        message_id: messageId,
        conversation_id: conversationId,
      },
      select: { message_id: true },
    });

    if (!existing) return res.status(404).json({ error: "Conversation message not found" });

    await prisma.conversationMessage.delete({
      where: { message_id: messageId },
    });

    res.status(204).send();
  } catch (error: any) {
    res.status(500).json({ error: "Failed to delete conversation message" });
  }
});

/**
 * Twilio inbound webhook.
 * Twilio typically sends application/x-www-form-urlencoded.
 *
 * IMPORTANT: We return 200 immediately, then do background processing.
 */
router.post("/twilio/webhook", async (req: Request, res: Response) => {
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
          `Twilio webhook missing required fields (From/Body/MessageSid). Body=${JSON.stringify(body)}`,
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
});

export default router;
