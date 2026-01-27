import { chat, type ChatMessage } from "../../utils/openAiClient";
import logger from "../../utils/logger";
import { parseJsonFromLLMText } from "../llm/llmJson";

export type HelpIntent = {
  /** Null means: user did not ask for help / guide content. */
  intent: "invite_guide" | "scheduler_help" | null;
  /** Used as a guardrail: treat low-confidence as "no intent". */
  confidence: "high" | "medium" | "low";
  reason: string;
};

export function buildHelpIntentAnalyzerSystemPrompt(): string {
  return `You are an assistant that detects whether an inbound SMS is asking for "guide" / "how it works" help.

Return ONLY JSON in this schema:
{ "intent": "invite_guide"|"scheduler_help"|null, "confidence": "high"|"medium"|"low", "reason": "short" }

Intents:
- invite_guide: user is asking about invites/inviting: invite types, invite options, invite policies, how invites work.
  Examples:
  - "Can you tell me about the different types of invites?"
  - "What invite options do I have?"
  - "How do invites work?"
  - "What are invite policies?"

- scheduler_help: user is asking what BuckFifty does / how scheduling works.
  Examples:
  - "How does this work?"
  - "What can you do?"
  - "Help me understand"

Output null when:
- The user is actively providing scheduling details (time/location/homies), not asking for an explanation.
  Examples that MUST be null:
  - "tomorrow at 7"
  - "at wash park"
  - "invite jake and sara"
  - "invite 3"
  - "move it to 8pm"

Confidence:
- high: direct questions about invites/help/how-it-works.
- medium: implied request for explanation.
- low: weak/ambiguous.

Output rules:
- reason must be <= 120 characters.
- Do not include any extra keys or any text outside the JSON object.`;
}

function normalizeIntent(raw: any): HelpIntent {
  const i = raw?.intent;
  const intent: HelpIntent["intent"] =
    i === "invite_guide" || i === "scheduler_help" ? i : null;

  const c = raw?.confidence;
  const confidence: HelpIntent["confidence"] =
    c === "high" || c === "medium" || c === "low" ? c : "low";

  const reason =
    typeof raw?.reason === "string" ? raw.reason.trim().slice(0, 120) : "";

  return { intent, confidence, reason };
}

export async function analyzeHelpIntent(args: {
  messages: ChatMessage[];
  systemPrompt: string;
}): Promise<{ intent: HelpIntent; rawText: string }> {
  const model = process.env.OPENAI_MODEL ?? "gpt-4o-mini";

  try {
    const { text } = await chat({
      tag: "analyzeHelpIntent",
      system: args.systemPrompt,
      messages: args.messages,
      model,
      temperature: 0.0,
    });

    const raw = (text ?? "").trim();
    const parsed = parseJsonFromLLMText(raw);
    const intent = normalizeIntent(parsed);
    return { intent, rawText: raw };
  } catch (err: any) {
    logger.warn(`analyzeHelpIntent error: ${err?.message ?? err}`);
    return {
      intent: { intent: null, confidence: "low", reason: "analyzer_error" },
      rawText: String(err?.message ?? err),
    };
  }
}
