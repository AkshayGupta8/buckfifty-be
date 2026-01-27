import { Prisma, PrismaClient } from "@prisma/client";
import type { ChatMessage } from "../utils/openAiClient";
import logger from "../utils/logger";
import { sendSms } from "../utils/twilioClient";
import {
  analyzeConversationHomies,
  buildHomiesAnalyzerSystemPrompt,
} from "./analyzers/homiesAnalyzer";
import {
  analyzeConversationLocation,
  buildLocationAnalyzerSystemPrompt,
} from "./analyzers/locationAnalyzer";
import {
  analyzeConversationInviteMessage,
  buildInviteMessageAnalyzerSystemPrompt,
} from "./analyzers/inviteMessageAnalyzer";
import { analyzeEventTimePatch } from "./analyzers/eventTimePatchAnalyzer";
import {
  asConversationState,
  type ActiveEventDraft,
  parseIsoDateOrNull,
} from "./domain/conversationState";
import {
  computeMaxParticipantsTotal,
  fullNameForMember,
  resolveExplicitHomiesForEvent,
} from "./domain/homies";
import { brandedInvitePolicyName } from "./domain/inviteBranding";
import { buildEventDraftPreviewSms } from "./domain/smsFormatting";
import { buildSchedulerHowItWorksSms } from "./domain/helpFormatting";
import { summarizeConversationMemory } from "./memory/summarizeConversationMemory";
import {
  onEventCreated,
  onMemberInboundMessage,
} from "./coordinator/coordinator";
import {
  analyzeEventConfirmation,
  buildEventConfirmationAnalyzerSystemPrompt,
} from "./analyzers/eventConfirmationAnalyzer";
import {
  analyzeEventDraftEdit,
  buildEventDraftEditAnalyzerSystemPrompt,
} from "./analyzers/eventDraftEditAnalyzer";
import {
  analyzeInvitePolicyIntent,
  buildInvitePolicyIntentAnalyzerSystemPrompt,
} from "./analyzers/invitePolicyIntentAnalyzer";
import {
  analyzeHelpIntent,
  buildHelpIntentAnalyzerSystemPrompt,
} from "./analyzers/helpIntentAnalyzer";
import { applyInvitePlanPatch } from "./domain/invitePlanEdits";
import { parseInvitePolicyChoiceFromUserText } from "./domain/invitePolicyChoice";
import type { InboundTwilioMessageContext } from "./types";

import { DateTime } from "luxon";
import {
  anchorTimeOfDayToNow,
  anchorTimeOfDayToExplicitDayOffset,
  anchorTimeOfDayToReferenceDay,
  detectExplicitDayOffset,
  parseDurationMinutes,
  parseSimpleTimeOfDay,
  parseTimeRangeOfDay,
  textMentionsStartOrEnd,
} from "./domain/smsTimeParsing";

function shuffleInPlace<T>(arr: T[]): T[] {
  // Fisher–Yates shuffle
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function uniqueById<T extends { member_id: string }>(members: T[]): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const m of members) {
    if (!seen.has(m.member_id)) {
      seen.add(m.member_id);
      out.push(m);
    }
  }
  return out;
}

function buildInvitePlan(args: {
  invitePolicy: "max_only" | "prioritized" | "exact";
  maxHomies: number;
  allMembers: Prisma.MemberGetPayload<{}>[];
  preferredMembers: Prisma.MemberGetPayload<{}>[];
}): {
  // Members to mark as `invited` immediately
  immediate: Prisma.MemberGetPayload<{}>[];
  // Members to mark as `listed` for follow-up (decline/timeout)
  followUp: Prisma.MemberGetPayload<{}>[];
} {
  const all = uniqueById(args.allMembers);
  const preferred = uniqueById(args.preferredMembers);

  const max = Math.max(0, Math.trunc(args.maxHomies));

  if (args.invitePolicy === "exact") {
    return {
      immediate: preferred,
      followUp: [],
    };
  }

  if (args.invitePolicy === "prioritized") {
    const preferredIds = new Set(preferred.map((m) => m.member_id));
    const remaining = all.filter((m) => !preferredIds.has(m.member_id));
    shuffleInPlace(remaining);

    // Priority Invite behavior (per product):
    // - ALWAYS invite all preferred (priority) homies, even if that exceeds n.
    // - If preferred doesn't already fill capacity, randomly pick additional homies
    //   until we reach the requested total capacity.
    //
    // NOTE: Invites may exceed capacity because capacity is enforced at ACCEPT time.
    // But when preferred <= n, treat n as the TOTAL desired homies (not "additional").
    const fillersNeeded = Math.max(0, max - preferred.length);
    const fillers = remaining.slice(0, fillersNeeded);
    const immediate = [...preferred, ...fillers];

    const immediateIds = new Set(immediate.map((m) => m.member_id));
    // Follow-up should be randomized so it reflects the order we’ll likely invite next.
    const followUp = shuffleInPlace(
      all.filter((m) => !immediateIds.has(m.member_id)),
    );

    return { immediate, followUp };
  }

  // max_only
  const shuffled = shuffleInPlace([...all]);
  const immediate = shuffled.slice(0, max);
  const followUp = shuffled.slice(max);
  return { immediate, followUp };
}

function resolveMembersById(args: {
  allMembers: Prisma.MemberGetPayload<{}>[];
  ids: string[];
}): Prisma.MemberGetPayload<{}>[] {
  const byId = new Map(args.allMembers.map((m) => [m.member_id, m] as const));
  return (args.ids ?? [])
    .map((id) => byId.get(id))
    .filter(Boolean) as Prisma.MemberGetPayload<{}>[];
}

function buildAllowedHomiesListForPrompt(
  homies: Prisma.MemberGetPayload<{}>[],
): string {
  const names = homies
    .map((h) => fullNameForMember(h))
    .map((n) => n.trim())
    .filter((n) => n.length > 0);

  return names.length
    ? names.map((n) => `- ${n}`).join("\n")
    : "(no homies yet)";
}

