import { chat, type ChatMessage } from "../../utils/openAiClient";
import logger from "../../utils/logger";
import { parseJsonFromLLMText } from "../llm/llmJson";

export async function summarizeConversationMemory(args: {
  existingSummary: string | null;
  userFirstName: string;
  activityName: string;
  allowedHomies: string[];
  /** Recent chat history (oldest-first). */
  messages: ChatMessage[];
}): Promise<string | null> {
  const model = process.env.OPENAI_MODEL ?? "gpt-4o-mini";

  const homiesList = args.allowedHomies.length
    ? args.allowedHomies.map((h) => `- ${h}`).join("\n")
    : "(no homies yet)";

  const system = `You are maintaining a compact, durable memory for an SMS scheduling assistant.

Output MUST be valid JSON of the form:
{
  "summary": "..."
}

Rules:
- The summary should capture STABLE context and preferences that are useful across future planning.
- DO include: preferred activity, typical constraints, favorite homies, tone preferences, anything stable.
- DO NOT include: specific past event times, dates, or locations (no addresses, venue names, days/times).
- DO NOT invent names; homies may ONLY be selected from:
${homiesList}
- If an existing summary is provided, improve/merge it.
- Keep it short: <= 600 characters.

User: ${args.userFirstName}
Activity: ${args.activityName}`;

  const mergedMessages: ChatMessage[] = [];

  if (args.existingSummary && args.existingSummary.trim().length > 0) {
    mergedMessages.push({
      role: "assistant",
      content: `Existing memory summary (may be outdated):\n${args.existingSummary.trim()}`,
    });
  }

  mergedMessages.push(...args.messages);

  try {
    const { text } = await chat({
      tag: "summarizeConversationMemory",
      system,
      messages: mergedMessages,
      model,
      temperature: 0,
    });

    const raw = (text ?? "").trim();

    const parsed = parseJsonFromLLMText(raw);
    const summary = typeof parsed?.summary === "string" ? parsed.summary.trim() : "";
    if (!summary) return null;

    // Enforce max length defensively.
    return summary.length > 600 ? summary.slice(0, 600) : summary;
  } catch (err: any) {
    logger.warn(`summarizeConversationMemory error: ${err?.message ?? err}`);
    return null;
  }
}
