import { Router, Request, Response } from "express";
import { Prisma, PrismaClient } from "@prisma/client";
import logger from "../utils/logger";
import { chat, type ChatMessage } from "../utils/openAiClient";

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

function parseJsonFromLLMText(rawText: string): any {
  const raw = (rawText ?? "").trim();
  if (!raw) {
    throw new Error("LLM returned empty text");
  }

  // Attempt direct parse first.
  try {
    return JSON.parse(raw);
  } catch {
    // Fall back to extracting a JSON blob (common when the model adds commentary).
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) {
      throw new Error(
        "LLM did not return valid JSON and no JSON blob was found."
      );
    }
    try {
      return JSON.parse(match[0]);
    } catch (e) {
      throw new Error(`Failed to parse JSON from LLM output: ${e}`);
    }
  }
}

function isNonEmptyString(x: unknown): x is string {
  return typeof x === "string" && x.trim().length > 0;
}

// TODO: implement conversation analyzers (location/start/end/homies) as needed.

/**
 * Analyze conversation messages to determine whether an event start time was provided.
 * Returns a normalized object with the raw LLM text included for debugging.
 */
export async function analyzeConversationStartTime(
  messages: ChatMessage[],
  systemPrompt: string
): Promise<{
  eventStartTimeProvided: boolean;
  eventStartTime: string | null;
  rawText: string;
}> {
  try {
    const { text } = await chat({
      system: systemPrompt,
      messages,
      model: process.env.OPENAI_MODEL,
      temperature: 0.0,
    });

    const raw = (text ?? "").trim();
    const parsed = parseJsonFromLLMText(raw);

    const provided = Boolean(parsed.eventStartTimeProvided);
    const eventStartTime =
      typeof parsed.eventStartTime === "string" ? parsed.eventStartTime : null;

    return { eventStartTimeProvided: provided, eventStartTime, rawText: raw };
  } catch (err: any) {
    logger.warn(`analyzeConversationStart error: ${err?.message ?? err}`);
    return {
      eventStartTimeProvided: false,
      eventStartTime: null,
      rawText: String(err?.message ?? err),
    };
  }
}

export async function analyzeConversationEndTime(
  messages: ChatMessage[],
  systemPrompt: string
): Promise<{
  eventEndTimeProvided: boolean;
  eventEndTime: string | null;
  rawText: string;
}> {
  try {
    const { text } = await chat({
      system: systemPrompt,
      messages,
      model: process.env.OPENAI_MODEL,
      temperature: 0.0,
    });

    const raw = (text ?? "").trim();
    const parsed = parseJsonFromLLMText(raw);

    const provided = Boolean(parsed.eventEndTimeProvided);
    const eventEndTime =
      typeof parsed.eventEndTime === "string" ? parsed.eventEndTime : null;

    return { eventEndTimeProvided: provided, eventEndTime, rawText: raw };
  } catch (err: any) {
    logger.warn(`analyzeConversationEndTime error: ${err?.message ?? err}`);
    return {
      eventEndTimeProvided: false,
      eventEndTime: null,
      rawText: String(err?.message ?? err),
    };
  }
}

export async function analyzeConversationLocation(
  messages: ChatMessage[],
  systemPrompt: string
): Promise<{
  eventLocationProvided: boolean;
  eventLocation: string | null;
  rawText: string;
}> {
  try {
    const { text } = await chat({
      system: systemPrompt,
      messages,
      model: process.env.OPENAI_MODEL,
      temperature: 0.0,
    });

    const raw = (text ?? "").trim();
    const parsed = parseJsonFromLLMText(raw);

    const provided = Boolean(parsed.eventLocationProvided);
    const eventLocation =
      typeof parsed.eventLocation === "string" ? parsed.eventLocation : null;

    return { eventLocationProvided: provided, eventLocation, rawText: raw };
  } catch (err: any) {
    logger.warn(`analyzeConversationLocation error: ${err?.message ?? err}`);
    return {
      eventLocationProvided: false,
      eventLocation: null,
      rawText: String(err?.message ?? err),
    };
  }
}

