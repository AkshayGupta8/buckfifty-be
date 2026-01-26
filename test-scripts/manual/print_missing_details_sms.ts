// Manual sanity-check helper for the "I still need" SMS formatting.
//
// Run:
//   npx ts-node-dev --transpile-only test-scripts/manual/print_missing_details_sms.ts

function buildMissingDetailsSms(args: {
  activityName: string;
  prompts: string[];
}): string {
  const header = `For ${args.activityName}, I still need:`;
  const list = args.prompts.map((p) => `- ${p}`).join("\n");
  const hint = "Reply “guide” if you want to see how invites work.";
  return [header, list, "", hint].join("\n").trim();
}

console.log(
  buildMissingDetailsSms({
    activityName: "Run 🏃‍♂️",
    prompts: [
      "Where should it be?",
      "What start & end time should I use?",
      "How many homies should I invite?",
    ],
  })
);
