import type { Member } from "@prisma/client";
import { fullNameForMember } from "./homies";
import type { EventDraftEditPatch } from "../analyzers/eventDraftEditAnalyzer";

export type InvitePlan = {
  immediateMemberIds: string[];
  followUpMemberIds: string[];
  excludedMemberIds: string[];
};

export type ApplyInvitePlanPatchResult =
  | {
      ok: true;
      plan: InvitePlan;
      immediateNames: string[];
      followUpNames: string[];
      excludedNames: string[];
    }
  | { ok: false; reason: string };

function uniq<T>(arr: T[]): T[] {
  return Array.from(new Set(arr));
}

function without<T>(arr: T[], remove: Set<T>): T[] {
  return arr.filter((x) => !remove.has(x));
}

function asNameMap(allMembers: Member[]): Map<string, Member> {
  return new Map(
    allMembers.map((m) => [fullNameForMember(m).trim().toLowerCase(), m] as const)
  );
}

function resolveNamesToIds(args: {
  allMembers: Member[];
  names: string[];
}): { ids: string[]; unknownNames: string[] } {
  const byNameLower = asNameMap(args.allMembers);
  const ids: string[] = [];
  const unknownNames: string[] = [];

  for (const raw of args.names) {
    const name = raw.trim();
    if (!name) continue;
    const m = byNameLower.get(name.toLowerCase());
    if (!m) {
      unknownNames.push(name);
      continue;
    }
    ids.push(m.member_id);
  }

  return { ids: uniq(ids), unknownNames: uniq(unknownNames) };
}

function moveToFront(arr: string[], idsInOrder: string[]): string[] {
  const inSet = new Set(idsInOrder);
  const rest = arr.filter((x) => !inSet.has(x));
  return [...idsInOrder, ...rest];
}

