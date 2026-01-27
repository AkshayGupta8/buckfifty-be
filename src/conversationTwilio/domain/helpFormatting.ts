import { buildInvitePolicyExplainerLines } from "./inviteBranding";

function safeActivityName(name: string | null | undefined): string {
  const trimmed = (name ?? "").trim();
  return trimmed.length ? trimmed : "your activity";
}

/**
 * SMS-friendly explanation of how the scheduling assistant works.
 *
 * Keep this deterministic + concise so it can be sent in response to a simple "help" command.
 */
export function buildSchedulerHowItWorksSms(args: {
  activityName?: string | null;
}): string {
  const activityName = safeActivityName(args.activityName);

  return [
    `Here's how I can help schedule ${activityName}:`,
    "1) You tell me where + when.",
    "2) You tell me who to invite (or how many slots).",
    "3) I send a Draft. You can reply with edits.",
    '4) When you say "looks good", I lock it in and start inviting.',
    "",
    buildInvitePolicyExplainerLines(),
    "",
    "Tip: You can edit drafts by texting changes like \"move it to 8pm\" or \"swap Jake for Sara\".",
  ].join("\n");
}
