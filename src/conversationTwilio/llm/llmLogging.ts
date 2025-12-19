import logger from "../../utils/logger";
import type { ChatMessage } from "../../utils/openAiClient";

const shouldLogLlmIo = process.env.LOG_LLM_IO === "1" || process.env.LOG_LLM_IO === "true";

export function logLlmInput(args: {
  tag: string;
  model: string;
  temperature?: number;
  system?: string;
  prompt?: string;
  messages?: ChatMessage[];
}): void {
  if (!shouldLogLlmIo) return;

  logger.info(
    `[LLM:input:${args.tag}] ${JSON.stringify(
      {
        model: args.model,
        temperature: args.temperature,
        system: args.system,
        prompt: args.prompt,
        messages: args.messages,
      },
      null,
      2
    )}`
  );
}

export function logLlmOutput(args: { tag: string; text: string }): void {
  if (!shouldLogLlmIo) return;
  logger.info(`[LLM:output:${args.tag}] ${args.text}`);
}
