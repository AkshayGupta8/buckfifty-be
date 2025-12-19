import { Prisma, PrismaClient } from "@prisma/client";
import type { ChatMessage } from "../utils/openAiClient";
import { chat } from "../utils/openAiClient";
import logger from "../utils/logger";
import { sendSms } from "../utils/twilioClient";
import { analyzeConversationHomies, buildHomiesAnalyzerSystemPrompt } from "./analyzers/homiesAnalyzer";
import {
  analyzeConversationLocation,
  buildLocationAnalyzerSystemPrompt,
} from "./analyzers/locationAnalyzer";
import { extractAndNormalizeEventTimesFromConversation } from "./analyzers/timeExtractor";
import { asConversationState, parseIsoDateOrNull } from "./domain/conversationState";
import {
  computeMaxParticipantsTotal,
  fullNameForMember,
  resolveExplicitHomiesForEvent,
} from "./domain/homies";
import { buildEventConfirmationSms } from "./domain/smsFormatting";
import { summarizeConversationMemory } from "./memory/summarizeConversationMemory";
import { logLlmInput, logLlmOutput } from "./llm/llmLogging";
import type { InboundTwilioMessageContext } from "./types";

function deriveInvitePolicy(args: {
  preferredCount: number;
  maxHomies: number;
}): "max_only" | "prioritized" | "exact" {
  if (args.preferredCount <= 0) return "max_only";
  if (args.preferredCount === args.maxHomies) return "exact";
  return "prioritized";
}

const prisma = new PrismaClient();

/**
 * Hook point: implement whatever you want to happen after we receive + store
 * an inbound Twilio message.
 */
