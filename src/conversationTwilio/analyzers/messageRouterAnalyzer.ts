import { chat, type ChatMessage } from "../../utils/openAiClient";
import logger from "../../utils/logger";
import { parseJsonFromLLMText } from "../llm/llmJson";

export type MessageRoute = "scheduling" | "coordination";

export function buildMessageRouterSystemPrompt(): string {
  return `You are BuckFifty's SMS message router.

Context:
- BuckFifty is an SMS-based assistant for planning events and coordinating attendance.
- There are two possible handling routes for an inbound SMS:
  1) "scheduling": the message is from the EVENT CREATOR (a user) planning or editing an event.
  2) "coordination": the message is from an INVITED HOMIE (a member) responding to an invite or asking about attending.

Return ONLY JSON:
{ "route": "scheduling"|"coordination", "reason": "short reason" }

How to choose:
- Choose "coordination" when the message is primarily about ATTENDING an invite:
  - clear accept/decline/maybe ("yes", "i'm in", "can't", "maybe", "not sure")
  - questions about the invite details from an attendee perspective ("what time is it?", "where is it?", "who else is going?")
  - arrival/availability/ride/bringing something ("i'll be 10 mins late", "can i bring a friend?")
- Choose "scheduling" when the message is primarily about CREATING/PLANNING/UPDATING an event:
  - specifying or changing time/location
  - selecting which homies to invite or how many
  - writing or editing an invite note/message

Ambiguity rule:
- If unsure, choose "scheduling".

Output rules:
- reason must be <= 120 characters.
- Do not include extra keys or any text outside the JSON object.`;
}

export async function analyzeMessageRoute(args: {
  messages: ChatMessage[];
  systemPrompt: string;
}): Promise<{ route: MessageRoute; reason: string; rawText: string }> {
  const model = process.env.OPENAI_MODEL ?? "gpt-4o-mini";

  try {
    const { text } = await chat({
      tag: "analyzeMessageRoute",
      system: args.systemPrompt,
      messages: args.messages,
      model,
      temperature: 0.0,
    });

    const raw = (text ?? "").trim();

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
