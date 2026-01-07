import { chat, type ChatMessage } from "../../utils/openAiClient";
import logger from "../../utils/logger";
import { parseJsonFromLLMText } from "../llm/llmJson";

export function buildLocationAnalyzerSystemPrompt(): string {
  return `You are an assistant that checks if the user provided the event location in the conversation.

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
}

export async function analyzeConversationLocation(
  messages: ChatMessage[],
  systemPrompt: string
): Promise<{
  eventLocationProvided: boolean;
  eventLocation: string | null;
  rawText: string;
}> {
  const model = process.env.OPENAI_MODEL ?? "gpt-4o-mini";

  try {
    const { text } = await chat({
      tag: "analyzeConversationLocation",
      system: systemPrompt,
      messages,
      model,
      temperature: 0.0,
    });

    const raw = (text ?? "").trim();

    const parsed = parseJsonFromLLMText(raw);

    const provided = Boolean(parsed.eventLocationProvided);
    const eventLocation = typeof parsed.eventLocation === "string" ? parsed.eventLocation : null;

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
