import { buildSchedulerHowItWorksSms } from "../../src/conversationTwilio/domain/helpFormatting";

// Manual sanity-check helper.
// Run:
//   npx ts-node-dev --transpile-only test-scripts/manual/print_help_sms.ts

console.log(
  buildSchedulerHowItWorksSms({
    activityName: "Pickleball",
  })
);
