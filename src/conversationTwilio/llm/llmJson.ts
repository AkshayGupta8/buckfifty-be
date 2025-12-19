export function parseJsonFromLLMText(rawText: string): any {
  const raw = (rawText ?? "").trim();
  if (!raw) {
    throw new Error("LLM returned empty text");
  }

  // Attempt direct parse first.
  try {
    return JSON.parse(raw);
  } catch {
    // Fall back to extracting a JSON blob (common when the model adds commentary).
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) {
      throw new Error("LLM did not return valid JSON and no JSON blob was found.");
    }
    try {
      return JSON.parse(match[0]);
    } catch (e) {
      throw new Error(`Failed to parse JSON from LLM output: ${e}`);
    }
  }
}

export function isNonEmptyString(x: unknown): x is string {
  return typeof x === "string" && x.trim().length > 0;
}
