import { chat, type ChatMessage } from "../../utils/openAiClient";
import logger from "../../utils/logger";
import type { EventMemberStatus } from "@prisma/client";

function formatWhenForSms(args: {
  start: Date;
  end: Date;
  timeZone: string;
}): string {
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

  const dayStart = dayFmt.format(args.start);
  const dayEnd = dayFmt.format(args.end);

  if (dayStart === dayEnd) {
    return `${dayStart} ${timeFmt.format(args.start)} - ${timeFmt.format(args.end)}`;
  }

  return `${dayStart} ${timeFmt.format(args.start)} - ${dayEnd} ${timeFmt.format(args.end)}`;
}

export function buildMemberEventQuestionSystemPrompt(args: {
  creatorFirstName: string;
  activityName: string | null;
  location: string | null;
  inviteMessage: string | null;
  start: Date;
  end: Date;
  timeZone: string;
  memberStatus: EventMemberStatus;
}): string {
  const what = (args.activityName ?? "hang").trim() || "hang";
  const where = (args.location ?? "").trim() || "(location TBD)";
  const note = (args.inviteMessage ?? "").trim();
  const noteLine = note.length ? `Note: ${note}` : "(no note)";
  const when = formatWhenForSms({
    start: args.start,
    end: args.end,
    timeZone: args.timeZone,
  });

  const statusLine = `EventMember status: ${args.memberStatus}`;

  return `You are BuckFifty, an SMS-based assistant. You are texting with an invited homie.

Event context (authoritative):
- Creator: ${args.creatorFirstName}
- What: ${what}
- When: ${when}
- Where: ${where}
- ${noteLine}
- ${statusLine}

Your job:
- Answer the homie's questions about the event OR what BuckFifty is.
- Be concise and SMS-friendly (<= 320 chars), no emojis, no markdown.
- Do NOT invent details. If you don't know, say so.

Decision prompt:
- If status is invited, end with a gentle question: "Can you make it?"
- If status is accepted, do NOT ask them to RSVP again; you can ask logistics questions instead.
- If status is declined, do NOT pressure; you can still answer questions politely.
`;
}

export async function answerMemberEventQuestion(args: {
  systemPrompt: string;
  messages: ChatMessage[];
}): Promise<{ answer: string; rawText: string }> {
  const model = process.env.OPENAI_MODEL ?? "gpt-4o-mini";

  try {
    const { text } = await chat({
      tag: "memberEventQuestion",
      system: args.systemPrompt,
      messages: args.messages,
      model,
      temperature: 0.2,
      max_tokens: 220,
    });

    const raw = (text ?? "").trim();
    // Keep it SMS-safe.
    const answer = raw.replace(/\s+/g, " ").trim().slice(0, 600);
    return { answer, rawText: raw };
  } catch (err: any) {
    logger.warn(`answerMemberEventQuestion error: ${err?.message ?? err}`);
    return {
      answer: "",
      rawText: String(err?.message ?? err),
    };
  }
}
