import { DateTime } from "luxon";
import type { ChatMessage } from "../../utils/openAiClient";
import { chat } from "../../utils/openAiClient";
import { adjustDateTimeToClosestFuture } from "../../utils/timeUtils";
import { parseJsonFromLLMText } from "../llm/llmJson";
import { logLlmInput, logLlmOutput } from "../llm/llmLogging";

function containsExplicitPastTimePhrase(s: string): boolean {
  const t = s.toLowerCase();
  // Heuristic: if user explicitly references the past, we should ask them to confirm.
  // (We still allow accidental past anchoring like “today 1pm” returned by the model.)
  const patterns: RegExp[] = [
    /\byesterday\b/i,
    /\blast\s+(night|week|month|year|friday|saturday|sunday|monday|tuesday|wednesday|thursday)\b/i,
    /\bearlier\s+today\b/i,
    /\bthis\s+morning\b/i,
    /\bthis\s+afternoon\b/i,
    /\bthis\s+evening\b/i,
  ];
  return patterns.some((p) => p.test(t));
}

export async function extractAndNormalizeEventTimesFromConversation(args: {
  userTimezone: string;
  location: string;
  messages: ChatMessage[];
}): Promise<
  | { ok: true; start: Date; end: Date; startIso: string; endIso: string }
  | { ok: false; reason: string; rawText?: string }
> {
  const nowInUserTz = DateTime.now().setZone(args.userTimezone);
  if (!nowInUserTz.isValid) {
    // This message may accidentally be surfaced to users in other parts of the system,
    // so keep it generic (no IANA timezone strings).
    return { ok: false, reason: "Invalid timezone configuration" };
  }

  // If the user explicitly said a past reference, ask to confirm instead of “fixing it”.
  // We scan recent user messages only to avoid assistant text influencing this.
  const recentUserText = args.messages
    .filter((m) => m.role === "user")
    .slice(-5)
    .map((m) => m.content)
    .join("\n");

  if (containsExplicitPastTimePhrase(recentUserText)) {
    return {
      ok: false,
      reason: "It sounds like that time might be in the past. What future start time should I use?",
    };
  }

  const system = `You extract and normalize an event START/END time from an SMS conversation.

You MUST respond only in JSON.

If a start time is confidently provided, output:
{
  "found": true,
  "start": "<ISO_8601_with_offset>",
  "end": "<ISO_8601_with_offset>" | null
}

If no start time is provided or it's too ambiguous, output:
{
  "found": false,
  "reason": "<short reason>"
}

Rules:
- The user's timezone is: ${args.userTimezone}
- "Now" in the user's timezone is: ${nowInUserTz.toISO({ suppressMilliseconds: true })}
- The event location is: ${args.location}
- Interpret relative phrases like "tomorrow", "next Friday", "at 1", "tonight" relative to "Now".
- If the user did NOT explicitly give an end time or duration, set "end" to null.
- If the user gave a duration (e.g. "for 90 minutes"), compute an end time.
- Your output start/end MUST include an explicit timezone offset.
- Do not add commentary.`;

  const model = process.env.OPENAI_MODEL ?? "gpt-4o-mini";

  try {
    logLlmInput({
      tag: "extractAndNormalizeEventTimesFromConversation",
      model,
      temperature: 0,
      system,
      messages: args.messages,
    });

    const { text } = await chat({
      system,
      messages: args.messages,
      model,
      temperature: 0,
    });

    const raw = (text ?? "").trim();
    logLlmOutput({ tag: "extractAndNormalizeEventTimesFromConversation", text: raw });

    const parsed = parseJsonFromLLMText(raw);

    if (!parsed || parsed.found !== true) {
      return {
        ok: false,
        reason: typeof parsed?.reason === "string" ? parsed.reason : "No time found",
        rawText: raw,
      };
    }

    const startIsoFromModel = typeof parsed.start === "string" ? parsed.start : "";
    const endIsoFromModel = typeof parsed.end === "string" ? parsed.end : "";

    const startDt = DateTime.fromISO(startIsoFromModel, { setZone: true });
    const endDt = DateTime.fromISO(endIsoFromModel, { setZone: true });

    if (!startDt.isValid) {
      return { ok: false, reason: "Could not parse start time", rawText: raw };
    }

    // Always leniently bump start into the future relative to now.
    const adjustedStart = adjustDateTimeToClosestFuture({
      dt: startDt,
      now: nowInUserTz,
    }).adjusted;

    let computedEnd: DateTime;
    if (endDt.isValid) {
      // Also keep end after start (bump by days if needed).
      computedEnd = adjustDateTimeToClosestFuture({
        dt: endDt,
        now: adjustedStart,
      }).adjusted;
    } else {
      // Default duration: 2 hours.
      computedEnd = adjustedStart.plus({ hours: 2 });
    }

    // Ensure end is after start (be lenient).
    if (computedEnd <= adjustedStart) {
      computedEnd = adjustedStart.plus({ hours: 2 });
    }

    return {
      ok: true,
      start: adjustedStart.toJSDate(),
      end: computedEnd.toJSDate(),
      startIso:
        adjustedStart.toISO({ suppressMilliseconds: true }) ??
        adjustedStart.toISO() ??
        startIsoFromModel,
      endIso:
        computedEnd.toISO({ suppressMilliseconds: true }) ?? computedEnd.toISO() ?? endIsoFromModel,
    };
  } catch (err: any) {
    return { ok: false, reason: String(err?.message ?? err) };
  }
}
