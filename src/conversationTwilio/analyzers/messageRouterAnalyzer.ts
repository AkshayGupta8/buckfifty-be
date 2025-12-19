import { chat, type ChatMessage } from "../../utils/openAiClient";
import logger from "../../utils/logger";
import { parseJsonFromLLMText } from "../llm/llmJson";
import { logLlmInput, logLlmOutput } from "../llm/llmLogging";

export type MessageRoute = "scheduling" | "coordination";

export function buildMessageRouterSystemPrompt(): string {
  return `You are a router that decides where an inbound SMS should be handled.

Return ONLY JSON:
{ "route": "scheduling"|"coordination", "reason": "short reason" }

Guidelines:
- "coordination" is for messages that look like invite responses (yes/no/maybe) or questions about attending.
- "scheduling" is for the event creator planning details (location/time/homies).
- If you are unsure, choose "scheduling".
- Keep reason <= 120 chars.`;
}

export async function analyzeMessageRoute(args: {
  messages: ChatMessage[];
  systemPrompt: string;
}): Promise<{ route: MessageRoute; reason: string; rawText: string }> {
  const model = process.env.OPENAI_MODEL ?? "gpt-4o-mini";

  try {
    logLlmInput({
      tag: "analyzeMessageRoute",
      model,
      temperature: 0.0,
      system: args.systemPrompt,
      messages: args.messages,
    });

    const { text } = await chat({
      system: args.systemPrompt,
      messages: args.messages,
      model,
      temperature: 0.0,
    });

    const raw = (text ?? "").trim();
    logLlmOutput({ tag: "analyzeMessageRoute", text: raw });

    const parsed = parseJsonFromLLMText(raw);
    const routeRaw = typeof parsed.route === "string" ? parsed.route : "scheduling";
    const route: MessageRoute = routeRaw === "coordination" ? "coordination" : "scheduling";
    const reason = typeof parsed.reason === "string" ? parsed.reason.trim() : "";

    return { route, reason: reason.slice(0, 180), rawText: raw };
  } catch (err: any) {
    logger.warn(`analyzeMessageRoute error: ${err?.message ?? err}`);
    return {
      route: "scheduling",
      reason: "router_error",
      rawText: String(err?.message ?? err),
    };
  }
}
