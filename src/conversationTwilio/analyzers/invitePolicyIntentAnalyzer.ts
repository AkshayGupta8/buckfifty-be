import type { EventInvitePolicy } from "@prisma/client";
import { chat, type ChatMessage } from "../../utils/openAiClient";
import logger from "../../utils/logger";
import { parseJsonFromLLMText } from "../llm/llmJson";

export type InvitePolicyIntent = {
  /** Null means: user did not express a policy preference / no policy change requested. */
  policy: EventInvitePolicy | null;
  /** Used as a guardrail: treat low-confidence as "no change". */
  confidence: "high" | "medium" | "low";
  reason: string;
};

export function buildInvitePolicyIntentAnalyzerSystemPrompt(): string {
  return `You are an assistant that determines the invite policy the user wants.

Return ONLY JSON in this schema:
{ "policy": "max_only"|"prioritized"|"exact"|null, "confidence": "high"|"medium"|"low", "reason": "short" }

Invite policies:
- max_only ("Open Invite"): user only gives a number or says they don't care who / random picks.
  Meaning: randomly pick homies until all spots are filled; invite backups on declines/timeouts.

- prioritized ("Priority Invite"): user names one or more "must invite" homies AND also wants others.
  Meaning: invite all named homies, and also invite additional random homies if still needed.

- exact ("Handpicked Invite" / "Exact Invite"): user wants ONLY a specific set of homies.
  Strong signals include: "only invite X", "no one else", "no backups", "hand picked", "exact".

How to decide:
- If the user is explicitly requesting a policy change (e.g. "invite policy should be..."), set policy accordingly.
- If the user says things that clearly imply exact ("only X", "no backups"), set policy="exact".
- If the user says they don't care who OR asks for random selection, set policy="max_only".
- If the user says "X + others", set policy="prioritized".
- If ambiguous or the user isn't talking about invite policy, set policy=null.

Confidence:
- high: explicit policy words (open/priority/handpicked/exact) or unambiguous phrases like "no backups".
- medium: implied but still clear intent (e.g. "only Phineas, nobody else").
- low: weak/ambiguous signal.

Output rules:
- reason must be <= 120 characters.
- Do not include any extra keys or any text outside the JSON object.`;
}

function normalizeIntent(raw: any): InvitePolicyIntent {
  const p = raw?.policy;
  const policy: EventInvitePolicy | null =
    p === "max_only" || p === "prioritized" || p === "exact" ? p : null;

  const c = raw?.confidence;
  const confidence: InvitePolicyIntent["confidence"] =
    c === "high" || c === "medium" || c === "low" ? c : "low";

  const reason = typeof raw?.reason === "string" ? raw.reason.trim().slice(0, 120) : "";
  return { policy, confidence, reason };
}

export async function analyzeInvitePolicyIntent(args: {
  messages: ChatMessage[];
  systemPrompt: string;
}): Promise<{ intent: InvitePolicyIntent; rawText: string }> {
  const model = process.env.OPENAI_MODEL ?? "gpt-4o-mini";

  try {
    const { text } = await chat({
      tag: "analyzeInvitePolicyIntent",
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
    logger.warn(`analyzeInvitePolicyIntent error: ${err?.message ?? err}`);
    return {
      intent: { policy: null, confidence: "low", reason: "analyzer_error" },
      rawText: String(err?.message ?? err),
    };
  }
}
