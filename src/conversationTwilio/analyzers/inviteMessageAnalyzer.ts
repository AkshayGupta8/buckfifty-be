import { chat, type ChatMessage } from "../../utils/openAiClient";
import logger from "../../utils/logger";
import { isNonEmptyString, parseJsonFromLLMText } from "../llm/llmJson";
import { logLlmInput, logLlmOutput } from "../llm/llmLogging";

export function buildInviteMessageAnalyzerSystemPrompt(): string {
  return `You are an assistant that extracts an "invite note" (aka flair) to be shared with invited members.

You MUST respond only in this JSON format:
{
  "inviteMessage": string|null
}

Definition:
- inviteMessage is a short free-text instruction meant for the group.
- Examples: "Wear black", "Bring water", "Meet by the north entrance", "BYOB".

Rules:
- Only extract if the user explicitly requests a note/instruction for invitees.
- Do NOT include location, dates, times, or the activity name if it is already obvious.
- Keep it short (max ~180 characters).
- If no invite note is provided, return null.
- Do not invent details.`;
}

export async function analyzeConversationInviteMessage(
  messages: ChatMessage[],
  systemPrompt: string
): Promise<{
  inviteMessageProvided: boolean;
  inviteMessage: string | null;
  rawText: string;
}> {
  const model = process.env.OPENAI_MODEL ?? "gpt-4o-mini";

  try {
    logLlmInput({
      tag: "analyzeConversationInviteMessage",
      model,
      temperature: 0.0,
      system: systemPrompt,
      messages,
    });

    const { text } = await chat({
      system: systemPrompt,
      messages,
      model,
      temperature: 0.0,
    });

    const raw = (text ?? "").trim();
    logLlmOutput({ tag: "analyzeConversationInviteMessage", text: raw });

    const parsed = parseJsonFromLLMText(raw);

    const inviteMessage = isNonEmptyString(parsed.inviteMessage)
      ? parsed.inviteMessage.trim()
      : null;

    // Keep it SMS-safe and bounded.
    const normalized = inviteMessage ? inviteMessage.replace(/\s+/g, " ").slice(0, 180) : null;

    return {
      inviteMessageProvided: Boolean(normalized),
      inviteMessage: normalized,
      rawText: raw,
    };
  } catch (err: any) {
    logger.warn(`analyzeConversationInviteMessage error: ${err?.message ?? err}`);
    return {
      inviteMessageProvided: false,
      inviteMessage: null,
      rawText: String(err?.message ?? err),
    };
  }
}
