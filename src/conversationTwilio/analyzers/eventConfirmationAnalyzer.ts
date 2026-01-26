import { chat, type ChatMessage } from "../../utils/openAiClient";
import logger from "../../utils/logger";
import { parseJsonFromLLMText } from "../llm/llmJson";

export type EventConfirmationDecision = "confirm" | "edit" | "cancel" | "unknown";

export function buildEventConfirmationAnalyzerSystemPrompt(): string {
  return `You are an assistant that determines whether the user is confirming a draft event, or requesting changes.

Return ONLY JSON:
{ "decision": "confirm"|"edit"|"cancel"|"unknown", "reason": "short reason" }

How to decide:
- "confirm" when the user expresses approval with no requested changes.
  Examples: "looks good", "perfect", "sounds right", "do it", "book it", "send it", "go ahead".

- "cancel" when the user wants to abandon this scheduling flow / discard the draft.
  Examples: "scratch", "scratch that", "scrap that", "nevermind", "never mind", "nvm", "forget it".

- "edit" when the user is NOT confirming OR they request any change.
  Examples:
  - direct edits: "make it 8", "actually at the park", "invite Jake too", "remove Sara", "change the note"
  - rejection / stop: "no", "not that", "wait", "hold up", "change it"

- "unknown" if it is ambiguous (e.g. they ask a question without confirming or changing).

Output rules:
- reason must be <= 120 characters.
- Do not include extra keys or any text outside the JSON object.`;
}

export async function analyzeEventConfirmation(args: {
  messages: ChatMessage[];
  systemPrompt: string;
}): Promise<{ decision: EventConfirmationDecision; reason: string; rawText: string }> {
  const model = process.env.OPENAI_MODEL ?? "gpt-4o-mini";

  try {
    const { text } = await chat({
      tag: "analyzeEventConfirmation",
      system: args.systemPrompt,
      messages: args.messages,
      model,
      temperature: 0.0,
    });

    const raw = (text ?? "").trim();
    const parsed = parseJsonFromLLMText(raw);

    const decisionRaw = typeof parsed.decision === "string" ? parsed.decision : "unknown";
    const decision: EventConfirmationDecision =
      decisionRaw === "confirm" || decisionRaw === "edit" || decisionRaw === "cancel"
        ? decisionRaw
        : "unknown";

    const reason = typeof parsed.reason === "string" ? parsed.reason.trim() : "";

    return { decision, reason: reason.slice(0, 180), rawText: raw };
  } catch (err: any) {
    logger.warn(`analyzeEventConfirmation error: ${err?.message ?? err}`);
    return {
      decision: "unknown",
      reason: "analyzer_error",
      rawText: String(err?.message ?? err),
    };
  }
}

