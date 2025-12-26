import { createLogger, format, transports } from "winston";
import path from "path";
import { AsyncLocalStorage } from "async_hooks";

const logDir = path.resolve(process.cwd(), "logs");

const asyncLocalStorage = new AsyncLocalStorage<Map<string, any>>();

function safeStringify(obj: unknown): string {
  try {
    return JSON.stringify(obj, null, 2);
  } catch {
    return "[unserializable]";
  }
}

const logger = createLogger({
  level: "info",
  format: format.combine(
    format.timestamp({ format: "YYYY-MM-DD HH:mm:ss" }),
    // Capture arbitrary metadata passed as the 2nd arg: logger.info(msg, meta)
    format.errors({ stack: true }),
    format.metadata({ fillExcept: ["message", "level", "timestamp", "label"] }),
    format.printf(({ timestamp, level, message, metadata }) => {
      const store = asyncLocalStorage.getStore();
      const requestId = store ? store.get("requestId") : undefined;
      const requestIdStr = requestId ? `[RequestId: ${requestId}] ` : '';
      const metaStr = metadata && Object.keys(metadata).length ? ` ${safeStringify(metadata)}` : "";
      return `${timestamp} [${level.toUpperCase()}]: ${requestIdStr}${message}${metaStr}`;
    })
  ),
  transports: [
    new transports.File({ filename: path.join(logDir, "app.log"), level: "info" }),
    new transports.Console({ level: "debug" }),
  ],
  exitOnError: false,
});

export { asyncLocalStorage };
export default logger;
