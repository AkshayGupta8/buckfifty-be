import { AsyncLocalStorage } from "async_hooks";
import { createLogger, format, transports } from "winston";

/**
 * Request-scoped / job-scoped correlation fields.
 *
 * These are automatically injected into every log line via AsyncLocalStorage.
 */
export type LogContext = {
  requestId?: string;

  // HTTP-ish fields
  method?: string;
  path?: string;

  // Domain fields
  userId?: string;
  conversationId?: string;
  conversationMessageId?: string;
  eventId?: string;
  memberId?: string;
  messageSid?: string;
};

export const asyncLocalStorage = new AsyncLocalStorage<LogContext>();

function safeStringify(obj: unknown): string {
  try {
    return JSON.stringify(obj);
  } catch {
    return "[unserializable]";
  }
}

function isDev(): boolean {
  return process.env.DEV === "1";
}

function getLogLevel(): string {
  return process.env.LOG_LEVEL ?? (isDev() ? "debug" : "info");
}

function getLogFormat(): "json" | "pretty" {
  const raw = (process.env.LOG_FORMAT ?? (isDev() ? "pretty" : "json")).toLowerCase();
  return raw === "pretty" ? "pretty" : "json";
}

export function getLogContext(): LogContext {
  return asyncLocalStorage.getStore() ?? {};
}

/** Merge provided fields into the current AsyncLocalStorage context. */
export function setLogContext(partial: LogContext): void {
  const current = getLogContext();
  asyncLocalStorage.enterWith({ ...current, ...partial });
}

/** Run a function with additional context merged into the current context. */
export function withLogContext<T>(partial: LogContext, fn: () => T): T {
  const current = getLogContext();
  return asyncLocalStorage.run({ ...current, ...partial }, fn);
}

const injectContextFormat = format((info) => {
  const ctx = getLogContext();
  // Attach context fields at top-level so CloudWatch can filter them.
  Object.assign(info, ctx);
  // Standardize key name for message
  if ((info as any).message && !(info as any).msg) {
    (info as any).msg = (info as any).message;
  }
  return info;
});

const prettyFormat = format.printf((info) => {
  const { timestamp, level } = info as any;
  const msg = (info as any).msg ?? (info as any).message;
  const { requestId, ...rest } = info as any;
  // Remove noisy winston keys
  delete (rest as any).level;
  delete (rest as any).timestamp;
  delete (rest as any).message;
  delete (rest as any).msg;

  const requestPrefix = requestId ? `[requestId=${requestId}] ` : "";
  const metaStr = Object.keys(rest).length ? ` ${safeStringify(rest)}` : "";
  return `${timestamp} ${level.toUpperCase()}: ${requestPrefix}${msg}${metaStr}`;
});

const logger = createLogger({
  level: getLogLevel(),
  format: format.combine(
    format.timestamp(),
    format.errors({ stack: true }),
    injectContextFormat(),
    // Ensure arbitrary metadata (logger.info(msg, meta)) is preserved.
    format.metadata({ fillExcept: ["message", "level", "timestamp", "label", "requestId"] }),
    getLogFormat() === "json" ? format.json() : prettyFormat
  ),
  transports: [new transports.Console()],
  exitOnError: false,
});

export default logger;
