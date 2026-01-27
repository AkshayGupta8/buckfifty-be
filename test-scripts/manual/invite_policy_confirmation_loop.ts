/**
 * Manual regression check for the "Quick check" invite policy confirmation loop.
 *
 * This script only tests the deterministic helper that parses policy choices.
 * The loop itself is fixed by persisting + consuming `activeDraft.pendingInvitePolicyChoice`.
 *
 * Run:
 *   npx ts-node test-scripts/manual/invite_policy_confirmation_loop.ts
 */

import { parseInvitePolicyChoiceFromUserText } from "../../src/conversationTwilio/domain/invitePolicyChoice";

function assertEq(a: any, b: any, msg: string): void {
  if (a !== b) throw new Error(`Assertion failed: ${msg}. Expected ${b}, got ${a}`);
}

function main(): void {
  // Scenario from the report:
  // - user said "invite 2" + named 2 => inferredPolicy=exact
  // - user also said "Priority invite" => policyHint=prioritized
  const policyHint = "prioritized" as const;
  const inferredPolicy = "exact" as const;

  assertEq(
    parseInvitePolicyChoiceFromUserText({
      text: "Priority invite",
      policyHint,
      inferredPolicy,
    }),
    "prioritized",
    "priority choice",
  );

  assertEq(
    parseInvitePolicyChoiceFromUserText({
      text: "Priority invite starting with Phineas and Moe",
      policyHint,
      inferredPolicy,
    }),
    "prioritized",
    "priority choice w/ extra words",
  );

  assertEq(
    parseInvitePolicyChoiceFromUserText({
      text: "Handpicked invite",
      policyHint,
      inferredPolicy,
    }),
    "exact",
    "handpicked choice",
  );

  assertEq(
    parseInvitePolicyChoiceFromUserText({
      text: "only Phineas and Moe",
      policyHint,
      inferredPolicy,
    }),
    "exact",
    "handpicked choice via 'only'",
  );

  assertEq(
    parseInvitePolicyChoiceFromUserText({
      text: "idk",
      policyHint,
      inferredPolicy,
    }),
    null,
    "unknown choice",
  );

  console.log("OK: invite policy choice parsing behaves as expected.");
}

main();
