import { analyzeHelpIntent, buildHelpIntentAnalyzerSystemPrompt } from "../../src/conversationTwilio/analyzers/helpIntentAnalyzer";

// Manual sanity-check helper (LLM-based).
// Requires OPENAI_API_KEY in env.
// Run:
//   npx ts-node-dev --transpile-only test-scripts/manual/print_help_intent_llm.ts

async function main() {
  const systemPrompt = buildHelpIntentAnalyzerSystemPrompt();

  const samples: string[] = [
    "Can you tell me about the different types of invites that you can facilitate",
    "How do invites work?",
    "What are invite options?",
    "What invite policies do you have?",
    "How does this work?",
    "What can you do?",
    "Invite Jake and Sara",
    "Tomorrow at 7",
    "At wash park",
  ];

  for (const s of samples) {
    const res = await analyzeHelpIntent({
      systemPrompt,
      messages: [{ role: "user", content: s }],
    });

    console.log("---");
    console.log(s);
    console.log(res.intent);
    console.log("raw:", res.rawText);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