export async function analyzeConversationHomies(
  messages: ChatMessage[],
  systemPrompt: string,
  allowedHomies: string[]
): Promise<{
  homiesProvided: boolean;
  homies: string[] | null;
  maxHomies: number | null;
  rawText: string;
}> {
  try {
    const { text } = await chat({
      system: systemPrompt,
      messages,
      model: process.env.OPENAI_MODEL,
      temperature: 0.0,
    });

    const raw = (text ?? "").trim();
    const parsed = parseJsonFromLLMText(raw);

    const allowedByLower = new Map(
      allowedHomies
        .filter((h) => h.trim().length > 0)
        .map((h) => [h.trim().toLowerCase(), h.trim()] as const)
    );

    const extractedHomies: string[] = Array.isArray(parsed.homies)
      ? parsed.homies.filter(isNonEmptyString)
      : [];

    const normalizedHomies = Array.from(
      new Set(
        extractedHomies
          .map((h) => allowedByLower.get(h.trim().toLowerCase()))
          .filter((h): h is string => Boolean(h))
      )
    );

    let maxHomies: number | null = null;
    if (
      typeof parsed.maxHomies === "number" &&
      Number.isFinite(parsed.maxHomies)
    ) {
      maxHomies = Math.trunc(parsed.maxHomies);
    } else if (typeof parsed.maxHomies === "string") {
      const n = Number.parseInt(parsed.maxHomies, 10);
      if (Number.isFinite(n)) maxHomies = n;
    }

    if (maxHomies !== null && maxHomies <= 0) {
      maxHomies = null;
    }

    const homies = normalizedHomies.length ? normalizedHomies : null;
    const homiesProvided = Boolean(homies?.length) || maxHomies !== null;

    return { homiesProvided, homies, maxHomies, rawText: raw };
  } catch (err: any) {
    logger.warn(`analyzeConversationHomies error: ${err?.message ?? err}`);
    return {
      homiesProvided: false,
      homies: null,
      maxHomies: null,
      rawText: String(err?.message ?? err),
    };
  }
}

/**
 * Hook point: implement whatever you want to happen after we receive + store
 * an inbound Twilio message.
 */