function buildLockedInInvitePlanSms(args: {
  activityName: string;
  location: string;
  start: Date;
  end: Date;
  timeZone: string;
  invitePolicy: "max_only" | "prioritized" | "exact";
  maxHomies: number;
  inviteMessage?: string | null;
  immediateNames: string[];
  followUpNames: string[];
}): string {
  // We intentionally override the prior confirmation text so it lists actual names.
  // Keep it short and SMS-friendly.

  const dayFmt = new Intl.DateTimeFormat("en-US", {
    timeZone: args.timeZone,
    weekday: "short",
    month: "short",
    day: "numeric",
  });

  const timeFmt = new Intl.DateTimeFormat("en-US", {
    timeZone: args.timeZone,
    hour: "numeric",
    minute: "2-digit",
  });

  const sameDay =
    dayFmt.format(args.start) === dayFmt.format(args.end) &&
    new Intl.DateTimeFormat("en-US", {
      timeZone: args.timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(args.start) ===
      new Intl.DateTimeFormat("en-US", {
        timeZone: args.timeZone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }).format(args.end);

  const when = sameDay
    ? `${dayFmt.format(args.start)} ${timeFmt.format(args.start)} - ${timeFmt.format(
        args.end,
      )}`
    : `${dayFmt.format(args.start)} ${timeFmt.format(
        args.start,
      )} - ${dayFmt.format(args.end)} ${timeFmt.format(args.end)}`;

  const note = (args.inviteMessage ?? "").trim();
  const noteLine = note.length ? `\nNote for homies: ${note}` : "";

  const immediate = args.immediateNames.filter((n) => n.trim().length > 0);
  const followUp = args.followUpNames.filter((n) => n.trim().length > 0);

  const immediateLine = `Inviting now: ${
    immediate.length ? immediate.join(", ") : "(none)"
  }`;

  let backupLine: string;
  if (args.invitePolicy === "exact") {
    backupLine = "Backup invites: (none)";
  } else {
    backupLine = `Backup invites (if needed): ${
      followUp.length ? followUp.join(", ") : "(none)"
    }`;
  }

  // Requested format: explicitly include these two lines.
  return `Locked in: ${args.activityName}\nWhen: ${when}\nWhere: ${args.location}\n${immediateLine}\n${backupLine}${noteLine}`;
}

function deriveInvitePolicy(args: {
  preferredCount: number;
  maxHomies: number;
}): "max_only" | "prioritized" | "exact" {
  if (args.preferredCount <= 0) return "max_only";
  if (args.preferredCount === args.maxHomies) return "exact";
  return "prioritized";
}

// invite-policy choice parsing lives in ./domain/invitePolicyChoice

async function detectInvitePolicyHintFromMessages(
  messages: ChatMessage[],
): Promise<"max_only" | "prioritized" | "exact" | null> {
  // Look at the recent user text only.
  const recentUserMessages = messages
    .filter((m) => m.role === "user")
    .slice(-5);
  const systemPrompt = buildInvitePolicyIntentAnalyzerSystemPrompt();
  const { intent } = await analyzeInvitePolicyIntent({
    systemPrompt,
    messages: recentUserMessages,
  });

  // Guardrail: if low confidence, treat as no hint.
  if (!intent.policy || intent.confidence === "low") return null;
  return intent.policy;
}

const prisma = new PrismaClient();

/**
 * Hook point: implement whatever you want to happen after we receive + store
 * an inbound Twilio message.
 */
export async function onInboundTwilioMessage(
  _ctx: InboundTwilioMessageContext,
): Promise<void> {
  logger.info("Inbound Twilio message", {
    userId: _ctx.userId,
    conversationId: _ctx.conversationId,
    messageSid: _ctx.messageSid,
    senderType: _ctx.senderType,
    memberId: _ctx.memberId,
    eventId: _ctx.eventId,
  });

  // Member inbound messages are handled by the coordinator (invite responses).
  if (_ctx.senderType === "member") {
    if (!_ctx.memberId || !_ctx.eventId) {
      logger.warn("Member inbound message missing memberId/eventId; ignoring", {
        conversationId: _ctx.conversationId,
        messageSid: _ctx.messageSid,
      });
      return;
    }

    await onMemberInboundMessage({
      eventId: _ctx.eventId,
      memberId: _ctx.memberId,
      inboundBody: _ctx.body,
      inboundMessageSid: _ctx.messageSid,
    });

    return;
  }

  const user = await prisma.user.findUnique({
    where: { user_id: _ctx.userId },
  });

  if (!user) {
    throw new Error(`User not found for userId=${_ctx.userId}`);
  }

  // Ensure we have a phone number before any outbound SMS (including assistant intents).
  // This also narrows the type for TypeScript.
  if (!user.phone_number) {
    throw new Error(`User has no phone_number for userId=${_ctx.userId}`);
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

  // =========================
  // Lightweight assistant intents
  // =========================
  // These are “info” questions that should NOT trigger the scheduling flow.
  // Keep deterministic (no LLM) so UX is reliable.
  const normalizeQuick = (t: string): string =>
    (t ?? "")
      .toLowerCase()
      .trim()
      // Strip punctuation so "who are you?" matches.
      .replace(/[^a-z0-9\s]/g, "")
      .replace(/\s+/g, " ");

  const t0 = normalizeQuick(_ctx.body ?? "");

  const isWhoAreMyHomies =
    t0 === "who are my homies" ||
    t0 === "who are my homies list" ||
    t0 === "list my homies" ||
    t0 === "my homies";

  const isWhoAreYou =
    t0 === "who are you" ||
    t0 === "who r u" ||
    t0 === "what are you" ||
    t0 === "what is buckfifty" ||
    t0 === "what is buck fifty";

  if (isWhoAreMyHomies) {
    const activityName = (activity.name ?? "").trim() || "your activity";

    const names = homieNames.filter((n) => n.trim().length > 0);
    const list = names.length
      ? names.map((n) => `- ${n}`).join("\n")
      : "(no homies yet)";

    const sms = names.length
      ? `Here are your homies:\n${list}\n\nWant me to help schedule ${activityName} with them?`
      : `You don't have any homies added yet.\n\nWant to add one, or should we schedule ${activityName} with someone new?`;

    const sid = await sendSms(user.phone_number, sms);
    await prisma.conversationMessage.create({
      data: {
        conversation_id: _ctx.conversationId,
        role: "assistant",
        direction: "outbound",
        content: sms,
        twilio_sid: sid,
        attributes: { kind: "assistant_intent_homies_list" },
      },
    });

    return;
  }

  if (isWhoAreYou) {
    const activityName = (activity.name ?? "").trim() || "your activity";
    const sms = `I'm the BuckFifty AI. I help you schedule ${activityName} with your homies.\n\nTell me what you want to do (e.g. \"schedule ${activityName} tomorrow at 7\") and I'll take it from there.`;

    const sid = await sendSms(user.phone_number, sms);
    await prisma.conversationMessage.create({
      data: {
        conversation_id: _ctx.conversationId,
        role: "assistant",
        direction: "outbound",
        content: sms,
        twilio_sid: sid,
        attributes: { kind: "assistant_intent_identity" },
      },
    });

    return;
  }

  if (!conversation) {
    throw new Error(
      `No conversation found for conversationId=${_ctx.conversationId}`,
    );
  }

  const state = asConversationState(conversation.state);

  // Command-style help. Keep this deterministic so it behaves predictably.
  // NOTE: Twilio reserves HELP for compliance and may auto-respond instead of forwarding.
  // So we use "guide" and "how does this work".
  const normalizeCommand = (t: string): string =>
    (t ?? "")
      .toLowerCase()
      .trim()
      // Strip punctuation so "help?" still works.
      .replace(/[^a-z0-9\s]/g, "")
      .replace(/\s+/g, " ");

  const cmd = normalizeCommand(_ctx.body ?? "");
  const isHelpCommand = cmd === "guide" || cmd === "how does this work";

  // Natural-language help/guide intent (LLM-based).
  // This catches messages like: "Can you tell me about the different types of invites?"
  // Guardrails:
  // - keep temperature=0
  // - treat low-confidence as no intent
  // - optional question-shape check to avoid hijacking scheduling details
  let helpIntent: {
    intent: "invite_guide" | "scheduler_help" | null;
    confidence: "high" | "medium" | "low";
    reason: string;
  } | null = null;

  if (!isHelpCommand) {
    const raw = (_ctx.body ?? "").trim();
    const looksLikeQuestion =
      raw.includes("?") ||
      /^(what|how|can you|could you|tell me|explain|help)\b/i.test(raw);

    if (raw.length > 0 && looksLikeQuestion) {
      const systemPrompt = buildHelpIntentAnalyzerSystemPrompt();
      const res = await analyzeHelpIntent({
        systemPrompt,
        messages: [{ role: "user", content: raw }],
      });
      helpIntent = res.intent;

      logger.info("helpIntent", {
        intent: helpIntent.intent,
        confidence: helpIntent.confidence,
        reason: helpIntent.reason,
        rawText: res.rawText,
      });
    }
  }

  const shouldSendHelp =
    isHelpCommand ||
    (helpIntent?.intent && helpIntent.confidence !== "low") ||
    false;

  if (shouldSendHelp) {
    const sms = buildSchedulerHowItWorksSms({ activityName: activity.name });
    const sid = await sendSms(user.phone_number, sms);
    await prisma.conversationMessage.create({
      data: {
        conversation_id: _ctx.conversationId,
        role: "assistant",
        direction: "outbound",
        content: sms,
        twilio_sid: sid,
        attributes: { kind: "help" },
      },
    });
    return;
  }

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

  // If we're awaiting confirmation on a complete draft, treat this inbound SMS as a
  // confirm/edit decision.
  if (state.pendingEvent?.status === "awaiting_confirmation") {
    const systemPrompt = buildEventConfirmationAnalyzerSystemPrompt();
    const decision = await analyzeEventConfirmation({
      systemPrompt,
      messages: [
        { role: "assistant", content: state.pendingEvent.draft.previewSms },
        { role: "user", content: _ctx.body },
      ],
    });

    logger.info("eventConfirmation.decision", {
      decision: decision.decision,
      reason: decision.reason,
      rawText: decision.rawText,
    });

    if (decision.decision === "cancel") {
      const sms =
        "No problem. I scratched that draft. Text me anytime to start a new one.";
      const sid = await sendSms(user.phone_number, sms);
      await prisma.conversationMessage.create({
        data: {
          conversation_id: _ctx.conversationId,
          role: "assistant",
          direction: "outbound",
          content: sms,
          twilio_sid: sid,
          attributes: {
            kind: "event_confirmation_cancel",
          },
        },
      });

      // Clear any in-progress scheduling state.
      const nextState = {
        ...(state as unknown as Prisma.JsonObject),
      } as Prisma.JsonObject;

      delete (nextState as any).pendingEvent;
      delete (nextState as any).activeDraft;

      await prisma.conversation.update({
        where: { conversation_id: _ctx.conversationId },
        data: { state: nextState as unknown as Prisma.InputJsonValue },
      });

      return;
    }

    if (decision.decision === "confirm") {
      const d = state.pendingEvent.draft;

      // If we somehow reached confirmation without complete time details, ask to fix.
      // (Should be rare; kept defensive.)
      if (!d.startIso || !d.endIso) {
        const ask =
          "I’m missing the exact end time. What end time (or duration) should I use?";
        const sid = await sendSms(user.phone_number, ask);
        await prisma.conversationMessage.create({
          data: {
            conversation_id: _ctx.conversationId,
            role: "assistant",
            direction: "outbound",
            content: ask,
            twilio_sid: sid,
            attributes: {
              needs: "end_time",
              reason: "missing_end_time_on_confirm",
            },
          },
        });
        return;
      }

      const preferredMembersForPlan = homies.filter((m) =>
        d.preferredMemberIds.includes(m.member_id),
      );

      // Use locked invite plan from preview-time to prevent reshuffles.
      const immediateIds = d.immediateMemberIds ?? [];
      const followUpIds = d.followUpMemberIds ?? [];
      const immediateMembers = resolveMembersById({
        allMembers: homies,
        ids: immediateIds,
      });
      const followUpMembers = resolveMembersById({
        allMembers: homies,
        ids: followUpIds,
      });

      const createdEvent = await prisma.$transaction(async (tx) => {
        const event = await tx.event.create({
          data: {
            created_by_user_id: user.user_id,
            activity_id: d.activityId,
            location: d.location,
            invite_message: d.inviteMessage,
            max_participants: d.maxHomies,
            invite_policy: d.invitePolicy,
          },
        });

        await tx.timeSlot.create({
          data: {
            event_id: event.event_id,
            start_time: new Date(d.startIso),
            end_time: new Date(d.endIso),
            status: "suggested",
          },
        });

        // Persist EventMember rows per policy.
        // - Immediate invites are status=invited
        // - Follow-up pool is status=listed
        // - priority_rank is a 1-based ordering for ALL members based on the locked plan:
        //   inviting-now order first, then backup order.
        const orderedIds = uniqueById(
          [...(d.immediateMemberIds ?? []), ...(d.followUpMemberIds ?? [])]
            .filter(
              (id): id is string =>
                typeof id === "string" && id.trim().length > 0,
            )
            .map((id) => ({ member_id: id })),
        ).map((x) => x.member_id);

        const rankById = new Map(
          orderedIds.map((id, idx) => [id, idx + 1] as const),
        );

        const rows: {
          event_id: string;
          member_id: string;
          status: "listed" | "invited";
          priority_rank?: number;
        }[] = [];

        const immediateIdSet = new Set(
          immediateMembers.map((m) => m.member_id),
        );
        const followUpIdSet = new Set(followUpMembers.map((m) => m.member_id));

        // For exact, only persist preferred (immediate). For others, persist all homies.
        const pool =
          d.invitePolicy === "exact"
            ? preferredMembersForPlan
            : uniqueById(homies);

        // Defensive: if somehow the pool contains ids not in the locked plan ordering,
        // append them after the known ordered ids.
        let nextRank = orderedIds.length + 1;

        for (const m of pool) {
          const status: "listed" | "invited" = immediateIdSet.has(m.member_id)
            ? "invited"
            : followUpIdSet.has(m.member_id)
              ? "listed"
              : "listed";

          let rank = rankById.get(m.member_id);
          if (typeof rank !== "number") {
            rank = nextRank;
            rankById.set(m.member_id, rank);
            nextRank += 1;
          }

          rows.push({
            event_id: event.event_id,
            member_id: m.member_id,
            status,
            ...(typeof rank === "number" ? { priority_rank: rank } : {}),
          });
        }

        if (rows.length > 0) {
          await tx.eventMember.createMany({ data: rows });
        }

        return event;
      });

      const confirmation = buildLockedInInvitePlanSms({
        activityName: activity.name,
        location: d.location,
        start: new Date(d.startIso),
        end: new Date(d.endIso),
        timeZone: user.timezone,
        invitePolicy: d.invitePolicy,
        maxHomies: d.maxHomies,
        inviteMessage: d.inviteMessage,
        immediateNames:
          d.immediateNamesForSms ?? immediateMembers.map(fullNameForMember),
        followUpNames:
          d.followUpNamesForSms ?? followUpMembers.map(fullNameForMember),
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

      // Kick off coordination (invites, escalation timers, etc) in the background.
      setImmediate(async () => {
        try {
          await onEventCreated(createdEvent.event_id);
        } catch (err: any) {
          logger.error(
            `coordinator:onEventCreated failed: ${err?.message ?? err}`,
          );
        }
      });

      // After creating an event, compact conversation into durable memory + reset planning boundary.
      const updatedAtIso = new Date().toISOString();
      const nextMemorySummary = await summarizeConversationMemory({
        existingSummary: state.memorySummary ?? null,
        userFirstName: user.first_name,
        activityName: activity.name,
        allowedHomies: homieNames,
        // Use only the recent (post-boundary) messages, without the memory prelude.
        messages: recentMessages,
      });

      const nextState = {
        ...(state as unknown as Prisma.JsonObject),
      } as Prisma.JsonObject;

      nextState.lastCreatedEventId = createdEvent.event_id;
      nextState.lastEventCreatedAt = updatedAtIso;
      if (nextMemorySummary) {
        nextState.memorySummary = nextMemorySummary;
        nextState.memorySummaryUpdatedAt = updatedAtIso;
      }

      delete (nextState as any).pendingEvent;
      delete (nextState as any).createdEventId;
      delete (nextState as any).draftEvent;
      delete (nextState as any).activeDraft;

      await prisma.conversation.update({
        where: { conversation_id: _ctx.conversationId },
        data: { state: nextState as unknown as Prisma.InputJsonValue },
      });

      return;
    }

    if (decision.decision === "edit") {
      // Draft edit mode: keep pending draft and apply invite-plan edits deterministically.
      const d0 = state.pendingEvent.draft;

      // First: apply any *detail* edits (time/location/note) from the latest user message.
      const timePatchRes = await analyzeEventTimePatch({
        userTimezone: user.timezone,
        existingStartIso: d0.startIso,
        existingEndIso: d0.endIso,
        // Latest message is enough because we seed existingStart/end.
        messages: [{ role: "user", content: _ctx.body }],
      });

      const locRes = await analyzeConversationLocation(
        [{ role: "user", content: _ctx.body }],
        buildLocationAnalyzerSystemPrompt(),
      );

      const inviteMsgRes = await analyzeConversationInviteMessage(
        [{ role: "user", content: _ctx.body }],
        buildInviteMessageAnalyzerSystemPrompt(),
      );

      // Copy draft so we can mutate.
      const d = { ...d0 };

      // Location edit
      if (
        locRes.eventLocationProvided &&
        typeof locRes.eventLocation === "string" &&
        locRes.eventLocation.trim()
      ) {
        d.location = locRes.eventLocation.trim();
      }

      // Invite note edit
      if (inviteMsgRes.inviteMessageProvided) {
        d.inviteMessage = inviteMsgRes.inviteMessage;
      }

      // Time edit
      if (timePatchRes.ok) {
        const p = timePatchRes.patch;
        const startChanged =
          typeof p.startIso === "string" &&
          p.startIso.trim().length > 0 &&
          p.startIso !== d.startIso;

        if (p.startIso) d.startIso = p.startIso;

        if (p.endIso) {
          d.endIso = p.endIso;
        } else if (typeof p.durationMinutes === "number") {
          // Convert duration to end.
          const startDt = DateTime.fromISO(d.startIso, { setZone: true });
          if (startDt.isValid) {
            const endDt = startDt.plus({ minutes: p.durationMinutes });
            d.endIso =
              endDt.toISO({ suppressMilliseconds: true }) ??
              endDt.toISO() ??
              d.endIso;
          }
        } else if (startChanged) {
          // If user changed the start but didn't provide an updated end/duration,
          // move back to collecting mode so we can ask for the end.
          const updatedAtIso = new Date().toISOString();
          const nextState = {
            ...(state as unknown as Prisma.JsonObject),
          } as Prisma.JsonObject;

          nextState.activeDraft = {
            status: "collecting_details",
            activityId: d.activityId,
            location: d.location,
            startIso: d.startIso,
            // end intentionally omitted to force a follow-up.
            preferredNames: d.preferredNamesForSms,
            maxHomies: d.maxHomies,
            inviteMessage: d.inviteMessage,
            updatedAtIso,
          } as unknown as Prisma.JsonValue;

          delete (nextState as any).pendingEvent;

          const ask = "Got it. What end time should I use? (or how long?)";
          const sid = await sendSms(user.phone_number, ask);
          await prisma.conversationMessage.create({
            data: {
              conversation_id: _ctx.conversationId,
              role: "assistant",
              direction: "outbound",
              content: ask,
              twilio_sid: sid,
              attributes: {
                needs: "end_time",
                reason: "start_changed_requires_end",
              },
            },
          });

          await prisma.conversation.update({
            where: { conversation_id: _ctx.conversationId },
            data: { state: nextState as unknown as Prisma.InputJsonValue },
          });

          return;
        }
      }

      const immediateIds = d.immediateMemberIds ?? [];
      const followUpIds = d.followUpMemberIds ?? [];
      const excludedIds = d.excludedMemberIds ?? [];

      const immediateMembers = resolveMembersById({
        allMembers: homies,
        ids: immediateIds,
      });
      const followUpMembers = resolveMembersById({
        allMembers: homies,
        ids: followUpIds,
      });
      const excludedMembers = resolveMembersById({
        allMembers: homies,
        ids: excludedIds,
      });

      const systemPrompt = buildEventDraftEditAnalyzerSystemPrompt({
        allowedHomiesList: buildAllowedHomiesListForPrompt(homies),
        currentInvitingNow: immediateMembers.map(fullNameForMember),
        currentBackups: followUpMembers.map(fullNameForMember),
        currentExcluded: excludedMembers.map(fullNameForMember),
      });

      const { patch, rawText } = await analyzeEventDraftEdit({
        systemPrompt,
        messages: [
          { role: "assistant", content: d.previewSms },
          { role: "user", content: _ctx.body },
        ],
      });

      logger.info("eventDraftEdit.patch", { patch, rawText });

      const patched = applyInvitePlanPatch({
        maxHomies: d.maxHomies,
        allMembers: homies,
        plan: {
          immediateMemberIds: immediateIds,
          followUpMemberIds: followUpIds,
          excludedMemberIds: excludedIds,
        },
        patch,
        bumpLastImmediateOnAddWhenFull: true,
      });

      if (!patched.ok) {
        const ask =
          `${patched.reason}.\nReply with a homie name from your list.`.slice(
            0,
            300,
          );
        const sid = await sendSms(user.phone_number, ask);
        await prisma.conversationMessage.create({
          data: {
            conversation_id: _ctx.conversationId,
            role: "assistant",
            direction: "outbound",
            content: ask,
            twilio_sid: sid,
            attributes: {
              needs: "event_confirmation",
              reason: "draft_edit_failed",
            },
          },
        });
        return;
      }

      // Apply invite-policy edits during confirmation.
      // LLM-based so the user can say things like "hand picked", "no backups", etc.
      const policySystemPrompt = buildInvitePolicyIntentAnalyzerSystemPrompt();
      const { intent: policyIntent, rawText: policyRawText } =
        await analyzeInvitePolicyIntent({
          systemPrompt: policySystemPrompt,
          messages: [
            { role: "assistant", content: d.previewSms },
            { role: "user", content: _ctx.body ?? "" },
          ],
        });

      logger.info("invitePolicyIntent.confirmation", {
        intent: policyIntent,
        rawText: policyRawText,
      });

      const nextPolicy =
        policyIntent.policy && policyIntent.confidence !== "low"
          ? policyIntent.policy
          : null;

      if (nextPolicy && nextPolicy !== d.invitePolicy) {
        d.invitePolicy = nextPolicy;

        // If switching to an exact/handpicked policy, ensure the draft semantics match:
        // - exact means invite ONLY the explicit list (no backups)
        // - event creation uses preferredMemberIds as the pool when policy is exact
        if (nextPolicy === "exact") {
          d.preferredMemberIds = patched.plan.immediateMemberIds;
          d.preferredNamesForSms = patched.immediateNames;
          d.maxHomies = patched.plan.immediateMemberIds.length;
        }
      }

      // If we're now exact, force follow-ups empty (no backups).
      const finalImmediateIds = patched.plan.immediateMemberIds;
      const finalFollowUpIds =
        d.invitePolicy === "exact" ? [] : patched.plan.followUpMemberIds;
      const finalImmediateNames = patched.immediateNames;
      const finalFollowUpNames =
        d.invitePolicy === "exact" ? [] : patched.followUpNames;
      const finalExcludedIds = patched.plan.excludedMemberIds;
      const finalExcludedNames = patched.excludedNames;

      const previewWithEdits = buildEventDraftPreviewSms({
        activityName: activity.name,
        location: d.location,
        start: new Date(d.startIso),
        end: new Date(d.endIso),
        timeZone: user.timezone,
        preferredNames: d.preferredNamesForSms,
        maxHomies: d.maxHomies,
        inviteMessage: d.inviteMessage,
        invitePolicy: d.invitePolicy,
        immediateNames: finalImmediateNames,
        followUpNames: finalFollowUpNames,
        excludedNames: finalExcludedNames,
      });

      const sid = await sendSms(user.phone_number, previewWithEdits);
      await prisma.conversationMessage.create({
        data: {
          conversation_id: _ctx.conversationId,
          role: "assistant",
          direction: "outbound",
          content: previewWithEdits,
          twilio_sid: sid,
          attributes: {
            needs: "event_confirmation",
          },
        },
      });

      const updatedAtIso = new Date().toISOString();
      const nextState = {
        ...(state as unknown as Prisma.JsonObject),
      } as Prisma.JsonObject;

      nextState.pendingEvent = {
        status: "awaiting_confirmation",
        draft: {
          ...d,
          immediateMemberIds: finalImmediateIds,
          followUpMemberIds: finalFollowUpIds,
          excludedMemberIds: finalExcludedIds,
          immediateNamesForSms: finalImmediateNames,
          followUpNamesForSms: finalFollowUpNames,
          excludedNamesForSms: finalExcludedNames,
          previewSms: previewWithEdits,
          previewSentAtIso: updatedAtIso,
        },
      };

      await prisma.conversation.update({
        where: { conversation_id: _ctx.conversationId },
        data: { state: nextState as unknown as Prisma.InputJsonValue },
      });

      return;
    } else {
      const ask = "Should I lock this in, or what should I change?";
      const sid = await sendSms(user.phone_number, ask);
      await prisma.conversationMessage.create({
        data: {
          conversation_id: _ctx.conversationId,
          role: "assistant",
          direction: "outbound",
          content: ask,
          twilio_sid: sid,
          attributes: {
            needs: "event_confirmation",
          },
        },
      });
      return;
    }
  }

  // =========================
  // Collecting-details mode
  // =========================

  // If the user explicitly referenced a branded invite policy, use it to shape follow-up questions.
  const policyHint = await detectInvitePolicyHintFromMessages(messages);

  // Use only USER messages for analyzers.
  const userOnlyMessages = messages.filter((m) => m.role === "user");

  const locationAnalyzerSystemPrompt = buildLocationAnalyzerSystemPrompt();
  const homiesAnalyzerSystemPrompt = buildHomiesAnalyzerSystemPrompt({
    homiesList,
  });
  const inviteMessageAnalyzerSystemPrompt =
    buildInviteMessageAnalyzerSystemPrompt();

  const updatedAtIso = new Date().toISOString();

  const prevDraft0: ActiveEventDraft =
    state.activeDraft?.status === "collecting_details" &&
    state.activeDraft.activityId === activity.activity_id
      ? state.activeDraft
      : {
          status: "collecting_details",
          activityId: activity.activity_id,
          updatedAtIso,
        };

  // Work on a mutable copy so we can apply pending-choice decisions cleanly.
  const prevDraft: ActiveEventDraft = { ...prevDraft0 };

  // If we previously asked the user to choose between two invite policies,
  // treat this inbound SMS as answering that question.
  //
  // Without this, we can get stuck in a loop where each message re-triggers the
  // policy mismatch and re-asks the same "Quick check".
  const pendingChoice = prevDraft.pendingInvitePolicyChoice;
  if (pendingChoice) {
    const chosen = parseInvitePolicyChoiceFromUserText({
      text: _ctx.body ?? "",
      policyHint: pendingChoice.policyHint,
      inferredPolicy: pendingChoice.inferredPolicy,
    });

    if (!chosen) {
      const sms = `Quick check — reply with either: ${brandedInvitePolicyName(pendingChoice.policyHint)} or ${brandedInvitePolicyName(pendingChoice.inferredPolicy)}.`;
      const sid = await sendSms(user.phone_number, sms);
      await prisma.conversationMessage.create({
        data: {
          conversation_id: _ctx.conversationId,
          role: "assistant",
          direction: "outbound",
          content: sms,
          twilio_sid: sid,
          attributes: {
            needs: "invite_policy_confirmation",
            policyHint: pendingChoice.policyHint,
            inferredPolicy: pendingChoice.inferredPolicy,
            reason: "unrecognized_policy_choice",
          },
        },
      });

      // Persist state so we remain in confirmation mode.
      const nextState = {
        ...(state as unknown as Prisma.JsonObject),
        activeDraft: {
          ...(prevDraft as unknown as Prisma.JsonObject),
          updatedAtIso,
        } as unknown as Prisma.InputJsonValue,
      } as Prisma.JsonObject;

      await prisma.conversation.update({
        where: { conversation_id: _ctx.conversationId },
        data: { state: nextState as unknown as Prisma.InputJsonValue },
      });

      return;
    }

    // Apply user-chosen override and clear pending confirmation.
    prevDraft.invitePolicyOverride = chosen;
    delete prevDraft.pendingInvitePolicyChoice;
  }

  const isNewPlanningSession =
    !(state.activeDraft?.status === "collecting_details") ||
    state.activeDraft.activityId !== activity.activity_id;

  // Analyze conversation and merge into draft.
  const [loc, homiesRes, inviteMsgRes] = await Promise.all([
    analyzeConversationLocation(userOnlyMessages, locationAnalyzerSystemPrompt),
    analyzeConversationHomies(
      userOnlyMessages,
      homiesAnalyzerSystemPrompt,
      homieNames,
    ),
    analyzeConversationInviteMessage(
      userOnlyMessages,
      inviteMessageAnalyzerSystemPrompt,
    ),
  ]);

  // Time patch: latest message (with existing draft start/end seeded).
  // Time extraction strategy:
  // 1) Try deterministic parsing for common SMS patterns (e.g. "10p", "11pm", "for 90 minutes").
  // 2) Fall back to the LLM-based patch analyzer.
  const nowInUserTz = DateTime.now().setZone(user.timezone);
  const bodyText = _ctx.body ?? "";
  const dayOffset = detectExplicitDayOffset(bodyText);
  const dur = parseDurationMinutes(bodyText);
  const rangeTod = parseTimeRangeOfDay(bodyText);
  const tod = parseSimpleTimeOfDay(bodyText);
  const { isStart: mentionsStart, isEnd: mentionsEnd } =
    textMentionsStartOrEnd(bodyText);

  const expectingEnd = Boolean(prevDraft.startIso) && !prevDraft.endIso;
  const expectingStart = !prevDraft.startIso;

  let timePatchRes:
    | {
        ok: true;
        patch: { startIso?: string; endIso?: string; durationMinutes?: number };
      }
    | { ok: false; reason: string } = { ok: false, reason: "no_time_patch" };

  if (Number.isFinite(dur as any) && typeof dur === "number") {
    timePatchRes = { ok: true, patch: { durationMinutes: dur } };
  } else if (rangeTod && nowInUserTz.isValid) {
    // Parse full time ranges like "from 1pm to 3pm tomorrow".
    // If an explicit day anchor is provided, honor it for the start.
    // Otherwise anchor the start relative to now, then anchor the end to the same day as the start.

    const startAnchored =
      typeof dayOffset === "number"
        ? anchorTimeOfDayToExplicitDayOffset({
            userTimezone: user.timezone,
            now: nowInUserTz,
            tod: rangeTod.start,
            dayOffset,
          })
        : anchorTimeOfDayToNow({
            userTimezone: user.timezone,
            now: nowInUserTz,
            tod: rangeTod.start,
          });

    let endAnchored = anchorTimeOfDayToReferenceDay({
      reference: startAnchored,
      tod: rangeTod.end,
    });

    // Overnight support: if end <= start, bump end to the next day.
    if (endAnchored <= startAnchored) {
      endAnchored = endAnchored.plus({ days: 1 });
    }

    timePatchRes = {
      ok: true,
      patch: {
        startIso:
          startAnchored.toISO({ suppressMilliseconds: true }) ??
          startAnchored.toISO() ??
          "",
        endIso:
          endAnchored.toISO({ suppressMilliseconds: true }) ??
          endAnchored.toISO() ??
          "",
      },
    };
  } else if (tod && nowInUserTz.isValid) {
    // Heuristic assignment:
    // - If the user explicitly mentions end/until OR we are expecting an end, treat as end.
    // - Else treat as start.
    const treatAsEnd = mentionsEnd || (expectingEnd && !mentionsStart);
    const treatAsStart = mentionsStart || (!treatAsEnd && expectingStart);

    // Anchor strategy:
    // - If user explicitly said "tomorrow"/"today", honor that.
    // - If we are treating this as an END time and we already have a start date, anchor to start's date.
    // - Else anchor relative to now.
    let anchored: DateTime;
    if (typeof dayOffset === "number") {
      anchored = anchorTimeOfDayToExplicitDayOffset({
        userTimezone: user.timezone,
        now: nowInUserTz,
        tod,
        dayOffset,
      });
    } else if (treatAsEnd && prevDraft.startIso) {
      const startRef = DateTime.fromISO(prevDraft.startIso, { setZone: true });
      anchored = startRef.isValid
        ? anchorTimeOfDayToReferenceDay({ reference: startRef, tod })
        : anchorTimeOfDayToNow({
            userTimezone: user.timezone,
            now: nowInUserTz,
            tod,
          });

      // Overnight support: if end <= start, bump end to next day.
      if (startRef.isValid && anchored <= startRef) {
        anchored = anchored.plus({ days: 1 });
      }
    } else {
      anchored = anchorTimeOfDayToNow({
        userTimezone: user.timezone,
        now: nowInUserTz,
        tod,
      });
    }

    const iso =
      anchored.toISO({ suppressMilliseconds: true }) ?? anchored.toISO() ?? "";

    if (treatAsEnd) {
      timePatchRes = { ok: true, patch: { endIso: iso } };
    } else if (treatAsStart) {
      timePatchRes = { ok: true, patch: { startIso: iso } };
    } else {
      // If both or neither, default to start.
      timePatchRes = { ok: true, patch: { startIso: iso } };
    }
  } else {
    const llmRes = await analyzeEventTimePatch({
      userTimezone: user.timezone,
      existingStartIso: prevDraft.startIso,
      existingEndIso: prevDraft.endIso,
      messages: [{ role: "user", content: bodyText }],
    });
    timePatchRes = llmRes.ok
      ? { ok: true, patch: llmRes.patch }
      : { ok: false, reason: llmRes.reason };
  }

  const nextDraft: ActiveEventDraft = {
    ...prevDraft,
    updatedAtIso,
  };

  if (
    loc.eventLocationProvided &&
    typeof loc.eventLocation === "string" &&
    loc.eventLocation.trim()
  ) {
    nextDraft.location = loc.eventLocation.trim();
  }

  if (inviteMsgRes.inviteMessageProvided) {
    nextDraft.inviteMessage = inviteMsgRes.inviteMessage;
  }

  if (homiesRes.homiesProvided) {
    if (Array.isArray(homiesRes.homies) && homiesRes.homies.length > 0) {
      nextDraft.preferredNames = homiesRes.homies;
    }
    if (
      typeof homiesRes.maxHomies === "number" &&
      Number.isFinite(homiesRes.maxHomies)
    ) {
      nextDraft.maxHomies = Math.trunc(homiesRes.maxHomies);
    }
  }

  if (timePatchRes.ok) {
    const p = timePatchRes.patch;
    const startChanged =
      typeof p.startIso === "string" &&
      p.startIso.trim().length > 0 &&
      p.startIso !== nextDraft.startIso;

    if (p.startIso) nextDraft.startIso = p.startIso;
    if (p.endIso) nextDraft.endIso = p.endIso;
    if (typeof p.durationMinutes === "number")
      nextDraft.durationMinutes = p.durationMinutes;

    // If the user changed the start without giving an updated end/duration, invalidate end so we can ask.
    if (startChanged && !p.endIso && typeof p.durationMinutes !== "number") {
      nextDraft.endIso = undefined;
      nextDraft.durationMinutes = undefined;
    }
  }

  // Guardrail / feature: support overnight events.
  // If end is not after start, bump end to the next day.
  if (nextDraft.startIso && nextDraft.endIso) {
    const s = DateTime.fromISO(nextDraft.startIso, { setZone: true });
    const e = DateTime.fromISO(nextDraft.endIso, { setZone: true });
    if (s.isValid && e.isValid && e <= s) {
      const bumped = e.plus({ days: 1 });
      nextDraft.endIso =
        bumped.toISO({ suppressMilliseconds: true }) ??
        bumped.toISO() ??
        nextDraft.endIso;
    }
  }

  logger.info("activeDraft", {
    location: nextDraft.location,
    startIso: nextDraft.startIso,
    endIso: nextDraft.endIso,
    durationMinutes: nextDraft.durationMinutes,
    maxHomies: nextDraft.maxHomies,
    preferredNamesCount: nextDraft.preferredNames?.length ?? 0,
  });

  // Decide next action based on missing fields.
  const hasLocation = Boolean(
    nextDraft.location && nextDraft.location.trim().length > 0,
  );
  const hasStart = Boolean(
    nextDraft.startIso && nextDraft.startIso.trim().length > 0,
  );
  const hasEnd = Boolean(
    nextDraft.endIso && nextDraft.endIso.trim().length > 0,
  );
  const hasDuration =
    typeof nextDraft.durationMinutes === "number" &&
    nextDraft.durationMinutes > 0;

  const hasPreferred =
    Array.isArray(nextDraft.preferredNames) &&
    nextDraft.preferredNames.length > 0;
  const hasMax =
    typeof nextDraft.maxHomies === "number" &&
    Number.isFinite(nextDraft.maxHomies) &&
    nextDraft.maxHomies > 0;
  const homiesProvided = hasPreferred || hasMax;

  // Ask for all missing details at once (less choppy).
  const missing: Array<{ key: string; prompt: string }> = [];
  if (!hasLocation)
    missing.push({ key: "location", prompt: "Where should it be?" });
  if (!hasStart) {
    // If we don't yet have a start time, ask for the full range up-front.
    // (This reads better and reduces back-and-forth.)
    missing.push({
      key: "event_time",
      prompt: "What start & end time should I use?",
    });
  }
  if (hasStart && !hasEnd && !hasDuration) {
    missing.push({
      key: "end_time",
      prompt: "What end time should I use? (or how long?)",
    });
  }

  if (!homiesProvided) {
    if (policyHint === "exact") {
      missing.push({
        key: "homie_names",
        prompt:
          "Handpicked Invite — who should I invite? Reply with the homies’ names.",
      });
    } else {
      missing.push({
        key: "max_homies",
        prompt: "How many homies should I invite?",
      });
    }
  } else if (policyHint === "prioritized" && hasPreferred && !hasMax) {
    missing.push({
      key: "max_homies",
      prompt: `Priority Invite — what’s the total number of homies I should invite? (Including ${nextDraft.preferredNames!.length} you named)`,
    });
  }

  // Keep this SMS-friendly and scannable.
  const ask = missing.length
    ? missing.map((m) => `- ${m.prompt}`).join("\n")
    : null;
  const askNeeds = missing.length ? missing.map((m) => m.key).join(",") : null;

  // Persist draft state no matter what.
  const draftStateUpdate = {
    ...(state as unknown as Prisma.JsonObject),
    activeDraft: nextDraft as unknown as Prisma.InputJsonValue,
  } as Prisma.JsonObject;

  if (ask) {
    // Make the first scheduling message feel more natural + remind the user of their activity.
    const activityName = (activity.name ?? "").trim() || "your activity";
    const normalizeQuick = (t: string): string =>
      (t ?? "")
        .toLowerCase()
        .trim()
        .replace(/[^a-z0-9\s]/g, "")
        .replace(/\s+/g, " ");

    const t = normalizeQuick(_ctx.body ?? "");
    const isGreeting =
      t === "hi" ||
      t === "hello" ||
      t === "hey" ||
      t === "hi there" ||
      t === "hello there" ||
      t === "hey there";

    const firstName = (user.first_name ?? "").trim();
    const heyLine = firstName.length ? `Hey ${firstName}!` : "Hey!";

    const header = isNewPlanningSession
      ? isGreeting
        ? `${heyLine} Want to schedule your ${activityName}?`
        : `Let’s schedule your ${activityName}.`
      : `For ${activityName}, I still need:`;

    const hint = "Ask “how do invites work?” if you want to see invite options.";

    const askWithContext = [header, ask, "", hint].join("\n").trim();

    const sid = await sendSms(user.phone_number, askWithContext);
    await prisma.conversationMessage.create({
      data: {
        conversation_id: _ctx.conversationId,
        role: "assistant",
        direction: "outbound",
        content: askWithContext,
        twilio_sid: sid,
        attributes: {
          ...(askNeeds ? { needs: askNeeds } : {}),
          ...(policyHint ? { policyHint } : {}),
          ...(isNewPlanningSession ? { planningSession: "started" } : {}),
        },
      },
    });

    await prisma.conversation.update({
      where: { conversation_id: _ctx.conversationId },
      data: { state: draftStateUpdate as unknown as Prisma.InputJsonValue },
    });

    return;
  }

  // If we get here, we have enough information to generate a preview.
  // Compute start/end.
  const startIso = nextDraft.startIso!;
  let endIso = nextDraft.endIso;

  if (!endIso && hasDuration) {
    const startDt = DateTime.fromISO(startIso, { setZone: true });
    if (startDt.isValid) {
      const endDt = startDt.plus({ minutes: nextDraft.durationMinutes! });
      endIso =
        endDt.toISO({ suppressMilliseconds: true }) ??
        endDt.toISO() ??
        undefined;
    }
  }

  if (!endIso) {
    // Should be unreachable due to gating above, but keep defensive.
    const fallbackAsk = "What end time should I use? (or how long?)";
    const sid = await sendSms(user.phone_number, fallbackAsk);
    await prisma.conversationMessage.create({
      data: {
        conversation_id: _ctx.conversationId,
        role: "assistant",
        direction: "outbound",
        content: fallbackAsk,
        twilio_sid: sid,
        attributes: {
          needs: "end_time",
          reason: "end_time_missing_after_gate",
        },
      },
    });
    await prisma.conversation.update({
      where: { conversation_id: _ctx.conversationId },
      data: { state: draftStateUpdate as unknown as Prisma.InputJsonValue },
    });
    return;
  }

  // max_participants is homies-only (does NOT include the user)
  const preferredNames = nextDraft.preferredNames ?? [];
  let maxHomies = computeMaxParticipantsTotal(
    nextDraft.maxHomies ?? null,
    preferredNames.length ? preferredNames : null,
  );

  if (maxHomies === null) {
    // Should be unreachable due to gating, but keep defensive.
    const sid = await sendSms(
      user.phone_number,
      "How many homies should I invite?",
    );
    await prisma.conversationMessage.create({
      data: {
        conversation_id: _ctx.conversationId,
        role: "assistant",
        direction: "outbound",
        content: "How many homies should I invite?",
        twilio_sid: sid,
        attributes: { needs: "max_homies" },
      },
    });
    await prisma.conversation.update({
      where: { conversation_id: _ctx.conversationId },
      data: { state: draftStateUpdate as unknown as Prisma.InputJsonValue },
    });
    return;
  }

  maxHomies = Math.trunc(maxHomies);
  if (!Number.isFinite(maxHomies) || maxHomies < 1) {
    const sid = await sendSms(
      user.phone_number,
      "How many homies should I invite? (number >= 1)",
    );
    await prisma.conversationMessage.create({
      data: {
        conversation_id: _ctx.conversationId,
        role: "assistant",
        direction: "outbound",
        content: "How many homies should I invite? (number >= 1)",
        twilio_sid: sid,
        attributes: { needs: "max_homies" },
      },
    });
    await prisma.conversation.update({
      where: { conversation_id: _ctx.conversationId },
      data: { state: draftStateUpdate as unknown as Prisma.InputJsonValue },
    });
    return;
  }

  // If we have fewer onboarded homies than needed, cap to what's available.
  if (maxHomies > homies.length) {
    logger.info(
      "Capping max_participants because not enough homies onboarded",
      {
        requestedMaxHomies: maxHomies,
        availableHomies: homies.length,
      },
    );
    maxHomies = homies.length;
  }

  if (preferredNames.length > maxHomies) {
    // Normally we treat listing more names than capacity as an error.
    // BUT for Priority Invite, the user can name a priority list larger than n.
    if (policyHint !== "prioritized") {
      const askTooMany = `You listed ${preferredNames.length} homies, but you asked me to invite only ${maxHomies}. Who should I include?`;
      const sid = await sendSms(user.phone_number, askTooMany);
      await prisma.conversationMessage.create({
        data: {
          conversation_id: _ctx.conversationId,
          role: "assistant",
          direction: "outbound",
          content: askTooMany,
          twilio_sid: sid,
          attributes: { needs: "homie_names", preferredNames, maxHomies },
        },
      });
      await prisma.conversation.update({
        where: { conversation_id: _ctx.conversationId },
        data: { state: draftStateUpdate as unknown as Prisma.InputJsonValue },
      });
      return;
    }
  }

  // Resolve preferred names -> members (explicit list only).
  // For Priority Invite, the user may list more preferred homies than capacity.
  // We still need to resolve those names to Members, so allow the resolution step to exceed n.
  const maxHomiesForPreferredResolution =
    policyHint === "prioritized"
      ? Math.max(maxHomies, preferredNames.length)
      : maxHomies;

  const explicitResolution = resolveExplicitHomiesForEvent({
    allMembers: homies,
    preferredNames,
    maxHomies: maxHomiesForPreferredResolution,
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
    await prisma.conversation.update({
      where: { conversation_id: _ctx.conversationId },
      data: { state: draftStateUpdate as unknown as Prisma.InputJsonValue },
    });
    return;
  }

  const preferredMembers = explicitResolution.preferredMembers;
  const preferredNamesForSms = preferredMembers.map(fullNameForMember);

  const inferredPolicy = deriveInvitePolicy({
    preferredCount: preferredMembers.length,
    maxHomies,
  });

  const invitePolicy = nextDraft.invitePolicyOverride ?? inferredPolicy;

  // If user explicitly asked for a branded policy that conflicts with the inferred one,
  // ask once and persist that we're awaiting their choice.
  if (policyHint && policyHint !== inferredPolicy && !nextDraft.invitePolicyOverride) {
    const askPolicy = `Quick check: do you want ${brandedInvitePolicyName(policyHint)}, or ${brandedInvitePolicyName(inferredPolicy)}?`;
    const sid = await sendSms(user.phone_number, askPolicy);
    await prisma.conversationMessage.create({
      data: {
        conversation_id: _ctx.conversationId,
        role: "assistant",
        direction: "outbound",
        content: askPolicy,
        twilio_sid: sid,
        attributes: {
          needs: "invite_policy_confirmation",
          policyHint,
          inferredPolicy,
          maxHomies,
          preferredNames: preferredNamesForSms,
        },
      },
    });

    // Persist pending confirmation state so the next inbound message is interpreted
    // as a policy choice (and we don't re-ask forever).
    const nextDraftWithPending: ActiveEventDraft = {
      ...nextDraft,
      pendingInvitePolicyChoice: {
        policyHint,
        inferredPolicy,
        askedAtIso: updatedAtIso,
      },
    };

    const nextState = {
      ...(state as unknown as Prisma.JsonObject),
      activeDraft: nextDraftWithPending as unknown as Prisma.InputJsonValue,
    } as Prisma.JsonObject;

    await prisma.conversation.update({
      where: { conversation_id: _ctx.conversationId },
      data: { state: nextState as unknown as Prisma.InputJsonValue },
    });
    return;
  }

  // Defensive: exact-list must match capacity.
  if (invitePolicy === "exact" && preferredMembers.length !== maxHomies) {
    const askExact = `Just to confirm: do you want to invite exactly ${preferredMembers.length} homies, or invite ${maxHomies}?`;
    const sid = await sendSms(user.phone_number, askExact);
    await prisma.conversationMessage.create({
      data: {
        conversation_id: _ctx.conversationId,
        role: "assistant",
        direction: "outbound",
        content: askExact,
        twilio_sid: sid,
        attributes: { preferredNames: preferredNamesForSms, maxHomies },
      },
    });
    await prisma.conversation.update({
      where: { conversation_id: _ctx.conversationId },
      data: { state: draftStateUpdate as unknown as Prisma.InputJsonValue },
    });
    return;
  }

  // Validate start/end.
  const startDt = DateTime.fromISO(startIso, { setZone: true });
  const endDt = DateTime.fromISO(endIso, { setZone: true });
  if (!startDt.isValid || !endDt.isValid) {
    const askTime =
      "I couldn’t confirm the time. What exact start + end time should I use?";
    const sid = await sendSms(user.phone_number, askTime);
    await prisma.conversationMessage.create({
      data: {
        conversation_id: _ctx.conversationId,
        role: "assistant",
        direction: "outbound",
        content: askTime,
        twilio_sid: sid,
        attributes: { needs: "event_time", reason: "invalid_iso_in_draft" },
      },
    });
    await prisma.conversation.update({
      where: { conversation_id: _ctx.conversationId },
      data: { state: draftStateUpdate as unknown as Prisma.InputJsonValue },
    });
    return;
  }

  // Lock the invite plan at preview-time so names don't reshuffle at confirmation.
  const plan = buildInvitePlan({
    invitePolicy,
    maxHomies,
    allMembers: homies,
    preferredMembers,
  });

  const previewWithPlan = buildEventDraftPreviewSms({
    activityName: activity.name,
    location: nextDraft.location!,
    start: startDt.toJSDate(),
    end: endDt.toJSDate(),
    timeZone: user.timezone,
    preferredNames: preferredNamesForSms,
    maxHomies,
    inviteMessage: nextDraft.inviteMessage,
    invitePolicy,
    immediateNames: plan.immediate.map(fullNameForMember),
    followUpNames: plan.followUp.map(fullNameForMember),
  });

  const sid = await sendSms(user.phone_number, previewWithPlan);
  await prisma.conversationMessage.create({
    data: {
      conversation_id: _ctx.conversationId,
      role: "assistant",
      direction: "outbound",
      content: previewWithPlan,
      twilio_sid: sid,
      attributes: { needs: "event_confirmation" },
    },
  });

  const nextState = {
    ...(state as unknown as Prisma.JsonObject),
  } as Prisma.JsonObject;

  nextState.pendingEvent = {
    status: "awaiting_confirmation",
    draft: {
      activityId: activity.activity_id,
      location: nextDraft.location!,
      startIso,
      endIso,
      maxHomies,
      invitePolicy,
      preferredMemberIds: preferredMembers.map((m) => m.member_id),
      preferredNamesForSms,
      immediateMemberIds: plan.immediate.map((m) => m.member_id),
      followUpMemberIds: plan.followUp.map((m) => m.member_id),
      immediateNamesForSms: plan.immediate.map(fullNameForMember),
      followUpNamesForSms: plan.followUp.map(fullNameForMember),
      excludedMemberIds: [],
      excludedNamesForSms: [],
      inviteMessage: nextDraft.inviteMessage,
      previewSms: previewWithPlan,
      previewSentAtIso: updatedAtIso,
    },
  };

  delete (nextState as any).activeDraft;

  await prisma.conversation.update({
    where: { conversation_id: _ctx.conversationId },
    data: { state: nextState as unknown as Prisma.InputJsonValue },
  });

  return;
}
