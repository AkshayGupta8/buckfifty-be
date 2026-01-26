import { detectBrandedInvitePolicyHintFromText } from "../../src/conversationTwilio/domain/inviteBranding";

// Manual sanity-check helper.
// Run:
//   npx ts-node-dev --transpile-only test-scripts/manual/print_invite_policy_detection.ts

const samples = [
  "Update the invite policy to exact invite",
  "exact invite",
  "Handpicked Invite",
  "priority invite",
  "open invite",
  "looks good",
];

for (const s of samples) {
  console.log(JSON.stringify({ text: s, detected: detectBrandedInvitePolicyHintFromText(s) }));
}