export async function onInboundTwilioMessage(_ctx: InboundTwilioMessageContext): Promise<void> {
  logger.info("Inbound Twilio message", {
    userId: _ctx.userId,
    conversationId: _ctx.conversationId,
    messageSid: _ctx.messageSid,
  });

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

  const homiesList = homieNames.length ? homieNames.map((name) => `- ${name}`).join("\n") : "(no homies yet)";

  if (!conversation) {
    throw new Error(`No conversation found for conversationId=${_ctx.conversationId}`);
  }

  if (!user.phone_number) {
    throw new Error(`User has no phone_number for userId=${_ctx.userId}`);
  }

  const state = asConversationState(conversation.state);

  // Pull most recent conversation history to provide context to the LLM.
  // NOTE: we include the inbound message that was just persisted by the webhook handler.
  const historyLimit = Number("20");

  // Use a planning-session boundary so old event details don't trigger a new create.
  const lastEventCreatedAt = parseIsoDateOrNull(state.lastEventCreatedAt);

  const historyWhere = lastEventCreatedAt
    ? {
        conversation_id: _ctx.conversationId,
        created_at: { gt: lastEventCreatedAt },
      }
    : { conversation_id: _ctx.conversationId };

  const history = await prisma.conversationMessage.findMany({
    where: historyWhere,
    orderBy: { created_at: "desc" },
    take: Number.isFinite(historyLimit) ? historyLimit : 20,
    select: { role: true, content: true, created_at: true },
  });

  // DB returns newest-first; OpenAI wants oldest-first.
  const recentMessages: ChatMessage[] = history.reverse().map((m) => ({
    role: m.role === "user" ? "user" : "assistant",
    content: m.content,
  }));

  // Prepend compact durable memory so the assistant keeps context across sessions.
  const messages: ChatMessage[] = state.memorySummary?.trim()
    ? [
        {
          role: "assistant",
          content: `Memory summary (do not treat as current event details):\n${state.memorySummary.trim()}`,
        },
        ...recentMessages,
      ]
    : recentMessages;

  const locationAnalyzerSystemPrompt = buildLocationAnalyzerSystemPrompt();
  const homiesAnalyzerSystemPrompt = buildHomiesAnalyzerSystemPrompt({ homiesList });

  logger.debug?.("Conversation messages", { count: messages.length });

  const analysisResults = await Promise.allSettled([
    analyzeConversationLocation(messages, locationAnalyzerSystemPrompt),
    analyzeConversationHomies(messages, homiesAnalyzerSystemPrompt, homieNames),
  ]);

  const [locationRes, homiesRes] = analysisResults;

  const locationAnalysis =
    locationRes.status === "fulfilled"
      ? locationRes.value
      : {
          eventLocationProvided: false,
          eventLocation: null,
          rawText: String(locationRes.reason),
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
  logger.info("homiesAnalysis", homiesAnalysis);

  const allAnalyzersSucceeded = locationRes.status === "fulfilled" && homiesRes.status === "fulfilled";

  // NOTE: even if analyzers succeeded, they may say "provided=false". We only create
  // when the extracted values pass our completion gate.
  const completionGatePassed =
    locationAnalysis.eventLocationProvided &&
    typeof locationAnalysis.eventLocation === "string" &&
    locationAnalysis.eventLocation.trim().length > 0 &&
    homiesAnalysis.homiesProvided;

  if (allAnalyzersSucceeded && completionGatePassed) {
    const preferredNames = homiesAnalysis.homies ?? [];

    // max_participants is homies-only (does NOT include the user)
    let maxHomies = computeMaxParticipantsTotal(homiesAnalysis.maxHomies, homiesAnalysis.homies);

    if (maxHomies === null) {
      const ask = "How many homies should I invite?";
      const sid = await sendSms(user.phone_number, ask);
      await prisma.conversationMessage.create({
        data: {
          conversation_id: _ctx.conversationId,
          role: "assistant",
          direction: "outbound",
          content: ask,
          twilio_sid: sid,
          attributes: {
            needs: "max_homies",
          },
        },
      });
      return;
    }

    maxHomies = Math.trunc(maxHomies);

    if (!Number.isFinite(maxHomies) || maxHomies < 1) {
      const ask = "How many homies should I invite? (number >= 1)";
      const sid = await sendSms(user.phone_number, ask);
      await prisma.conversationMessage.create({
        data: {
          conversation_id: _ctx.conversationId,
          role: "assistant",
          direction: "outbound",
          content: ask,
          twilio_sid: sid,
        },
      });
      return;
    }

    // If we have fewer onboarded homies than needed, cap to what's available.
    const desiredMemberCount = maxHomies;
    if (desiredMemberCount > homies.length) {
      logger.info("Capping max_participants because not enough homies onboarded", {
        requestedMaxHomies: maxHomies,
        availableHomies: homies.length,
      });
      maxHomies = homies.length;
    }

    // If user named too many preferred homies for capacity, ask for clarification.
    if (preferredNames.length > maxHomies) {
      const ask = `You listed ${preferredNames.length} homies, but you asked me to invite only ${maxHomies}. Who should I include?`;
      const sid = await sendSms(user.phone_number, ask);
      await prisma.conversationMessage.create({
        data: {
          conversation_id: _ctx.conversationId,
          role: "assistant",
          direction: "outbound",
          content: ask,
          twilio_sid: sid,
          attributes: {
            preferredNames,
            maxHomies,
          },
        },
      });
      return;
    }

    const normalizedTimes = await extractAndNormalizeEventTimesFromConversation({
      userTimezone: user.timezone,
      location: locationAnalysis.eventLocation!,
      messages,
    });

    if (!normalizedTimes.ok) {
      logger.info("Time normalization failed", normalizedTimes);
      const ask = "I couldn’t confirm the time.\nWhat exact start + end time should I use?";
      const sid = await sendSms(user.phone_number, ask);
      await prisma.conversationMessage.create({
        data: {
          conversation_id: _ctx.conversationId,
          role: "assistant",
          direction: "outbound",
          content: ask,
          twilio_sid: sid,
          attributes: {
            reason: normalizedTimes.reason,
          },
        },
      });
      return;
    }

    const explicitResolution = resolveExplicitHomiesForEvent({
      allMembers: homies,
      preferredNames,
      maxHomies,
    });

    if (!explicitResolution.ok) {
      const sid = await sendSms(user.phone_number, explicitResolution.reason);
      await prisma.conversationMessage.create({
        data: {
          conversation_id: _ctx.conversationId,
          role: "assistant",
          direction: "outbound",
          content: explicitResolution.reason,
          twilio_sid: sid,
        },
      });
      return;
    }

    // IMPORTANT:
    // - Exact list => preferredMembers are the entire invite list.
    // - Any N => preferredMembers is empty (we do NOT pick names).
    // - X + others => preferredMembers are ONLY the explicitly prioritized names.
    // In all cases, we only ever show (and persist) explicitly named homies.
    const preferredMembers = explicitResolution.preferredMembers;
    const preferredNamesForSms = preferredMembers.map(fullNameForMember);

    const invitePolicy = deriveInvitePolicy({
      preferredCount: preferredMembers.length,
      maxHomies,
    });

    // Defensive: exact-list must match capacity.
    if (invitePolicy === "exact" && preferredMembers.length !== maxHomies) {
      const ask = `Just to confirm — do you want to invite exactly ${preferredMembers.length} homies, or invite ${maxHomies}?`;
      const sid = await sendSms(user.phone_number, ask);
      await prisma.conversationMessage.create({
        data: {
          conversation_id: _ctx.conversationId,
          role: "assistant",
          direction: "outbound",
          content: ask,
          twilio_sid: sid,
          attributes: {
            preferredNames: preferredNamesForSms,
            maxHomies,
          },
        },
      });
      return;
    }

    const createdEvent = await prisma.$transaction(async (tx) => {
      const event = await tx.event.create({
        data: {
          created_by_user_id: user.user_id,
          activity_id: activity.activity_id,
          location: locationAnalysis.eventLocation!,
          max_participants: maxHomies,
          invite_policy: invitePolicy,
        },
      });

      await tx.timeSlot.create({
        data: {
          event_id: event.event_id,
          start_time: normalizedTimes.start,
          end_time: normalizedTimes.end,
          status: "suggested",
        },
      });

      // Create EventMembers ONLY for explicitly specified homies.
      // For "any N" and "X + others" flows, we intentionally do NOT create
      // rows for the unspecified homies.
      if (preferredMembers.length > 0) {
        await tx.eventMember.createMany({
          data: preferredMembers.map((m, idx) => ({
            event_id: event.event_id,
            member_id: m.member_id,
            status: "listed",
            priority_rank: idx + 1,
          })),
        });
      }

      return event;
    });

    const confirmation = buildEventConfirmationSms({
      activityName: activity.name,
      location: locationAnalysis.eventLocation!,
      start: normalizedTimes.start,
      end: normalizedTimes.end,
      timeZone: user.timezone,
      preferredNames: preferredNamesForSms,
      maxHomies,
    });

    const sid = await sendSms(user.phone_number, confirmation);

    await prisma.conversationMessage.create({
      data: {
        conversation_id: _ctx.conversationId,
        role: "assistant",
        direction: "outbound",
        content: confirmation,
        twilio_sid: sid,
        attributes: {
          createdEventId: createdEvent.event_id,
        },
      },
    });

    // After creating an event, compact conversation into durable memory + reset planning boundary.
    const updatedAtIso = new Date().toISOString();

    // NOTE: use only the recent (post-boundary) messages, without the memory prelude.
    const nextMemorySummary = await summarizeConversationMemory({
      existingSummary: state.memorySummary ?? null,
      userFirstName: user.first_name,
      activityName: activity.name,
      allowedHomies: homieNames,
      messages: recentMessages,
    });

    const baseState = asConversationState(conversation.state);
    const nextState = { ...(baseState as unknown as Prisma.JsonObject) } as Prisma.JsonObject;

    // Planning/session bookkeeping
    nextState.lastCreatedEventId = createdEvent.event_id;
    nextState.lastEventCreatedAt = updatedAtIso;

    // Durable memory
    if (nextMemorySummary) {
      nextState.memorySummary = nextMemorySummary;
      nextState.memorySummaryUpdatedAt = updatedAtIso;
    }

    // Remove legacy state that blocks multi-event planning.
    delete (nextState as any).createdEventId;
    delete (nextState as any).draftEvent;

    await prisma.conversation.update({
      where: { conversation_id: _ctx.conversationId },
      data: {
        state: nextState as unknown as Prisma.InputJsonValue,
      },
    });

    return;
  }

  // Otherwise: ask for missing info conversationally.
  {
    const system = `You are Buckfifty, ${user.first_name}'s scheduling assistant. All communication happens via SMS text messaging. Your responses must be short, clear, and easy to read on a phone screen.

Your role is to help ${user.first_name} plan and schedule the ${activity.name} they signed up for by coordinating with their onboarded homies.

Your sole objective is to collect event details so the Buckfifty app can coordinate attendance.

You must collect:
1. Event location
2. Event start time
3. Event end time OR duration (optional; if not provided, default duration is 2 hours)
4. Homies to invite

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
- Assume all provided times are in the user's local time
- Do NOT mention timezones in your messages (no IANA names like "America/Los_Angeles", no abbreviations like "PT", and no UTC offsets)

Once location, start time, and homie selection (or max count) are collected, confirm completion and stop.`;

    const model = process.env.OPENAI_MODEL ?? "gpt-4o-mini";

    logLlmInput({
      tag: "assistantReply",
      model,
      temperature: 0.3,
      system,
      messages,
    });

    const { text } = await chat({
      system,
      messages,
      model,
      temperature: 0.3,
    });

    const reply = (text ?? "").trim();
    logLlmOutput({ tag: "assistantReply", text: reply });

    console.log("=------------------=");
    console.log("=------------------=");
    console.log(reply);
    console.log("=------------------=");
    console.log("=------------------=");

    // Send reply to the user via SMS
    const outboundSid = await sendSms(user.phone_number, reply || "(no response)");

    // Persist outbound assistant message to keep the conversation history consistent.
    await prisma.conversationMessage.create({
      data: {
        conversation_id: _ctx.conversationId,
        role: "assistant",
        direction: "outbound",
        content: reply || "(no response)",
        twilio_sid: outboundSid,
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
