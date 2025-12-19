import { chat, type ChatMessage } from "../../utils/openAiClient";
import logger from "../../utils/logger";
import { isNonEmptyString, parseJsonFromLLMText } from "../llm/llmJson";
import { logLlmInput, logLlmOutput } from "../llm/llmLogging";

function inferImpliedAdditionalCountFromRecentUserText(messages: ChatMessage[]): number {
  // Look at the most recent user text to see if they implied "and at least one other / another / someone else".
  // If present, we interpret it as +1 additional beyond the explicitly named homies.
  const recentUserText = messages
    .filter((m) => m.role === "user")
    .slice(-5)
    .map((m) => m.content)
    .join("\n")
    .toLowerCase();

  // Common ways users express “X + at least one more person”.
  // We keep these patterns fairly specific to avoid accidental matches like "one more hour".
  const patterns: RegExp[] = [
    // Allow optional "homie/friend/person" for this specific pattern because it is already unambiguous.
    /\bat\s*least\s*(one|1)\s+other(\s+(homie|friend|person))?\b/i,

    /\bat\s*least\s*(one|1)\s+more\s+(homie|friend|person)\b/i,
    /\bone\s+other\s+(homie|friend|person)\b/i,
    /\bone\s+more\s+(homie|friend|person)\b/i,
    /\banother\s+(homie|person|friend|one)\b/i,
    /\bsomeone\s+else\b/i,
    /\bplus\s+one\s+(more\s+)?(homie|friend|person)\b/i,
    /\bplus\s+another\s+(homie|friend|person)\b/i,
  ];

  return patterns.some((p) => p.test(recentUserText)) ? 1 : 0;
}

export function buildHomiesAnalyzerSystemPrompt(args: { homiesList: string }): string {
  return `You are an assistant that extracts which homies the user wants to invite.

You MUST respond only in this JSON format:
{
  "homies": ["Full Name", "Full Name"],
  "maxHomies": number|null
}

The user has FOUR valid ways to specify invites:
1) Exact list: "Invite Jake and Priya" => homies=["Jake ...", "Priya ..."], maxHomies=null
2) Any N: "Any 3 of my homies" / "Invite 3" => homies=[], maxHomies=3
3) Partial + max: "Definitely Jake, and any others up to 3" => homies=["Jake ..."], maxHomies=3
4) Partial + implied-min: "Invite Jake and at least one other homie" => homies=["Jake ..."], maxHomies=2

Rules:
- If the user ONLY provides a max ("any 3", "invite 3"), do NOT pick names; return an empty homies array and set maxHomies.
- If the user provides some names AND a max, return those names in homies and set maxHomies.
- If the user provides names WITHOUT a max, treat it as an exact list: return those names and maxHomies=null.
- If the user provides names PLUS a phrase like "at least one other", "one more", "someone else", or "another homie", treat it as Partial + implied-min: set maxHomies to the minimum implied total (named count + 1).
- If neither names nor a max are provided, return an empty homies array and maxHomies null.
- Do not invent names.
- Homies may ONLY be selected from this list (verbatim):
${args.homiesList}`;
}

export async function analyzeConversationHomies(
  messages: ChatMessage[],
  systemPrompt: string,
  allowedHomies: string[]
): Promise<{
  homiesProvided: boolean;
  homies: string[] | null;
  maxHomies: number | null;
  rawText: string;
}> {
  const model = process.env.OPENAI_MODEL ?? "gpt-4o-mini";

  try {
    logLlmInput({
      tag: "analyzeConversationHomies",
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
    logLlmOutput({ tag: "analyzeConversationHomies", text: raw });

    const parsed = parseJsonFromLLMText(raw);

    const allowedByLower = new Map(
      allowedHomies
        .filter((h) => h.trim().length > 0)
        .map((h) => [h.trim().toLowerCase(), h.trim()] as const)
    );

    const extractedHomies: string[] = Array.isArray(parsed.homies)
      ? parsed.homies.filter(isNonEmptyString)
      : [];

    const normalizedHomies = Array.from(
      new Set(
        extractedHomies
          .map((h) => allowedByLower.get(h.trim().toLowerCase()))
          .filter((h): h is string => Boolean(h))
      )
    );

    let maxHomies: number | null = null;
    if (typeof parsed.maxHomies === "number" && Number.isFinite(parsed.maxHomies)) {
      maxHomies = Math.trunc(parsed.maxHomies);
    } else if (typeof parsed.maxHomies === "string") {
      const n = Number.parseInt(parsed.maxHomies, 10);
      if (Number.isFinite(n)) maxHomies = n;
    }

    if (maxHomies !== null && maxHomies <= 0) {
      maxHomies = null;
    }

    // Deterministic fallback:
    // If the model forgot to set maxHomies, but the user implied “and at least one other”,
    // infer the minimum implied total.
    if (maxHomies === null && normalizedHomies.length > 0) {
      const impliedAdditional = inferImpliedAdditionalCountFromRecentUserText(messages);
      if (impliedAdditional > 0) {
        maxHomies = normalizedHomies.length + impliedAdditional;
      }
    }

    const homies = normalizedHomies.length ? normalizedHomies : null;
    const homiesProvided = Boolean(homies?.length) || maxHomies !== null;

    return { homiesProvided, homies, maxHomies, rawText: raw };
  } catch (err: any) {
    logger.warn(`analyzeConversationHomies error: ${err?.message ?? err}`);
    return {
      homiesProvided: false,
      homies: null,
      maxHomies: null,
      rawText: String(err?.message ?? err),
    };
  }
}
