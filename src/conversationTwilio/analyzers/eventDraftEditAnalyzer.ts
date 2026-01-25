import { chat, type ChatMessage } from "../../utils/openAiClient";
import logger from "../../utils/logger";
import { parseJsonFromLLMText } from "../llm/llmJson";

export type DraftInviteSwap = { in: string; out: string };

export type EventDraftEditPatch = {
  bans: string[];
  unbans: string[];
  add: string[];
  remove: string[];
  /** Swap someone into Inviting-now and swap someone out to backups. */
  swap: DraftInviteSwap[];
  /** Desired full backup order (names). If omitted, keep existing order. */
  backupOrder?: string[];
  /** Optional short note for logs/debugging. */
  note?: string;
};

export function buildEventDraftEditAnalyzerSystemPrompt(args: {
  allowedHomiesList: string;
  currentInvitingNow: string[];
  currentBackups: string[];
  currentExcluded: string[];
}): string {
  const invitingNow = args.currentInvitingNow.length
    ? args.currentInvitingNow.map((n) => `- ${n}`).join("\n")
    : "(none)";

  const backups = args.currentBackups.length
    ? args.currentBackups.map((n) => `- ${n}`).join("\n")
    : "(none)";

  const excluded = args.currentExcluded.length
    ? args.currentExcluded.map((n) => `- ${n}`).join("\n")
    : "(none)";

  return `You are an assistant that edits an event draft's invite plan during confirmation.

You must output ONLY JSON in this exact schema:
{
  "bans": ["Full Name"],
  "unbans": ["Full Name"],
  "add": ["Full Name"],
  "remove": ["Full Name"],
  "swap": [{"in": "Full Name", "out": "Full Name"}],
  "backupOrder": ["Full Name"],
  "note": "short optional note"
}

Definitions:
- "bans": user says don't invite / exclude someone. This is sticky for the draft.
- "unbans": user reverses a prior ban (e.g. "actually invite X").
- "remove": remove someone from the current invite plan (inviting-now or backups) but do NOT ban.
- "add": user wants to include someone in the plan (if inviting-now is full, the app will bump someone to backups).
- "swap": user wants a specific person in inviting-now instead of someone else.
- "backupOrder": user wants a specific order of backups (only backups). Provide the full ordered list.

Important rules:
- Only output names that appear in the Allowed homies list.
- If the user requests banning someone, also include them in "remove" only if necessary; the app enforces the ban.
- If the user says "make X the first backup" or explicitly mentions "backup/backups", use backupOrder.
- If the user says "invite X first" / "invite X next" / "invite X instead", interpret it as changing who is invited now:
  - Emit a swap that puts X into Inviting now.
  - If Inviting now currently has exactly 1 person, swap X in and swap that person out.
  - Do NOT treat "invite X first" as a backup reorder unless the user explicitly says "backup".
- If the user says "don't list X in backups either", that is a ban.
- If no actionable edits are present, return empty arrays and omit backupOrder.

Current state:
Inviting now:
${invitingNow}

Backups:
${backups}

Excluded:
${excluded}

Allowed homies (verbatim):
${args.allowedHomiesList}

Output rules:
- Return only JSON with the keys above.
- Arrays should be present (use [] when empty).
- backupOrder key may be omitted if not specified by the user.
- note must be <= 120 chars if present.`;
}

function normalizePatch(p: any): EventDraftEditPatch {
  const asStrArr = (v: any): string[] =>
    Array.isArray(v) ? v.filter((x) => typeof x === "string").map((s) => s.trim()).filter(Boolean) : [];

  const swapRaw: any[] = Array.isArray(p?.swap) ? p.swap : [];
  const swap: DraftInviteSwap[] = swapRaw
    .map((x) => ({ in: String(x?.in ?? "").trim(), out: String(x?.out ?? "").trim() }))
    .filter((x) => x.in.length > 0 && x.out.length > 0);

  const backupOrder = Array.isArray(p?.backupOrder)
    ? p.backupOrder
        .filter((x: any) => typeof x === "string")
        .map((s: string) => s.trim())
        .filter(Boolean)
    : undefined;

  const note = typeof p?.note === "string" ? p.note.trim().slice(0, 120) : undefined;

  return {
    bans: asStrArr(p?.bans),
    unbans: asStrArr(p?.unbans),
    add: asStrArr(p?.add),
    remove: asStrArr(p?.remove),
    swap,
    ...(backupOrder ? { backupOrder } : {}),
    ...(note ? { note } : {}),
  };
}

export async function analyzeEventDraftEdit(args: {
  systemPrompt: string;
  messages: ChatMessage[];
}): Promise<{ patch: EventDraftEditPatch; rawText: string }> {
  const model = process.env.OPENAI_MODEL ?? "gpt-4o-mini";

  try {
    const { text } = await chat({
      tag: "analyzeEventDraftEdit",
      system: args.systemPrompt,
      messages: args.messages,
      model,
      temperature: 0.0,
    });

    const raw = (text ?? "").trim();
    const parsed = parseJsonFromLLMText(raw);
    const patch = normalizePatch(parsed);

    return { patch, rawText: raw };
  } catch (err: any) {
    logger.warn(`analyzeEventDraftEdit error: ${err?.message ?? err}`);
    return {
      patch: { bans: [], unbans: [], add: [], remove: [], swap: [] },
      rawText: String(err?.message ?? err),
    };
  }
}
