import { DateTime } from "luxon";
import type { ChatMessage } from "../../utils/openAiClient";
import { chat } from "../../utils/openAiClient";
import logger from "../../utils/logger";
import { adjustDateTimeToClosestFuture } from "../../utils/timeUtils";
import { parseJsonFromLLMText } from "../llm/llmJson";

export type EventTimePatch = {
  startIso?: string;
  endIso?: string;
  durationMinutes?: number;
};

export function buildEventTimePatchAnalyzerSystemPrompt(args: {
  userTimezone: string;
  nowIso: string;
  existingStartIso?: string;
  existingEndIso?: string;
}): string {
  const existingStart = args.existingStartIso ? args.existingStartIso : "(none)";
  const existingEnd = args.existingEndIso ? args.existingEndIso : "(none)";

  return `You extract time edits from the user's latest SMS.

You MUST respond only in JSON.

Output schema:
{
  "found": true|false,
  "start": "<ISO_8601_with_offset>" | null,
  "end": "<ISO_8601_with_offset>" | null,
  "durationMinutes": number | null,
  "reason": "short optional" 
}

Rules:
- Only use information from the user's messages.
- The user's timezone is: ${args.userTimezone}
- "Now" in that timezone is: ${args.nowIso}
- Existing draft times (may help interpret partial messages like "end at 9"):
  - existingStart: ${existingStart}
  - existingEnd: ${existingEnd}

Interpretation:
- If the user provides a start time, set start.
- If the user provides an end time ("end at 9"), set end.
- If the user provides a duration ("for 90 minutes", "for 2 hours"), set durationMinutes.
- If the user provides start+end together ("8-10"), set both.

Ambiguity handling:
- If you cannot confidently extract any time change, set found=false.
- Do NOT invent dates or times.

Special rule for partial times:
- If the user provides ONLY a time-of-day (e.g. "3pm") and an existingStart is present,
  you MAY anchor that time-of-day to the same calendar date as existingStart.
  (This is not considered "inventing" a date; it is reusing the draft's date.)

Output rules:
- start/end MUST include an explicit timezone offset.
- If start/end are not provided, use null (do not omit keys).
- durationMinutes must be an integer number of minutes if provided.
- Do not add commentary outside the JSON.`;
}

function normalizePatch(args: {
  userTimezone: string;
  nowInUserTz: DateTime;
  existingStartIso?: string;
  existingEndIso?: string;
  parsed: any;
  rawText: string;
}): { ok: true; patch: EventTimePatch } | { ok: false; reason: string; rawText: string } {
  if (!args.parsed || args.parsed.found !== true) {
    return {
      ok: false,
      reason: typeof args.parsed?.reason === "string" ? args.parsed.reason : "no_time_patch",
      rawText: args.rawText,
    };
  }

  const startIsoRaw = typeof args.parsed.start === "string" ? args.parsed.start : "";
  const endIsoRaw = typeof args.parsed.end === "string" ? args.parsed.end : "";

  let durationMinutes: number | undefined;
  if (typeof args.parsed.durationMinutes === "number" && Number.isFinite(args.parsed.durationMinutes)) {
    durationMinutes = Math.trunc(args.parsed.durationMinutes);
  } else if (typeof args.parsed.durationMinutes === "string") {
    const n = Number.parseInt(args.parsed.durationMinutes, 10);
    if (Number.isFinite(n)) durationMinutes = n;
  }
  if (typeof durationMinutes === "number" && durationMinutes <= 0) durationMinutes = undefined;

  const patch: EventTimePatch = {};

  // Start
  if (startIsoRaw.trim().length) {
    const startDt = DateTime.fromISO(startIsoRaw, { setZone: true });
    if (!startDt.isValid) return { ok: false, reason: "invalid_start", rawText: args.rawText };

    const adjusted = adjustDateTimeToClosestFuture({ dt: startDt, now: args.nowInUserTz }).adjusted;
    patch.startIso =
      adjusted.toISO({ suppressMilliseconds: true }) ?? adjusted.toISO() ?? startIsoRaw;

    // If the user explicitly changed the start, we should invalidate end unless they also gave an end.
    // We'll let the merge step decide whether to keep end based on presence of patch.endIso.
  }

  // End
  if (endIsoRaw.trim().length) {
    const endDt = DateTime.fromISO(endIsoRaw, { setZone: true });
    if (!endDt.isValid) return { ok: false, reason: "invalid_end", rawText: args.rawText };

    // When we have a start (either in patch or existing), ensure end comes after that.
    const startForEnd = patch.startIso
      ? DateTime.fromISO(patch.startIso, { setZone: true })
      : args.existingStartIso
        ? DateTime.fromISO(args.existingStartIso, { setZone: true })
        : null;

    const anchor = startForEnd && startForEnd.isValid ? startForEnd : args.nowInUserTz;
    const adjusted = adjustDateTimeToClosestFuture({ dt: endDt, now: anchor }).adjusted;

    patch.endIso = adjusted.toISO({ suppressMilliseconds: true }) ?? adjusted.toISO() ?? endIsoRaw;
  }

  if (typeof durationMinutes === "number") {
    patch.durationMinutes = durationMinutes;
  }

  if (!patch.startIso && !patch.endIso && typeof patch.durationMinutes !== "number") {
    return { ok: false, reason: "empty_patch", rawText: args.rawText };
  }

  return { ok: true, patch };
}

/**
 * Extract a time "patch" from the latest user message.
 *
 * This is designed to support split messages like:
 * - "Sat at 7" (start)
 * - "end at 9" (end)
 */
export async function analyzeEventTimePatch(args: {
  userTimezone: string;
  /** Existing draft times (optional), to interpret partial edits like "end at 9". */
  existingStartIso?: string;
  existingEndIso?: string;
  /** Recent messages (oldest-first). Prefer passing just recent USER messages. */
  messages: ChatMessage[];
}): Promise<{ ok: true; patch: EventTimePatch; rawText: string } | { ok: false; reason: string; rawText: string }> {
  const nowInUserTz = DateTime.now().setZone(args.userTimezone);
  if (!nowInUserTz.isValid) {
    return { ok: false, reason: "invalid_timezone", rawText: "" };
  }

  const systemPrompt = buildEventTimePatchAnalyzerSystemPrompt({
    userTimezone: args.userTimezone,
    nowIso: nowInUserTz.toISO({ suppressMilliseconds: true }) ?? nowInUserTz.toISO() ?? "",
    existingStartIso: args.existingStartIso,
    existingEndIso: args.existingEndIso,
  });

  const model = process.env.OPENAI_MODEL ?? "gpt-4o-mini";

  try {
    const { text } = await chat({
      tag: "analyzeEventTimePatch",
      system: systemPrompt,
      messages: args.messages,
      model,
      temperature: 0.0,
    });

    const raw = (text ?? "").trim();
    const parsed = parseJsonFromLLMText(raw);

    const normalized = normalizePatch({
      userTimezone: args.userTimezone,
      nowInUserTz,
      existingStartIso: args.existingStartIso,
      existingEndIso: args.existingEndIso,
      parsed,
      rawText: raw,
    });

    if (!normalized.ok) {
      return { ok: false, reason: normalized.reason, rawText: normalized.rawText };
    }

    return { ok: true, patch: normalized.patch, rawText: raw };
  } catch (err: any) {
    logger.warn(`analyzeEventTimePatch error: ${err?.message ?? err}`);
    return { ok: false, reason: "analyzer_error", rawText: String(err?.message ?? err) };
  }
}
