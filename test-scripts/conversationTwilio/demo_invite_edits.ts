/*
  Manual sanity-check script for invite-plan edits during confirmation.

  Run:
    npx ts-node-dev --transpile-only test-scripts/conversationTwilio/demo_invite_edits.ts
*/

import assert from "assert";
import type { Member } from "@prisma/client";
import { applyInvitePlanPatch } from "../../src/conversationTwilio/domain/invitePlanEdits";

function m(id: string, first: string, last: string): Member {
  return {
    member_id: id,
    user_id: "u1",
    first_name: first,
    last_name: last,
    phone_number: null,
    created_at: new Date(),
    updated_at: new Date(),
  };
}

const homies: Member[] = [
  m("larry", "Larry", "Buck"),
  m("curly", "Curly", "Buck"),
  m("moe", "Moe", "Buck"),
  m("phineas", "Phineas", "Buck"),
];

// Starting point (similar to your thread)
let plan = {
  immediateMemberIds: ["moe"],
  followUpMemberIds: ["phineas", "larry", "curly"],
  excludedMemberIds: [],
};

const maxHomies = 1;

// 1) "Don't invite phinease" (ban)
{
  const res = applyInvitePlanPatch({
    maxHomies,
    allMembers: homies,
    plan,
    patch: { bans: ["Phineas Buck"], unbans: [], add: [], remove: [], swap: [] },
    bumpLastImmediateOnAddWhenFull: true,
  });
  assert(res.ok);
  plan = res.plan;
  assert(!plan.immediateMemberIds.includes("phineas"));
  assert(!plan.followUpMemberIds.includes("phineas"));
  assert(plan.excludedMemberIds.includes("phineas"));
}

// 2) "Don't list Phineas in the backups either" (should remain excluded; no-op)
{
  const res = applyInvitePlanPatch({
    maxHomies,
    allMembers: homies,
    plan,
    patch: { bans: ["Phineas Buck"], unbans: [], add: [], remove: [], swap: [] },
    bumpLastImmediateOnAddWhenFull: true,
  });
  assert(res.ok);
  plan = res.plan;
  assert(!plan.followUpMemberIds.includes("phineas"));
}

// 3) "Make Curly the first backup" (reorder)
{
  const res = applyInvitePlanPatch({
    maxHomies,
    allMembers: homies,
    plan,
    patch: {
      bans: [],
      unbans: [],
      add: [],
      remove: [],
      swap: [],
      backupOrder: ["Curly Buck", "Larry Buck", "Moe Buck"],
    },
    bumpLastImmediateOnAddWhenFull: true,
  });
  assert(res.ok);
  plan = res.plan;
  assert.strictEqual(plan.followUpMemberIds[0], "curly");
}

// 4) "Invite Larry too" when immediate is full => bump last immediate to backups
{
  const res = applyInvitePlanPatch({
    maxHomies,
    allMembers: homies,
    plan,
    patch: { bans: [], unbans: [], add: ["Larry Buck"], remove: [], swap: [] },
    bumpLastImmediateOnAddWhenFull: true,
  });
  assert(res.ok);
  plan = res.plan;
  assert(plan.immediateMemberIds.includes("larry"));
  assert(plan.followUpMemberIds.includes("moe"));
}

console.log("OK — invite-plan edit semantics look good.");
console.log(JSON.stringify(plan, null, 2));
