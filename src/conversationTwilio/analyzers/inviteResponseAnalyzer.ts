import { chat, type ChatMessage } from "../../utils/openAiClient";
import logger from "../../utils/logger";
import { parseJsonFromLLMText } from "../llm/llmJson";

export type InviteResponseDecision = "accepted" | "declined" | "unknown";

export function buildInviteResponseAnalyzerSystemPrompt(): string {
  return `You are an assistant that classifies an invited homie's SMS response.

Return ONLY JSON:
{
  "decision": "accepted"|"declined"|"unknown",
  "summary": "short, sms-safe summary for the event creator"
}

Rules:
- "accepted" if they clearly say yes / can make it.
- "declined" if they clearly say no / can't make it.
- "unknown" if ambiguous.
- The summary MUST be short (<= 160 chars), no emojis, no markdown.
- The summary should refer to the homie in third person (e.g. "He said ..." / "She said ..." / "They said ...").
- Do not invent details; only summarize what the homie wrote.`;
}

export async function analyzeInviteResponse(args: {
  messages: ChatMessage[];
  systemPrompt: string;
}): Promise<{ decision: InviteResponseDecision; summary: string; rawText: string }> {
  const model = process.env.OPENAI_MODEL ?? "gpt-4o-mini";

  try {
    const { text } = await chat({
      tag: "analyzeInviteResponse",
      system: args.systemPrompt,
      messages: args.messages,
      model,
      temperature: 0.0,
    });

    const raw = (text ?? "").trim();

    const parsed = parseJsonFromLLMText(raw);
    const decisionRaw = typeof parsed.decision === "string" ? parsed.decision : "unknown";
    const decision: InviteResponseDecision =
      decisionRaw === "accepted" || decisionRaw === "declined" ? decisionRaw : "unknown";

    const summary = typeof parsed.summary === "string" ? parsed.summary.trim() : "";

    return {
      decision,
      summary: summary.slice(0, 220),
      rawText: raw,
    };
  } catch (err: any) {
    logger.warn(`analyzeInviteResponse error: ${err?.message ?? err}`);
    return {
      decision: "unknown",
      summary: "",
      rawText: String(err?.message ?? err),
    };
  }
}