export async function onInboundTwilioMessage(
  _ctx: InboundTwilioMessageContext
): Promise<void> {
  console.log("HEEEERRRREEEE");
  console.log("HEEEERRRREEEE");
  console.log(_ctx);
  console.log("HEEEERRRREEEE");
  console.log("HEEEERRRREEEE");

  const user = await prisma.user.findUnique({
    where: { user_id: _ctx.userId },
  });

  if (!user) {
    throw new Error(`User not found for userId=${_ctx.userId}`);
  }

  const activity = await prisma.activity.findFirst({
    where: { user_id: user.user_id },
  });

  if (!activity) {
    throw new Error(`No activity found for userId=${user.user_id}`);
  }

  const conversation = await prisma.conversation.findUnique({
    where: { conversation_id: _ctx.conversationId },
  });

  const homies = await prisma.member.findMany({
    where: { user_id: _ctx.userId },
  });

  const homieNames = homies
    .map((h) => `${h.first_name} ${h.last_name}`.trim())
    .filter((name) => name.length > 0);

  const homiesList = homieNames.length
    ? homieNames.map((name) => `- ${name}`).join("\n")
    : "(no homies yet)";

  if (!conversation) {
    throw new Error(
      `No conversation found for conversationId=${_ctx.conversationId}`
    );
  }

  if (!user.phone_number) {
    throw new Error(`User has no phone_number for userId=${_ctx.userId}`);
  }

  // Pull most recent conversation history to provide context to the LLM.
  // NOTE: we include the inbound message that was just persisted by the webhook handler.
  const historyLimit = Number("20");

  const history = await prisma.conversationMessage.findMany({
    where: { conversation_id: _ctx.conversationId },
    orderBy: { created_at: "desc" },
    take: Number.isFinite(historyLimit) ? historyLimit : 20,
    select: { role: true, content: true, created_at: true },
  });

  // DB returns newest-first; OpenAI wants oldest-first.
  const messages: ChatMessage[] = history.reverse().map((m) => ({
    role: m.role === "user" ? "user" : "assistant",
    content: m.content,
  }));

  const locationAnalyzerSystemPrompt = `You are an assistant that checks if the user provided the event location in the conversation.

Respond only in this JSON format:
{
  "eventLocationProvided": true|false,
  "eventLocation": "exact_location_text_from_user"
}

Rules:
- Only mark provided=true if the user explicitly gave a location.
- Accept addresses, venue names, parks, or "my place" style answers as location text.
- Do not guess.
- Return the exact location text as it appears in the conversation.`;

  const startTimeAnalyzerSystemPrompt = `You are an assistant that checks if the user provided the event's start time in the conversation. Respond only in this JSON format:

{
  "eventStartTimeProvided": true|false,
  "eventStartTime": "ISO_8601_datetime_or_exact_text_from_user_if_provided"
}

The start time is in ${user.timezone}.

Do not guess.`;

  const endTimeAnalyzerSystemPrompt = `You are an assistant that checks if the user provided the event's end time in the conversation. Respond only in this JSON format:

{
  "eventEndTimeProvided": true|false,
  "eventEndTime": "ISO_8601_datetime_or_exact_text_from_user_if_provided"
}

The end time is in ${user.timezone}.

Rules:
- Only mark provided=true if the user explicitly provided an end time or a duration that implies an end time (e.g., "for 2 hours").
- If a duration is provided, return the exact duration text as eventEndTime.
- Do not guess.`;

  const homiesAnalyzerSystemPrompt = `You are an assistant that extracts which homies the user wants to invite.

You MUST respond only in this JSON format:
{
  "homies": ["Full Name", "Full Name"],
  "maxHomies": number|null
}

Rules:
- If the user lists specific homies, put those names in homies.
- If the user gives a max number (e.g., "invite 3"), set maxHomies to 3.
- If neither is provided, return an empty homies array and maxHomies null.
- Do not invent names.
- Homies may ONLY be selected from this list (verbatim):
${homiesList}`;

  console.log("+++++++++++++++=");
  console.log("+++++++++++++++=");
  console.log(messages);
  console.log("+++++++++++++++=");
  console.log("+++++++++++++++=");

  const analysisResults = await Promise.allSettled([
    analyzeConversationLocation(messages, locationAnalyzerSystemPrompt),
    analyzeConversationStartTime(messages, startTimeAnalyzerSystemPrompt),
    analyzeConversationEndTime(messages, endTimeAnalyzerSystemPrompt),
    analyzeConversationHomies(messages, homiesAnalyzerSystemPrompt, homieNames),
  ]);

  const [locationRes, startRes, endRes, homiesRes] = analysisResults;

  const locationAnalysis =
    locationRes.status === "fulfilled"
      ? locationRes.value
      : {
          eventLocationProvided: false,
          eventLocation: null,
          rawText: String(locationRes.reason),
        };

  const startAnalysis =
    startRes.status === "fulfilled"
      ? startRes.value
      : {
          eventStartTimeProvided: false,
          eventStartTime: null,
          rawText: String(startRes.reason),
        };

  const endAnalysis =
    endRes.status === "fulfilled"
      ? endRes.value
      : {
          eventEndTimeProvided: false,
          eventEndTime: null,
          rawText: String(endRes.reason),
        };

  const homiesAnalysis =
    homiesRes.status === "fulfilled"
      ? homiesRes.value
      : {
          homiesProvided: false,
          homies: null,
          maxHomies: null,
          rawText: String(homiesRes.reason),
        };

  logger.info("locationAnalysis", locationAnalysis);
  logger.info("startAnalysis", startAnalysis);
  logger.info("endAnalysis", endAnalysis);
  logger.info("homiesAnalysis", homiesAnalysis);

  if (
    locationRes.status === "fulfilled" &&
    startRes.status === "fulfilled" &&
    endRes.status === "fulfilled" &&
    homiesRes.status === "fulfilled"
  ) {
  } else {
    const system = `You are Buckfifty, ${user.first_name}'s scheduling assistant. All communication happens via SMS text messaging. Your responses must be short, clear, and easy to read on a phone screen.

Your role is to help ${user.first_name} plan and schedule the ${activity.name} they signed up for by coordinating with their onboarded homies.

Your sole objective is to collect event details so the Buckfifty app can coordinate attendance.

You must collect:
1. Event location
2. Event start time and end time ${user.first_name} is located in ${user.timezone} timezone
3. Homies to invite

Available homies (you may ONLY select from this list):
${homiesList}

Homies rules:
- Accept either:
  - A specific list of homies chosen ONLY from the available homies above, or
  - A maximum number of homies to invite
- If no homie list is provided, you MUST ask for the maximum number
- Do NOT invent, suggest, or accept homies outside of the provided list

SMS formatting rules:
- Keep messages short (1-3 short lines when possible)
- Use simple line breaks for readability
- Avoid long paragraphs, markdown, or emojis

Behavior rules:
- Ask only for missing information all at once
- Do not assume or infer details
- Be friendly, concise, and conversational
- Do not perform availability checks or coordination
- Avoid repeating questions already answered

Once location, start time, end time, and homie selection (or max count) are collected, confirm completion and stop.`;

    const { text } = await chat({
      system,
      messages,
      model: process.env.OPENAI_MODEL,
      temperature: 0.3,
    });

    const reply = (text ?? "").trim();

    console.log("=------------------=");
    console.log("=------------------=");
    console.log(reply);
    console.log("=------------------=");
    console.log("=------------------=");

    // // Send reply to the user via SMS
    // await sendSms(user.phone_number, reply || "(no response)");

    // Persist outbound assistant message to keep the conversation history consistent.
    // (Twilio outbound MessageSid isn't currently captured by sendSms; you can extend sendSms
    // to return it if you want to store it.)
    await prisma.conversationMessage.create({
      data: {
        conversation_id: _ctx.conversationId,
        role: "assistant",
        direction: "outbound",
        content: reply || "(no response)",
        attributes: {
          llm: {
            provider: "openai",
            model: process.env.OPENAI_MODEL ?? "gpt-4o-mini",
          },
        },
      },
    });
  }
}

/**
 * Twilio inbound webhook.
 * Twilio typically sends application/x-www-form-urlencoded.
 *
 * IMPORTANT: We return 200 immediately, then do background processing.
 */
router.post("/webhook", async (req: Request, res: Response) => {
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
          `Twilio webhook missing required fields (From/Body/MessageSid). Body=${JSON.stringify(
            body
          )}`
        );
        return;
      }

      // Find user by phone number
      const user = await prisma.user.findUnique({
        where: { phone_number: from },
        select: { user_id: true },
      });

      if (!user) {
        logger.info(
          `Twilio inbound message from unknown number ${from}; ignoring.`
        );
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
          logger.info(
            `Duplicate Twilio webhook received for MessageSid=${messageSid}; ignoring.`
          );
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
