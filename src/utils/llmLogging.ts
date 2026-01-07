import logger from "./logger";

export type LlmChatMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

export const shouldLogLlmIo = process.env.LOG_LLM_IO === "1" || process.env.LOG_LLM_IO === "true";

export function logLlmRequest(args: {
  tag: string;
  provider: "openai";
  model: string;
  temperature?: number;
  system?: string;
  prompt?: string;
  messages?: LlmChatMessage[];
}): void {
  if (!shouldLogLlmIo) return;
  logger.info("llm.request", {
    tag: args.tag,
    provider: args.provider,
    model: args.model,
    temperature: args.temperature,
    system: args.system,
    prompt: args.prompt,
    messages: args.messages,
  });
}

export function logLlmResponse(args: {
  tag: string;
  provider: "openai";
  text: string;
  usage?: unknown;
  finishReason?: string;
}): void {
  if (!shouldLogLlmIo) return;
  logger.info("llm.response", {
    tag: args.tag,
    provider: args.provider,
    text: args.text,
    usage: args.usage,
    finishReason: args.finishReason,
  });
}

