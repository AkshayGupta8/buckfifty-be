import { analyzeInvitePolicyIntent, buildInvitePolicyIntentAnalyzerSystemPrompt } from "../../src/conversationTwilio/analyzers/invitePolicyIntentAnalyzer";

// Manual sanity-check helper (LLM-based).
// Requires OPENAI_API_KEY in env.
// Run:
//   OPENAI_API_KEY=... npx ts-node-dev --transpile-only test-scripts/manual/print_invite_policy_intent_llm.ts

async function main() {
  const samples = [
    "I don't care who",
    "pick randomly",
    "Actually, I only want to invite Phineas, no one else",
    "No backups",
    "Invite policy should be hand picked",
    "Invite policy should be exact / hand picked invite policy",
    "Invite Phineas + others",
    "looks good",
  ];

  const systemPrompt = buildInvitePolicyIntentAnalyzerSystemPrompt();

  for (const s of samples) {
    const { intent, rawText } = await analyzeInvitePolicyIntent({
      systemPrompt,
      messages: [{ role: "user", content: s }],
    });
    console.log(JSON.stringify({ text: s, intent, rawText }, null, 2));
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