export function applyInvitePlanPatch(args: {
  maxHomies: number;
  allMembers: Member[];
  plan: InvitePlan;
  patch: EventDraftEditPatch;
  /**
   * If true, when an add targets a full immediate list, bump the last immediate to backups.
   * (This matches your desired semantics.)
   */
  bumpLastImmediateOnAddWhenFull: boolean;
}): ApplyInvitePlanPatchResult {
  const maxHomies = Math.max(0, Math.trunc(args.maxHomies));
  if (maxHomies <= 0) return { ok: false, reason: "maxHomies must be >= 1" };

  const allMemberIds = new Set(args.allMembers.map((m) => m.member_id));

  const immediate0 = uniq(args.plan.immediateMemberIds ?? []).filter((id) => allMemberIds.has(id));
  const follow0 = uniq(args.plan.followUpMemberIds ?? []).filter((id) => allMemberIds.has(id));
  const excluded0 = uniq(args.plan.excludedMemberIds ?? []).filter((id) => allMemberIds.has(id));

  // Resolve patch names -> ids
  const resolvedBans = resolveNamesToIds({ allMembers: args.allMembers, names: args.patch.bans ?? [] });
  const resolvedUnbans = resolveNamesToIds({ allMembers: args.allMembers, names: args.patch.unbans ?? [] });
  const resolvedAdds = resolveNamesToIds({ allMembers: args.allMembers, names: args.patch.add ?? [] });
  const resolvedRemoves = resolveNamesToIds({ allMembers: args.allMembers, names: args.patch.remove ?? [] });

  const resolvedSwapIn = resolveNamesToIds({
    allMembers: args.allMembers,
    names: (args.patch.swap ?? []).map((s) => s.in),
  });
  const resolvedSwapOut = resolveNamesToIds({
    allMembers: args.allMembers,
    names: (args.patch.swap ?? []).map((s) => s.out),
  });

  const unknownNames = uniq([
    ...resolvedBans.unknownNames,
    ...resolvedUnbans.unknownNames,
    ...resolvedAdds.unknownNames,
    ...resolvedRemoves.unknownNames,
    ...resolvedSwapIn.unknownNames,
    ...resolvedSwapOut.unknownNames,
  ]);
  if (unknownNames.length) {
    return { ok: false, reason: `Unknown homie(s): ${unknownNames.join(", ")}` };
  }

  // Start from existing
  let immediate = [...immediate0];
  let followUp = [...follow0.filter((id) => !immediate.includes(id))];
  let excluded = [...excluded0];

  const banSet = new Set(resolvedBans.ids);
  const unbanSet = new Set(resolvedUnbans.ids);
  const removeSet = new Set(resolvedRemoves.ids);

  // 1) Apply unbans first (so an "actually invite X" can remove them from excluded)
  if (unbanSet.size) {
    excluded = excluded.filter((id) => !unbanSet.has(id));
  }

  // 2) Apply bans (sticky exclusions)
  if (banSet.size) {
    excluded = uniq([...excluded, ...Array.from(banSet)]);
  }

  // Enforce exclusion immediately
  const excludedSet = new Set(excluded);
  immediate = immediate.filter((id) => !excludedSet.has(id));
  followUp = followUp.filter((id) => !excludedSet.has(id));

  // 3) Apply non-sticky removes
  if (removeSet.size) {
    immediate = immediate.filter((id) => !removeSet.has(id));
    followUp = followUp.filter((id) => !removeSet.has(id));
  }

  // 4) Apply swaps (in -> immediate, out -> followUp)
  // Build id->id mapping from pairs by index; ignore invalid pairs.
  const swapPairs: Array<{ inId: string; outId: string }> = [];
  for (let i = 0; i < (args.patch.swap ?? []).length; i++) {
    const inName = args.patch.swap[i]?.in;
    const outName = args.patch.swap[i]?.out;
    if (!inName || !outName) continue;
    const inId = resolveNamesToIds({ allMembers: args.allMembers, names: [inName] }).ids[0];
    const outId = resolveNamesToIds({ allMembers: args.allMembers, names: [outName] }).ids[0];
    if (!inId || !outId) continue;
    if (excludedSet.has(inId) || excludedSet.has(outId)) continue;
    swapPairs.push({ inId, outId });
  }

  for (const { inId, outId } of swapPairs) {
    // Remove both from wherever they are
    immediate = immediate.filter((id) => id !== outId && id !== inId);
    followUp = followUp.filter((id) => id !== outId && id !== inId);

    // Insert inId to immediate (front)
    immediate = [inId, ...immediate];
    // Put outId at top of backups
    followUp = [outId, ...followUp];
  }

  // Keep only up to max in immediate; spill extras to followUp front (preserving order)
  if (immediate.length > maxHomies) {
    const spill = immediate.slice(maxHomies);
    immediate = immediate.slice(0, maxHomies);
    followUp = uniq([...spill, ...followUp.filter((id) => !spill.includes(id))]);
  }

  // 5) Apply adds
  for (const addId of resolvedAdds.ids) {
    if (excludedSet.has(addId)) continue;
    // Remove from followUp first to avoid duplicates
    followUp = followUp.filter((id) => id !== addId);
    if (immediate.includes(addId)) continue;

    if (immediate.length < maxHomies) {
      immediate.push(addId);
      continue;
    }

    // immediate full
    if (args.bumpLastImmediateOnAddWhenFull && immediate.length > 0) {
      const bumped = immediate[immediate.length - 1];
      immediate = immediate.slice(0, -1);
      followUp = uniq([bumped, ...followUp]);
      immediate.push(addId);
    } else {
      followUp = uniq([addId, ...followUp]);
    }
  }

  // 6) Apply backupOrder if specified
  if (args.patch.backupOrder && Array.isArray(args.patch.backupOrder)) {
    const resolved = resolveNamesToIds({ allMembers: args.allMembers, names: args.patch.backupOrder });
    if (resolved.unknownNames.length) {
      return { ok: false, reason: `Unknown homie(s) in backup order: ${resolved.unknownNames.join(", ")}` };
    }
    // Only reorder among backups; ignore any ids not currently in followUp.
    const currentSet = new Set(followUp);
    const desired = resolved.ids.filter((id) => currentSet.has(id) && !excludedSet.has(id));
    followUp = moveToFront(followUp.filter((id) => !excludedSet.has(id)), desired);
  }

  // 7) Final cleanup: no excluded, no duplicates across lists
  excluded = uniq(excluded);
  const excludedFinal = new Set(excluded);
  immediate = uniq(immediate).filter((id) => !excludedFinal.has(id));
  followUp = uniq(followUp)
    .filter((id) => !excludedFinal.has(id))
    .filter((id) => !immediate.includes(id));

  // 8) Rebalance: fill immediate if we can
  if (immediate.length < maxHomies) {
    const need = maxHomies - immediate.length;
    const promote = followUp.slice(0, need);
    immediate = [...immediate, ...promote];
    followUp = followUp.slice(promote.length);
  }

  // Names for SMS
  const byId = new Map(args.allMembers.map((m) => [m.member_id, m] as const));
  const immediateNames = immediate.map((id) => fullNameForMember(byId.get(id)!));
  const followUpNames = followUp.map((id) => fullNameForMember(byId.get(id)!));
  const excludedNames = excluded
    .map((id) => byId.get(id))
    .filter(Boolean)
    .map((m) => fullNameForMember(m!));

  return {
    ok: true,
    plan: {
      immediateMemberIds: immediate,
      followUpMemberIds: followUp,
      excludedMemberIds: excluded,
    },
    immediateNames,
    followUpNames,
    excludedNames,
  };
}
