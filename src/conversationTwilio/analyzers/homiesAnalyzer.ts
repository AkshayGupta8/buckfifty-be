import { chat, type ChatMessage } from "../../utils/openAiClient";
import logger from "../../utils/logger";
import { isNonEmptyString, parseJsonFromLLMText } from "../llm/llmJson";
import { logLlmInput, logLlmOutput } from "../llm/llmLogging";

export function buildHomiesAnalyzerSystemPrompt(args: { homiesList: string }): string {
  return `You are an assistant that extracts which homies the user wants to invite.

You MUST respond only in this JSON format:
{
  "homies": ["Full Name", "Full Name"],
  "maxHomies": number|null
}

The user has THREE valid ways to specify invites:
1) Exact list: "Invite Jake and Priya" => homies=["Jake ...", "Priya ..."], maxHomies=null
2) Any N: "Any 3 of my homies" / "Invite 3" => homies=[], maxHomies=3
3) Partial + max: "Definitely Jake, and any others up to 3" => homies=["Jake ..."], maxHomies=3

Rules:
- If the user ONLY provides a max ("any 3", "invite 3"), do NOT pick names; return an empty homies array and set maxHomies.
- If the user provides some names AND a max, return those names in homies and set maxHomies.
- If the user provides names WITHOUT a max, treat it as an exact list: return those names and maxHomies=null.
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
