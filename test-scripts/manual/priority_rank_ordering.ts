/**
 * Manual regression check for scheduler priority_rank ordering.
 *
 * Run:
 *   npx ts-node test-scripts/manual/priority_rank_ordering.ts
 */

function computeRanks(immediateIds: string[], followUpIds: string[]): Map<string, number> {
  const ordered: string[] = [];
  const seen = new Set<string>();
  for (const id of [...immediateIds, ...followUpIds]) {
    const t = (id ?? "").trim();
    if (!t) continue;
    if (seen.has(t)) continue;
    seen.add(t);
    ordered.push(t);
  }
  return new Map(ordered.map((id, idx) => [id, idx + 1] as const));
}

function assertEq(a: any, b: any, msg: string): void {
  if (a !== b) {
    throw new Error(`Assertion failed: ${msg}. Expected ${b}, got ${a}`);
  }
}

function main(): void {
  const immediate = ["A", "B", "C"]; // inviting now
  const followUp = ["D", "E", "F"]; // backups

  const ranks = computeRanks(immediate, followUp);

  assertEq(ranks.get("A"), 1, "A rank");
  assertEq(ranks.get("B"), 2, "B rank");
  assertEq(ranks.get("C"), 3, "C rank");
  assertEq(ranks.get("D"), 4, "D rank");
  assertEq(ranks.get("E"), 5, "E rank");
  assertEq(ranks.get("F"), 6, "F rank");

  // Deduping check: immediate repeated in follow-up should keep earlier rank.
  const ranks2 = computeRanks(["A", "B"], ["B", "C"]);
  assertEq(ranks2.get("A"), 1, "A rank (dedupe)");
  assertEq(ranks2.get("B"), 2, "B rank (dedupe)");
  assertEq(ranks2.get("C"), 3, "C rank (dedupe)");

  // Empty/whitespace ids are ignored.
  const ranks3 = computeRanks(["  ", "A"], ["", "B"]);
  assertEq(ranks3.get("A"), 1, "A rank (ignore blanks)");
  assertEq(ranks3.get("B"), 2, "B rank (ignore blanks)");

  console.log("OK: priority_rank ordering matches inviting-now then backup order.");
}

main();
