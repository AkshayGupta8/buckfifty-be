// Backwards-compatible re-export layer.
// Existing conversationTwilio analyzers import from this path.
// The implementation lives in src/utils/llmLogging.ts to avoid circular deps.
import {
  logLlmRequest,
  logLlmResponse,
  shouldLogLlmIo,
  type LlmChatMessage,
} from "../../utils/llmLogging";

export { shouldLogLlmIo };

export function logLlmInput(args: {
  tag: string;
  model: string;
  temperature?: number;
  system?: string;
  prompt?: string;
  messages?: LlmChatMessage[];
}): void {
  return logLlmRequest({
    tag: args.tag,
    provider: "openai",
    model: args.model,
    temperature: args.temperature,
    system: args.system,
    prompt: args.prompt,
    messages: args.messages,
  });
}

export function logLlmOutput(args: {
  tag: string;
  text: string;
  usage?: unknown;
  finishReason?: string;
}): void {
  return logLlmResponse({
    tag: args.tag,
    provider: "openai",
    text: args.text,
    usage: args.usage,
    finishReason: args.finishReason,
  });
}
