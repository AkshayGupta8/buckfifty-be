import OpenAI from "openai";
import logger from "./logger";
import { logLlmRequest, logLlmResponse, shouldLogLlmIo } from "./llmLogging";

/**
 * OpenAI client singleton.
 *
 * Env var required:
 * - OPEN_AI_API_KEY
 */
const apiKey = process.env.OPEN_AI_API_KEY || "";

if (!apiKey) {
  // Mirror the fail-fast behavior used in twilioClient.ts
  throw new Error("OPENAI_API_KEY is not set in environment variables");
}

export const openai = new OpenAI({ apiKey });

export type ChatRole = "system" | "user" | "assistant";

export type ChatMessage = {
  role: ChatRole;
  content: string;
};

export type ChatOptions = {
  /** Correlation tag to identify this LLM call in logs (e.g. "assistantReply"). */
  tag?: string;
  /** e.g. "gpt-4o-mini", "gpt-4.1-mini" */
  model?: string;
  temperature?: number;
  max_tokens?: number;
  top_p?: number;

  /**
   * Set to true if you want the raw OpenAI response returned alongside `text`.
   * Useful for token usage, finish_reason, etc.
   */
  includeRawResponse?: boolean;

  /**
   * If you want OpenAI to store the request for evals/distillation (optional).
   * https://platform.openai.com/docs/api-reference/chat/create
   */
  store?: boolean;
};

export type ChatRequest = ChatOptions &
  (
    | {
        /**
         * System instructions (recommended).
         * If you also pass `messages`, this will be prepended as a system message
         * unless your `messages` already start with a system role.
         */
        system?: string;
        /** User prompt (required in this mode). */
        prompt: string;
        /** Optional additional messages (e.g. conversation history). */
        messages?: ChatMessage[];
      }
    | {
        /** Full message list mode. */
        messages: ChatMessage[];
        /** Optional system message to prepend. */
        system?: string;
        prompt?: never;
      }
  );

export type ChatResponse =
  | { text: string; rawResponse?: unknown }
  | { text: string; rawResponse: unknown };

function normalizeMessages(req: ChatRequest): ChatMessage[] {
  const prependSystemIfNeeded = (msgs: ChatMessage[]): ChatMessage[] => {
    if (!req.system) return msgs;
    if (msgs.length > 0 && msgs[0].role === "system") return msgs;
    return [{ role: "system", content: req.system }, ...msgs];
  };

  // Full message list mode
  if ("messages" in req && Array.isArray(req.messages) && req.prompt === undefined) {
    return prependSystemIfNeeded(req.messages);
  }

  // system + prompt mode (with optional additional messages)
  const msgs: ChatMessage[] = [];

  if ("messages" in req && Array.isArray(req.messages) && req.messages.length) {
    msgs.push(...req.messages);
  }

  if (!req.prompt) {
    throw new Error("openAiClient.chat: `prompt` is required when not providing full `messages`.");
  }

  msgs.push({ role: "user", content: req.prompt });
  return prependSystemIfNeeded(msgs);
}

/**
 * Convenience wrapper around OpenAI Chat Completions.
 *
 * Example:
 * ```ts
 * import { chat } from "../utils/openAiClient";
 *
 * const { text } = await chat({
 *   system: "You are a helpful assistant.",
 *   prompt: "Write a haiku about scheduling.",
 *   model: "gpt-4o-mini",
 *   temperature: 0.2,
 * });
 * ```
 */
export async function chat(req: ChatRequest): Promise<ChatResponse> {
  const model = req.model ?? process.env.OPENAI_MODEL ?? "gpt-4o-mini";
  const messages = normalizeMessages(req);

  // Optional centralized LLM I/O logging.
  // Existing call-sites already call logLlmInput/logLlmOutput in many cases;
  // this ensures *all* calls are logged when LOG_LLM_IO is enabled.
  const tag = (req as any).tag as string | undefined;
  if (shouldLogLlmIo) {
    logLlmRequest({
      tag: tag ?? "openAiClient.chat",
      provider: "openai",
      model,
      temperature: req.temperature,
      system: (req as any).system,
      prompt: (req as any).prompt,
      messages,
    });
  }

  try {
    const response = await openai.chat.completions.create({
      model,
      messages,
      temperature: req.temperature,
      max_tokens: req.max_tokens,
      top_p: req.top_p,
      store: req.store,
    });

    const text = response.choices?.[0]?.message?.content ?? "";
    const finishReason = response.choices?.[0]?.finish_reason ?? undefined;
    const usage = (response as any).usage;

    if (shouldLogLlmIo) {
      logLlmResponse({
        tag: tag ?? "openAiClient.chat",
        provider: "openai",
        text,
        usage,
        finishReason,
      });
    }

    if (req.includeRawResponse) {
      return { text, rawResponse: response };
    }

    return { text };
  } catch (err: any) {
    logger.error(`OpenAI chat completion failed: ${err?.message ?? err}`);
    throw err;
  }
}
